/**
 * Account administration (6_QC_&_Compliance):
 *  - analysts may create analyst and client accounts only for their own tenant;
 *  - only admins may create admins or change a role after creation;
 *  - admins can deactivate accounts and end active sessions;
 *  - people sign in with Microsoft: a new account gets a one-time invite link
 *    that attaches the person's Microsoft work account to it (see auth/routes.ts).
 */
import { canChangeRole, canCreateUserWithRole, type Invite, type Role, type User, type UserWithInvite } from "@eradigm/shared";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { ApiError, conflict, forbidden, notFound } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { sha256Hex } from "../lib/crypto.js";
import { deleteUserSessions, randomToken } from "../auth/sessions.js";
import { appOrigin } from "../auth/entra.js";
import { audit } from "./audit.js";

export const INVITE_DAYS = 7;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: number;
  created_at: string;
  last_seen_at: string | null;
  linked: number;
  invited: number;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  active: !!r.active,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  signIn: r.linked ? "linked" : r.invited ? "invited" : "not_invited",
});

const SELECT = `SELECT u.id, u.email, u.name, r.role, r.active, u.created_at, u.last_seen_at,
       (u.entra_oid IS NOT NULL) AS linked,
       EXISTS (SELECT 1 FROM user_invites i WHERE i.user_id = u.id AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS invited
  FROM role_assignments r JOIN users u ON u.id = r.user_id
 WHERE r.tenant_id = ?1 AND r.revoked_at IS NULL`;

export async function listUsers(env: Env, tenantId: string): Promise<User[]> {
  const res = await env.DB.prepare(`${SELECT} ORDER BY r.active DESC, u.name`).bind(tenantId).all<UserRow>();
  return (res.results ?? []).map(toUser);
}

async function getUser(env: Env, tenantId: string, userId: string): Promise<User> {
  const r = await env.DB.prepare(`${SELECT} AND u.id = ?2`).bind(tenantId, userId).first<UserRow>();
  if (!r) throw notFound("User");
  return toUser(r);
}

/**
 * One-time sign-in link for a user of the caller's workspace. Earlier unused
 * links are revoked. Accepting it (signing in with Microsoft) attaches that
 * Microsoft account to the user — also used to recover an account whose
 * Microsoft account changed. Only the token's hash is stored.
 */
export async function createInvite(env: Env, p: Principal, userId: string): Promise<Invite> {
  const target = await getUser(env, p.tenantId, userId);
  if (!canCreateUserWithRole(p.role, target.role)) throw forbidden("You cannot issue sign-in links for this account");
  if (!target.active) throw conflict("Reactivate the account before sending a sign-in link");
  const token = randomToken();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE user_invites SET revoked_at = ?1 WHERE user_id = ?2 AND used_at IS NULL AND revoked_at IS NULL").bind(now, userId),
    env.DB.prepare("INSERT INTO user_invites (id, user_id, tenant_id, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(await sha256Hex(token), userId, p.tenantId, p.userId, now, expiresAt),
  ]);
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "user.invite_created", targetType: "user", targetId: userId, details: { expiresAt } });
  const origin = appOrigin(env) ?? "";
  return { url: `${origin}/invite/${token}`, expiresAt };
}

export async function createUser(env: Env, p: Principal, input: { email: string; name: string; role: Role }): Promise<UserWithInvite> {
  if (!canCreateUserWithRole(p.role, input.role)) {
    throw forbidden(p.role === "analyst" ? "Analysts can create analyst and client accounts only" : "You cannot create accounts");
  }
  const email = input.email.trim().toLowerCase();
  const now = nowIso();
  let user = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first<{ id: string }>();
  if (user) {
    const has = await env.DB.prepare("SELECT 1 AS x FROM role_assignments WHERE tenant_id = ?1 AND user_id = ?2 AND revoked_at IS NULL").bind(p.tenantId, user.id).first();
    if (has) throw conflict("This person already has an account in this workspace");
  } else {
    user = { id: newId("usr") };
    await env.DB.prepare("INSERT INTO users (id, email, name, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5)").bind(user.id, email, input.name.trim(), now, p.userId).run();
  }
  await env.DB.prepare("INSERT INTO role_assignments (id, tenant_id, user_id, role, assigned_by, assigned_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(newId("rol"), p.tenantId, user.id, input.role, p.userId, now)
    .run();
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "user.created", targetType: "user", targetId: user.id, details: { role: input.role } });
  const invite = await createInvite(env, p, user.id);
  return { ...(await getUser(env, p.tenantId, user.id)), invite };
}

