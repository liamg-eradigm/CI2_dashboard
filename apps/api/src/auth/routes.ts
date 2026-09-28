/**
 * Sign-in routes (public: they run before the authentication middleware).
 *
 *   GET  /api/auth/login?returnTo=/tracker[&invite=<token>]  → redirect to Microsoft
 *   GET  /api/auth/callback                                  ← Microsoft redirects back here
 *   POST /api/auth/logout                                    → ends the session, returns Microsoft's sign-out URL
 *   GET  /api/auth/signed-out                                ← Microsoft's post-sign-out / front-channel logout
 *   GET  /api/auth/invite/:token                             → who an invite link is for (invite page)
 *
 * Accounts are linked to a Microsoft identity only by accepting an invite
 * link; afterwards sign-in matches the immutable (tenant id, object id) pair.
 */
import type { Hono } from "hono";
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { sha256Hex } from "../lib/crypto.js";
import { nowIso } from "../lib/ids.js";
import { log } from "../lib/log.js";
import { audit } from "../services/audit.js";
import { SignInError, authorizeUrl, logoutUrl, redeemCode, requireEntra } from "./entra.js";
import {
  SESSION_COOKIE,
  SIGNIN_COOKIE,
  clearCookie,
  cookie,
  createSession,
  deleteSession,
  deleteUserSessions,
  openState,
  pkceChallenge,
  randomToken,
  readCookie,
  safeReturnPath,
  sealState,
  timingSafeEqual,
} from "./sessions.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app's Variables type is defined in app.ts
type App = Hono<{ Bindings: Env; Variables: any }>;

const SIGNIN_TTL_SECONDS = 10 * 60;

/** Where the dashboard shows sign-in problems (never echoes provider text). */
const failPage = (code: string) => `/signin?error=${encodeURIComponent(code)}`;

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

async function limited(env: Env, req: Request): Promise<boolean> {
  if (!env.AUTH_LIMITER) return false;
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.AUTH_LIMITER.limit({ key: `auth:${ip}` });
  return !success;
}

interface InviteRow {
  id: string;
  user_id: string;
  tenant_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

async function findInvite(env: Env, token: string): Promise<InviteRow | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const r = await env.DB.prepare("SELECT id, user_id, tenant_id, expires_at, used_at, revoked_at FROM user_invites WHERE id = ?1").bind(await sha256Hex(token)).first<InviteRow>();
  if (!r || r.used_at || r.revoked_at || Date.parse(r.expires_at) <= Date.now()) return null;
  return r;
}

async function activeMembership(env: Env, userId: string): Promise<string | null> {
  const r = await env.DB.prepare(
    "SELECT r.tenant_id FROM role_assignments r JOIN tenants t ON t.id = r.tenant_id AND t.active = 1 WHERE r.user_id = ?1 AND r.active = 1 AND r.revoked_at IS NULL ORDER BY t.name LIMIT 1",
  )
    .bind(userId)
    .first<{ tenant_id: string }>();
  return r?.tenant_id ?? null;
}

async function failed(env: Env, reason: string, details: Record<string, unknown> = {}): Promise<Response> {
  log("warn", "sign_in_failed", { reason });
  await audit(env, { tenantId: null, actorId: null, actorEmail: null, action: "auth.sign_in_failed", details: { reason, ...details } });
  return redirect(failPage(reason), [clearCookie(SIGNIN_COOKIE)]);
}

