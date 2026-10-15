/**
 * Request 61: who can open which project, with which role (Admin → Projects &
 * access). One account per person; access is per project (a workspace's
 * role_assignments). The caller manages the projects where they are an admin
 * (any change) or an analyst (adding analysts and clients, as before); each
 * project keeps at least one active admin, and nobody changes their own access.
 */
import { canCreateUserWithRole, MAX_PROJECT_NAME, type Access, type AccessPerson, type Role } from "@eradigm/shared";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { ApiError, conflict, forbidden, notFound } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { audit } from "./audit.js";
import { createInvite, revokeSessions } from "./users.js";

type Managed = Principal["tenants"][number];

/** The projects the caller manages people for. */
const managed = (p: Principal): Managed[] => p.tenants.filter((t) => t.role === "admin" || t.role === "analyst");

/** The caller acting in one of their projects (its role decides what they may do there). */
function asIn(p: Principal, projectId: string): Principal {
  const t = p.tenants.find((x) => x.id === projectId);
  if (!t) throw notFound("Project");
  return { ...p, tenantId: t.id, tenantName: t.name, role: t.role, projectKind: t.kind, projectSlug: t.slug };
}

export async function listAccess(env: Env, p: Principal): Promise<Access> {
  const projects = managed(p);
  if (!projects.length) throw forbidden();
  const ids = projects.map((t) => t.id);
  const marks = ids.map((_, i) => `?${i + 1}`).join(", ");
  const rows = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.last_seen_at, r.tenant_id, r.role, r.active,
            (u.entra_oid IS NOT NULL) AS linked,
            EXISTS (SELECT 1 FROM user_invites i WHERE i.user_id = u.id AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS invited
       FROM role_assignments r JOIN users u ON u.id = r.user_id
      WHERE r.revoked_at IS NULL AND r.tenant_id IN (${marks})
      ORDER BY u.name, u.email`,
  )
    .bind(...ids)
    .all<{ id: string; email: string; name: string; last_seen_at: string | null; tenant_id: string; role: Role; active: number; linked: number; invited: number }>();
  const people = new Map<string, AccessPerson>();
  for (const r of rows.results ?? []) {
    const person = people.get(r.id) ?? {
      id: r.id,
      email: r.email,
      name: r.name,
      lastSeenAt: r.last_seen_at,
      signIn: r.linked ? "linked" : r.invited ? "invited" : "not_invited",
      access: {},
    };
    person.access[r.tenant_id] = { role: r.role, active: !!r.active };
    people.set(r.id, person);
  }
  return { projects: projects.map(({ id, slug, name, kind, role }) => ({ id, slug, name, kind, role })), people: [...people.values()] };
}

async function current(env: Env, tenantId: string, userId: string) {
  return env.DB.prepare("SELECT role, active FROM role_assignments WHERE tenant_id = ?1 AND user_id = ?2 AND revoked_at IS NULL").bind(tenantId, userId).first<{ role: Role; active: number }>();
}

async function adminsBesides(env: Env, tenantId: string, userId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM role_assignments WHERE tenant_id = ?1 AND role = 'admin' AND active = 1 AND revoked_at IS NULL AND user_id != ?2")
    .bind(tenantId, userId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** Give a person a role in a project, change it, or (null) take their access away. */
export async function setAccess(env: Env, p: Principal, userId: string, projectId: string, role: Role | null): Promise<void> {
  const q = asIn(p, projectId);
  if (q.role !== "admin") throw forbidden("Only the project's admins can change who has access to it");
  if (userId === p.userId) throw forbidden("You cannot change your own access");
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?1").bind(userId).first<{ id: string }>();
  if (!user) throw notFound("Person");
  const had = await current(env, projectId, userId);
  if (!had && !role) return;
  if (had && had.role === role) return;
  if (had?.role === "admin" && had.active && (await adminsBesides(env, projectId, userId)) === 0) throw conflict("A project must keep at least one active admin");
  const now = nowIso();
  // Role history is kept: the current assignment is revoked and (unless access is taken away) a new one made.
  await env.DB.batch([
    env.DB.prepare("UPDATE role_assignments SET revoked_at = ?1, revoked_by = ?2 WHERE tenant_id = ?3 AND user_id = ?4 AND revoked_at IS NULL").bind(now, p.userId, projectId, userId),
    ...(role
      ? [env.DB.prepare("INSERT INTO role_assignments (id, tenant_id, user_id, role, active, assigned_by, assigned_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)").bind(newId("rol"), projectId, userId, role, p.userId, now)]
      : []),
  ]);
  // Without access to a project, nothing of it may stay open in their browser.
  if (!role) await revokeSessions(env, q, userId, false).catch(() => undefined);
  await audit(env, {
    tenantId: projectId,
    actorId: p.userId,
    actorEmail: p.email,
    action: role ? (had ? "user.role_changed" : "user.access_granted") : "user.access_removed",
    targetType: "user",
    targetId: userId,
    details: { from: had?.role ?? null, to: role },
  });
}

/** Add a person to a project: a new account, or an existing one; a one-time sign-in link when they have never signed in. */
export async function addPerson(env: Env, p: Principal, input: { email: string; name: string; projectId: string; role: Role }): Promise<{ invite: { url: string; expiresAt: string } | null; userId: string }> {
  const q = asIn(p, input.projectId);
  if (!canCreateUserWithRole(q.role, input.role)) throw forbidden(q.role === "analyst" ? "Analysts can add analysts and clients only" : "You cannot add people to this project");
  const email = input.email.trim().toLowerCase();
  const now = nowIso();
  let user = await env.DB.prepare("SELECT id, entra_oid FROM users WHERE email = ?1").bind(email).first<{ id: string; entra_oid: string | null }>();
  if (user) {
    if (await current(env, q.tenantId, user.id)) throw conflict("This person already has access to this project");
  } else {
    user = { id: newId("usr"), entra_oid: null };
    await env.DB.prepare("INSERT INTO users (id, email, name, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5)").bind(user.id, email, input.name.trim(), now, p.userId).run();
  }
  await env.DB.prepare("INSERT INTO role_assignments (id, tenant_id, user_id, role, assigned_by, assigned_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(newId("rol"), q.tenantId, user.id, input.role, p.userId, now)
    .run();
  await audit(env, { tenantId: q.tenantId, actorId: p.userId, actorEmail: p.email, action: "user.created", targetType: "user", targetId: user.id, details: { role: input.role } });
  const invite = user.entra_oid ? null : await createInvite(env, q, user.id);
  return { invite, userId: user.id };
}

/** Rename a project (its admins). */
export async function renameProject(env: Env, p: Principal, projectId: string, name: string) {
  const q = asIn(p, projectId);
  if (q.role !== "admin") throw forbidden("Only the project's admins can rename it");
  const clean = name.trim().slice(0, MAX_PROJECT_NAME);
  if (!clean) throw new ApiError("VALIDATION", "Give the project a name");
  await env.DB.prepare("UPDATE tenants SET name = ?1 WHERE id = ?2").bind(clean, projectId).run();
  await audit(env, { tenantId: projectId, actorId: p.userId, actorEmail: p.email, action: "project.renamed", targetType: "tenant", targetId: projectId, details: { from: q.tenantName, to: clean } });
  const t = p.tenants.find((x) => x.id === projectId) as Managed;
  return { id: t.id, slug: t.slug, name: clean, kind: t.kind, role: t.role };
}

/** A project both manage and the person is in, where the caller may act on the person's role there. */
async function sharedProject(env: Env, p: Principal, userId: string, ok: (q: Principal, role: Role) => boolean): Promise<Principal> {
  for (const t of managed(p)) {
    const has = await current(env, t.id, userId);
    const q = asIn(p, t.id);
    if (has && ok(q, has.role)) return q;
  }
  throw forbidden("You do not manage a project this person has access to");
}

/** A one-time sign-in link for a person (new, or to attach a different Microsoft account). */
export async function accessInvite(env: Env, p: Principal, userId: string) {
  if (userId === p.userId) throw forbidden("You cannot issue a sign-in link for yourself");
  const q = await sharedProject(env, p, userId, (q, role) => canCreateUserWithRole(q.role, role));
  return createInvite(env, q, userId);
}

/** Sign a person out everywhere (admins of a project they are in). */
export async function accessEndSessions(env: Env, p: Principal, userId: string) {
  const q = await sharedProject(env, p, userId, (q) => q.role === "admin");
  return revokeSessions(env, q, userId);
}