async function adminCount(env: Env, tenantId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM role_assignments WHERE tenant_id = ?1 AND role = 'admin' AND active = 1 AND revoked_at IS NULL").bind(tenantId).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function updateUser(env: Env, p: Principal, userId: string, patch: { role?: Role; active?: boolean }): Promise<User> {
  if (!canChangeRole(p.role)) throw forbidden("Only admins can change roles or deactivate accounts");
  const target = await getUser(env, p.tenantId, userId);
  const now = nowIso();
  const losingAdmin = target.role === "admin" && target.active && ((patch.role && patch.role !== "admin") || patch.active === false);
  if (losingAdmin && (await adminCount(env, p.tenantId)) <= 1) throw conflict("A workspace must keep at least one active admin");

  if (patch.role && patch.role !== target.role) {
    // Keep role history: revoke the current assignment and create a new one.
    await env.DB.batch([
      env.DB.prepare("UPDATE role_assignments SET revoked_at = ?1, revoked_by = ?2 WHERE tenant_id = ?3 AND user_id = ?4 AND revoked_at IS NULL").bind(now, p.userId, p.tenantId, userId),
      env.DB.prepare("INSERT INTO role_assignments (id, tenant_id, user_id, role, active, assigned_by, assigned_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(
        newId("rol"),
        p.tenantId,
        userId,
        patch.role,
        target.active ? 1 : 0,
        p.userId,
        now,
      ),
    ]);
    await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "user.role_changed", targetType: "user", targetId: userId, details: { from: target.role, to: patch.role } });
  }
  if (patch.active !== undefined && patch.active !== target.active) {
    await env.DB.prepare("UPDATE role_assignments SET active = ?1 WHERE tenant_id = ?2 AND user_id = ?3 AND revoked_at IS NULL").bind(patch.active ? 1 : 0, p.tenantId, userId).run();
    if (!patch.active) await revokeSessions(env, p, userId, false);
    await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: patch.active ? "user.reactivated" : "user.deactivated", targetType: "user", targetId: userId });
  }
  return getUser(env, p.tenantId, userId);
}

/**
 * End active sessions: the user's sessions are deleted (they are signed out on
 * their next request) and any session started before now is rejected.
 */
export async function revokeSessions(env: Env, p: Principal, userId: string, auditIt = true): Promise<{ sessionsEnded: number }> {
  if (userId !== p.userId) {
    if (p.role !== "admin") throw forbidden();
    await getUser(env, p.tenantId, userId);
  }
  const u = await env.DB.prepare("SELECT id FROM users WHERE id = ?1").bind(userId).first<{ id: string }>();
  if (!u) throw notFound("User");
  // One second in the future so a session created in this same second is also invalidated.
  await env.DB.prepare("UPDATE users SET sessions_valid_after = ?1 WHERE id = ?2").bind(new Date(Date.now() + 1000).toISOString(), userId).run();
  const sessionsEnded = await deleteUserSessions(env, userId);
  if (auditIt) {
    await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "auth.sessions_revoked", targetType: "user", targetId: userId, details: { sessionsEnded } });
  }
  return { sessionsEnded };
}

export function assertRole(v: string): Role {
  if (v === "admin" || v === "analyst" || v === "client") return v;
  throw new ApiError("VALIDATION", "Unknown role");
}