export function registerAuthRoutes(app: App): void {
  app.get("/api/auth/login", async (c) => {
    const env = c.env;
    const returnTo = safeReturnPath(c.req.query("returnTo"));
    if (env.AUTH_MODE === "dev") return redirect(returnTo); // dev sign-in uses the sidebar switcher
    requireEntra(env);
    if (await limited(env, c.req.raw)) return redirect(failPage("rate_limited"));
    const invite = c.req.query("invite") ?? null;
    const verifier = randomToken(48);
    const s = { state: randomToken(), nonce: randomToken(), verifier, returnTo, invite: invite && /^[A-Za-z0-9_-]{20,100}$/.test(invite) ? invite : null, exp: Math.floor(Date.now() / 1000) + SIGNIN_TTL_SECONDS };
    const url = authorizeUrl(env, { state: s.state, nonce: s.nonce, codeChallenge: await pkceChallenge(verifier) });
    return redirect(url, [cookie(SIGNIN_COOKIE, await sealState(env, s), SIGNIN_TTL_SECONDS)]);
  });

  app.get("/api/auth/callback", async (c) => {
    const env = c.env;
    requireEntra(env);
    if (await limited(env, c.req.raw)) return redirect(failPage("rate_limited"));
    const q = c.req.query();
    if (q.error) {
      // The user cancelled, or their organisation requires admin consent for this app.
      return failed(env, q.error === "access_denied" ? "denied" : q.error === "consent_required" || q.error === "interaction_required" ? "consent" : "provider", { provider: String(q.error).slice(0, 60) });
    }
    const st = await openState(env, readCookie(c.req.header("cookie") ?? null, SIGNIN_COOKIE));
    if (!st || !q.state || !timingSafeEqual(q.state, st.state) || !q.code) return failed(env, "state");

    let id;
    try {
      id = await redeemCode(env, q.code, st.verifier, st.nonce);
    } catch (err) {
      if (err instanceof SignInError) return failed(env, err.code, { message: err.message.slice(0, 120) });
      throw err;
    }

    // 1. Already linked Microsoft identity?
    let user = await env.DB.prepare("SELECT id, email FROM users WHERE entra_tid = ?1 AND entra_oid = ?2").bind(id.tid, id.oid).first<{ id: string; email: string }>();
    let linkedNow = false;
    if (user && st.invite) {
      // An invite for a DIFFERENT account opened with an already-linked Microsoft account: say so.
      const inv = await findInvite(env, st.invite);
      if (inv && inv.user_id !== user.id) return failed(env, "already_linked", { tid: id.tid });
      if (inv) await env.DB.prepare("UPDATE user_invites SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL").bind(nowIso(), inv.id).run();
    }
    // 2. Otherwise only an invite link may attach this identity to an account.
    if (!user && st.invite) {
      const inv = await findInvite(env, st.invite);
      if (!inv) return failed(env, "invite_invalid", { tid: id.tid });
      const now = nowIso();
      const prior = await env.DB.prepare("SELECT entra_oid FROM users WHERE id = ?1").bind(inv.user_id).first<{ entra_oid: string | null }>();
      let res;
      try {
        // Atomic: the identity is linked only if the invite is still unused, and the invite is then consumed.
        res = await env.DB.batch([
          env.DB.prepare(
            `UPDATE users SET entra_tid = ?1, entra_oid = ?2, entra_linked_at = ?3 WHERE id = ?4
               AND EXISTS (SELECT 1 FROM user_invites WHERE id = ?5 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?3)`,
          ).bind(id.tid, id.oid, now, inv.user_id, inv.id),
          env.DB.prepare("UPDATE user_invites SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL AND revoked_at IS NULL").bind(now, inv.id),
        ]);
      } catch (err) {
        if (/UNIQUE/i.test(String((err as Error).message))) return failed(env, "already_linked", { tid: id.tid });
        throw err;
      }
      if ((res[0]?.meta.changes ?? 0) === 0) return failed(env, "invite_invalid", { tid: id.tid });
      // Re-linking (account recovery) ends any session of the previous identity.
      if (prior?.entra_oid) await deleteUserSessions(env, inv.user_id);
      user = await env.DB.prepare("SELECT id, email FROM users WHERE id = ?1").bind(inv.user_id).first<{ id: string; email: string }>();
      linkedNow = true;
      await audit(env, {
        tenantId: inv.tenant_id,
        actorId: inv.user_id,
        actorEmail: user?.email ?? null,
        action: "user.identity_linked",
        targetType: "user",
        targetId: inv.user_id,
        details: { tid: id.tid, relinked: !!prior?.entra_oid, microsoftEmail: id.email },
      });
    }
    if (!user) return failed(env, "not_invited", { tid: id.tid });

    const tenantId = await activeMembership(env, user.id);
    if (!tenantId) return failed(env, "deactivated", { user: user.id });

    const session = await createSession(env, user.id, c.req.header("user-agent") ?? null);
    await env.DB.prepare("UPDATE users SET last_sign_in_at = ?1, last_seen_at = ?1 WHERE id = ?2").bind(nowIso(), user.id).run();
    await audit(env, { tenantId, actorId: user.id, actorEmail: user.email, action: "auth.sign_in", targetType: "user", targetId: user.id, details: { method: "entra", tid: id.tid, firstLink: linkedNow } });
    return redirect(safeReturnPath(st.returnTo), [cookie(SESSION_COOKIE, session.token, session.maxAgeSeconds), clearCookie(SIGNIN_COOKIE)]);
  });

  app.post("/api/auth/logout", async (c) => {
    const env = c.env;
    const token = readCookie(c.req.header("cookie") ?? null, SESSION_COOKIE);
    if (token) {
      const s = await env.DB.prepare("SELECT s.user_id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?1").bind(await sha256Hex(token)).first<{ user_id: string; email: string }>();
      await deleteSession(env, token);
      if (s) {
        const tenantId = await activeMembership(env, s.user_id);
        await audit(env, { tenantId, actorId: s.user_id, actorEmail: s.email, action: "auth.sign_out", targetType: "user", targetId: s.user_id });
      }
    }
    const res = c.json({ redirect: env.AUTH_MODE === "entra" && env.APP_ORIGIN ? logoutUrl(env) : "/signin?signed_out=1" });
    res.headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
    return res;
  });

  app.get("/api/auth/signed-out", async (c) => {
    const token = readCookie(c.req.header("cookie") ?? null, SESSION_COOKIE);
    if (token) await deleteSession(c.env, token);
    return redirect("/signin?signed_out=1", [clearCookie(SESSION_COOKIE)]);
  });

  app.get("/api/auth/invite/:token", async (c) => {
    if (await limited(c.env, c.req.raw)) throw new ApiError("RATE_LIMITED", "Too many attempts. Please wait a minute and try again.");
    const inv = await findInvite(c.env, c.req.param("token"));
    if (!inv) return c.json({ valid: false });
    const r = await c.env.DB.prepare("SELECT u.name, t.name AS tenant FROM users u, tenants t WHERE u.id = ?1 AND t.id = ?2")
      .bind(inv.user_id, inv.tenant_id)
      .first<{ name: string; tenant: string }>();
    return c.json({ valid: true, name: r?.name ?? null, workspace: r?.tenant ?? null, expiresAt: inv.expires_at });
  });
}
