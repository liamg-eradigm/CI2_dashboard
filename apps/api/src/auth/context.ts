/**
 * Request identity: who is calling, which tenant they are acting in, and with
 * which role. Resolved on every request; every repository call takes the
 * tenant id from here, never from request data.
 */
import { can, type Action, type Role } from "@eradigm/shared";
import type { Env } from "../env.js";
import { ApiError, forbidden } from "../lib/errors.js";
import { nowIso } from "../lib/ids.js";
import { audit } from "../services/audit.js";
import { requireEntra } from "./entra.js";
import { SESSION_COOKIE, lookupSession, readCookie } from "./sessions.js";

export interface Principal {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  role: Role;
  tenants: { id: string; name: string; role: Role }[];
}

const DEV_SESSION_START = Math.floor(Date.now() / 1000);

/** Who is calling: a user id (Microsoft sign-in session) or, in dev only, an email. */
type Identity = { userId: string; email?: undefined; issuedAt: number } | { email: string; userId?: undefined; issuedAt: number };

async function identify(req: Request, env: Env): Promise<Identity> {
  if (env.AUTH_MODE === "dev") {
    // Development-only identity header. Fails closed outside dev/test.
    if (env.ENVIRONMENT !== "dev" && env.ENVIRONMENT !== "test") {
      throw new ApiError("MISCONFIGURED", "Development authentication is disabled in this environment");
    }
    const email = req.headers.get("x-dev-user")?.trim().toLowerCase();
    if (!email) throw new ApiError("UNAUTHENTICATED", "Sign in required (dev: send X-Dev-User)");
    const iat = Number(req.headers.get("x-dev-iat"));
    return { email, issuedAt: Number.isFinite(iat) && iat > 0 ? iat : DEV_SESSION_START };
  }
  if (env.AUTH_MODE !== "entra") throw new ApiError("MISCONFIGURED", "Sign-in is not configured for this environment (AUTH_MODE)");
  requireEntra(env);
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) throw new ApiError("UNAUTHENTICATED", "Sign in required");
  const session = await lookupSession(env, token);
  if (!session) throw new ApiError("UNAUTHENTICATED", "Your session has ended. Please sign in again.");
  return { userId: session.user_id, issuedAt: Math.floor(Date.parse(session.created_at) / 1000) };
}

interface MembershipRow {
  user_id: string;
  email: string;
  name: string;
  sessions_valid_after: string | null;
  last_sign_in_at: string | null;
  tenant_id: string;
  tenant_name: string;
  role: Role;
}

export async function resolvePrincipal(req: Request, env: Env): Promise<Principal> {
  const id = await identify(req, env);
  const rows = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email, u.name, u.sessions_valid_after, u.last_sign_in_at, t.id AS tenant_id, t.name AS tenant_name, r.role
       FROM users u
       JOIN role_assignments r ON r.user_id = u.id AND r.revoked_at IS NULL AND r.active = 1
       JOIN tenants t ON t.id = r.tenant_id AND t.active = 1
      WHERE ${id.userId ? "u.id = ?1" : "u.email = ?1"}
      ORDER BY t.name`,
  )
    .bind(id.userId ?? id.email)
    .all<MembershipRow>();
  const issuedAt = id.issuedAt;
  const memberships = rows.results ?? [];
  if (!memberships.length) throw forbidden("Your account does not have access to any workspace. Ask an administrator for access.");

  const first = memberships[0] as MembershipRow;
  const email = first.email;
  if (first.sessions_valid_after && issuedAt * 1000 < Date.parse(first.sessions_valid_after)) {
    throw new ApiError("UNAUTHENTICATED", "This session was ended. Please sign in again.");
  }

  const requested = req.headers.get("x-tenant-id");
  const chosen = requested ? memberships.find((m) => m.tenant_id === requested) : first;
  // Unknown or unauthorised tenant ids are indistinguishable from each other.
  if (!chosen) throw forbidden("You do not have access to this workspace");

  // Dev sign-ins are audited here once per identity token; Microsoft sign-ins
  // are audited by the callback when the session is created.
  const iatIso = new Date(issuedAt * 1000).toISOString();
  if (env.AUTH_MODE === "dev" && (!first.last_sign_in_at || first.last_sign_in_at < iatIso)) {
    const upd = await env.DB.prepare("UPDATE users SET last_sign_in_at = ?1 WHERE id = ?2 AND (last_sign_in_at IS NULL OR last_sign_in_at < ?1)").bind(iatIso, first.user_id).run();
    if ((upd.meta.changes ?? 0) > 0) {
      await audit(env, { tenantId: chosen.tenant_id, actorId: first.user_id, actorEmail: email, action: "auth.sign_in", targetType: "user", targetId: first.user_id, details: { method: env.AUTH_MODE } });
    }
  }

  // Best-effort last-seen update (at most once per ~5 minutes per user).
  const lastSeenCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  await env.DB.prepare("UPDATE users SET last_seen_at = ?1 WHERE id = ?2 AND (last_seen_at IS NULL OR last_seen_at < ?3)")
    .bind(nowIso(), first.user_id, lastSeenCutoff)
    .run();

  return {
    userId: first.user_id,
    email,
    name: first.name,
    tenantId: chosen.tenant_id,
    tenantName: chosen.tenant_name,
    role: chosen.role,
    tenants: memberships.map((m) => ({ id: m.tenant_id, name: m.tenant_name, role: m.role })),
  };
}

export function requirePermission(p: Principal, action: Action): void {
  if (!can(p.role, action)) throw forbidden();
}
