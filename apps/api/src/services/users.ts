/**
 * Account administration (6_QC_&_Compliance):
 *  - analysts may create analyst and client accounts only for their own tenant;
 *  - only admins may create admins or change a role after creation;
 *  - admins can deactivate accounts and end active sessions.
 */
import { canChangeRole, canCreateUserWithRole, type Role, type User } from "@eradigm/shared";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { ApiError, conflict, forbidden, notFound } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { log } from "../lib/log.js";
import { audit } from "./audit.js";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: number;
  created_at: string;
  last_seen_at: string | null;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  active: !!r.active,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
});

const SELECT = `SELECT u.id, u.email, u.name, r.role, r.active, u.created_at, u.last_seen_at
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

export async function createUser(env: Env, p: Principal, input: { email: string; name: string; role: Role }): Promise<User> {
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
  return getUser(env, p.tenantId, user.id);
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
 * End active sessions: tokens issued before now are rejected by the API, and,
 * when a Cloudflare API token is configured, the user's Access sessions are
 * revoked at the edge as well.
 */
export async function revokeSessions(env: Env, p: Principal, userId: string, auditIt = true): Promise<{ edgeRevoked: boolean }> {
  if (userId !== p.userId) {
    if (p.role !== "admin") throw forbidden();
    await getUser(env, p.tenantId, userId);
  }
  const u = await env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(userId).first<{ email: string }>();
  if (!u) throw notFound("User");
  // One second in the future so a token minted in this same second is also invalidated.
  await env.DB.prepare("UPDATE users SET sessions_valid_after = ?1 WHERE id = ?2").bind(new Date(Date.now() + 1000).toISOString(), userId).run();
  let edgeRevoked = false;
  if (env.CF_ACCOUNT_ID && env.CF_ACCESS_API_TOKEN) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/organizations/revoke_user`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.CF_ACCESS_API_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ email: u.email }),
      });
      edgeRevoked = res.ok;
    } catch (err) {
      log("warn", "access_revoke_failed", { message: (err as Error).message });
    }
  }
  if (auditIt) {
    await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "auth.sessions_revoked", targetType: "user", targetId: userId, details: { edgeRevoked } });
  }
  return { edgeRevoked };
}

export function assertRole(v: string): Role {
  if (v === "admin" || v === "analyst" || v === "client") return v;
  throw new ApiError("VALIDATION", "Unknown role");
}
