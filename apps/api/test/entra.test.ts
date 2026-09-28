/**
 * Sign in with Microsoft (Entra ID, any organisation): the OpenID Connect
 * flow against a fake Microsoft (token + signing-key endpoints) using a test
 * RSA key, plus invites, sessions, CSRF protection and session ending.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { setEntraFetcher } from "../src/auth/entra";
import { _resetJwksCache } from "../src/auth/jwt";
import { call, env, json, seedWorld, type World } from "./helpers";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const TID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_TID = "99999999-8888-7777-6666-555555555555";
const ORIGIN = "https://ci.example.test";
const E = {
  ...env,
  ENVIRONMENT: "staging" as const,
  AUTH_MODE: "entra" as const,
  APP_ORIGIN: ORIGIN,
  ENTRA_CLIENT_ID: CLIENT_ID,
  ENTRA_CLIENT_SECRET: "test-client-secret-value",
  SESSION_SECRET: "a-test-session-secret-that-is-long-enough-123",
};
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

let w: World;
let keys: CryptoKeyPair;
const KID = "test-kid-1";
/** What the fake Microsoft token endpoint puts in the next ID token. */
let nextClaims: Record<string, unknown> = {};
let tokenStatus = 200;

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function idToken(claims: Record<string, unknown>) {
  const h = enc({ alg: "RS256", kid: KID, typ: "JWT" });
  const p = enc(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

beforeAll(async () => {
  w = await seedWorld();
  keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  _resetJwksCache();
  setEntraFetcher((async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/discovery/v2.0/keys")) return Response.json({ keys: [{ kty: "RSA", kid: KID, n: jwk.n, e: jwk.e, use: "sig" }] });
    if (url.endsWith("/oauth2/v2.0/token")) {
      const form = new URLSearchParams(String(init?.body));
      if (tokenStatus !== 200) return Response.json({ error: "invalid_client" }, { status: tokenStatus });
      expect(form.get("client_secret")).toBe(E.ENTRA_CLIENT_SECRET);
      expect(form.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback`);
      expect(form.get("code_verifier")?.length).toBeGreaterThan(42);
      return Response.json({ id_token: await idToken(nextClaims), token_type: "Bearer" });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch);
});
afterAll(() => setEntraFetcher(null));

const cookiesOf = (res: Response) => ((res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""]).filter(Boolean);
const cookieValue = (res: Response, name: string) => {
  const c = cookiesOf(res).find((x) => x.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.slice(name.length + 1).split(";")[0] as string) : null;
};

async function req(path: string, init: RequestInit & { cookie?: string } = {}, e: typeof E = E) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" }), e, ctx);
}

/** Runs the whole sign-in: /login → (Microsoft) → /callback. Returns the callback response. */
async function signIn(claims: Record<string, unknown>, opts: { invite?: string; e?: typeof E; tamperState?: boolean } = {}) {
  const e = opts.e ?? E;
  const login = await req(`/api/auth/login?returnTo=%2Ftracker${opts.invite ? `&invite=${opts.invite}` : ""}`, {}, e);
  expect(login.status).toBe(302);
  const loc = new URL(login.headers.get("location") as string);
  const signinCookie = cookieValue(login, "__Host-eci_signin") as string;
  const nonce = loc.searchParams.get("nonce");
  const state = opts.tamperState ? "tampered-state" : loc.searchParams.get("state");
  const now = Math.floor(Date.now() / 1000);
  nextClaims = { aud: CLIENT_ID, iss: `https://login.microsoftonline.com/${TID}/v2.0`, tid: TID, oid: "oid-default", nonce, iat: now, nbf: now, exp: now + 3600, ver: "2.0", ...claims };
  return req(`/api/auth/callback?code=auth-code&state=${state}`, { cookie: `__Host-eci_signin=${encodeURIComponent(signinCookie)}` }, e);
}

async function inviteFor(email: string, name: string, role = "client") {
  const u = await json(call(w.a.admin, "POST", "/api/users", { body: { email, name, role } }));
  expect(u.signIn).toBe("invited");
  return { user: u, token: (u.invite.url as string).split("/invite/")[1] as string };
}

describe("Sign in with Microsoft", () => {
  it("redirects to Microsoft's multi-organisation endpoint with PKCE, state and nonce", async () => {
    const res = await req("/api/auth/login?returnTo=%2Ftracker");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") as string);
    expect(`${loc.origin}${loc.pathname}`).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    expect(loc.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(loc.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback`);
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("scope")).toBe("openid profile email");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("state")?.length).toBeGreaterThan(20);
    expect(loc.searchParams.get("nonce")?.length).toBeGreaterThan(20);
    const c = cookiesOf(res).find((x) => x.startsWith("__Host-eci_signin="));
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Lax/);
  });

  it("refuses to start when the Microsoft values have not been entered", async () => {
    const res = await req("/api/auth/login", {}, { ...E, ENTRA_CLIENT_ID: undefined as unknown as string });
    expect(res.status).toBe(503);
    expect((await res.json<any>()).error.message).toMatch(/ENTRA_CLIENT_ID/);
  });

  it("links a Microsoft account only through an invite link, then signs in by Microsoft identity", async () => {
    const { user, token } = await inviteFor("new.client@partner.test", "New Client");
    const cb = await signIn({ oid: "oid-client-1", email: "whatever@partner.test", name: "New Client" }, { invite: token });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/tracker");
    const session = cookieValue(cb, "__Host-eci_session") as string;
    expect(session.length).toBeGreaterThan(30);
    expect(cookiesOf(cb).find((x) => x.startsWith("__Host-eci_session="))).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const stored = await env.DB.prepare("SELECT id FROM sessions WHERE user_id = ?1").bind(user.id).first<{ id: string }>();
    expect(stored?.id).not.toBe(session); // only the hash is stored

    const me = await req("/api/me", { cookie: `__Host-eci_session=${session}` });
    expect(me.status).toBe(200);
    expect((await me.json<any>()).user.email).toBe("new.client@partner.test");

    // The invite is used up; later sign-ins match the Microsoft identity, not the email.
    const again = await signIn({ oid: "oid-client-1" });
    expect(again.headers.get("location")).toBe("/tracker");
    expect((await signIn({ oid: "oid-client-1" }, { invite: token })).headers.get("location")).toBe("/tracker");
    const users = await json(call(w.a.admin, "GET", "/api/users"));
    expect(users.find((u: any) => u.id === user.id).signIn).toBe("linked");
    const events = await env.DB.prepare("SELECT action FROM audit_events WHERE target_id = ?1 ORDER BY seq").bind(user.id).all<{ action: string }>();
    expect(events.results?.map((e) => e.action)).toEqual(expect.arrayContaining(["user.created", "user.invite_created", "user.identity_linked", "auth.sign_in"]));
  });

  it("never links by email: another organisation's account with the same email is refused", async () => {
    await inviteFor("victim@partner.test", "Victim");
    const res = await signIn({ oid: "attacker-oid", tid: OTHER_TID, iss: `https://login.microsoftonline.com/${OTHER_TID}/v2.0`, email: "victim@partner.test", preferred_username: "victim@partner.test" });
    expect(res.headers.get("location")).toBe("/signin?error=not_invited");
    expect(cookieValue(res, "__Host-eci_session")).toBeNull();
  });

  it("rejects used, replaced or unknown invite links and already-linked Microsoft accounts", async () => {
    const { user, token } = await inviteFor("twice@partner.test", "Twice");
    const newer = await json(call(w.a.admin, "POST", `/api/users/${user.id}/invite`));
    expect((await signIn({ oid: "oid-twice" }, { invite: token })).headers.get("location")).toBe("/signin?error=invite_invalid");
    expect((await signIn({ oid: "oid-twice" }, { invite: "x".repeat(43) })).headers.get("location")).toBe("/signin?error=invite_invalid");
    // oid-client-1 already belongs to another account.
    const t2 = (newer.url as string).split("/invite/")[1] as string;
    expect((await signIn({ oid: "oid-client-1" }, { invite: t2 })).headers.get("location")).toBe("/signin?error=already_linked");
    // ...and the failed attempt did not use up the link.
    expect((await signIn({ oid: "oid-twice" }, { invite: t2 })).headers.get("location")).toBe("/tracker");
    // Public invite lookup reveals nothing for used links.
    expect(await json(req(`/api/auth/invite/${t2}`))).toEqual({ valid: false });
  });

  it("validates the ID token (nonce, audience, issuer, expiry, personal accounts, allowed organisations)", async () => {
    const { token } = await inviteFor("strict@partner.test", "Strict");
    const now = Math.floor(Date.now() / 1000);
    const cases: [Record<string, unknown>, string][] = [
      [{ nonce: "wrong" }, "token"],
      [{ aud: "another-app" }, "token"],
      [{ iss: "https://evil.example/v2.0" }, "token"],
      [{ exp: now - 3600 }, "token"],
      [{ tid: "9188040d-6c67-4c5b-b112-36a304b66dad", iss: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0" }, "consumer"],
    ];
    for (const [claims, code] of cases) {
      expect((await signIn({ oid: "oid-strict", ...claims }, { invite: token })).headers.get("location")).toBe(`/signin?error=${code}`);
    }
    const onlyOther = { ...E, ENTRA_ALLOWED_TENANTS: OTHER_TID };
    expect((await signIn({ oid: "oid-strict" }, { invite: token, e: onlyOther })).headers.get("location")).toBe("/signin?error=tenant");
    expect((await signIn({ oid: "oid-strict" }, { invite: token, e: { ...E, ENTRA_ALLOWED_TENANTS: "not-a-guid" } })).headers.get("location")).toBe("/signin?error=tenant");
    expect((await signIn({ oid: "oid-strict" }, { invite: token, tamperState: true })).headers.get("location")).toBe("/signin?error=state");
    tokenStatus = 401;
    expect((await signIn({ oid: "oid-strict" }, { invite: token })).headers.get("location")).toBe("/signin?error=config");
    tokenStatus = 200;
    // None of the failures consumed the invite.
    expect((await signIn({ oid: "oid-strict" }, { invite: token })).headers.get("location")).toBe("/tracker");
  });

  it("only returns to paths inside the dashboard", async () => {
    for (const bad of ["//evil.example", "https://evil.example", "/api/users", "/\\evil"]) {
      const login = await req(`/api/auth/login?returnTo=${encodeURIComponent(bad)}`);
      const st = cookieValue(login, "__Host-eci_signin") as string;
      const payload = JSON.parse(atob((st.split(".")[0] as string).replace(/-/g, "+").replace(/_/g, "/")));
      expect(payload.returnTo).toBe("/dashboard");
    }
  });

  it("protects state-changing requests from cross-site forgery", async () => {
    const cb = await signIn({ oid: "oid-client-1" });
    const cookie = `__Host-eci_session=${cookieValue(cb, "__Host-eci_session")}`;
    const noHeader = await req("/api/views", { method: "POST", cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x", kind: "tracker", state: {} }) });
    expect(noHeader.status).toBe(403);
    const withHeader = await req("/api/me/sessions/revoke", { method: "POST", cookie, headers: { "x-eci-request": "1" } });
    expect(withHeader.status).toBe(200);
  });

  it("ends sessions: sign-out, End sessions, deactivation", async () => {
    const { user, token } = await inviteFor("ending@partner.test", "Ending", "analyst");
    let cb = await signIn({ oid: "oid-ending" }, { invite: token });
    let cookie = `__Host-eci_session=${cookieValue(cb, "__Host-eci_session")}`;
    expect((await req("/api/me", { cookie })).status).toBe(200);

    // Sign out: session deleted, Microsoft sign-out URL returned.
    const out = await req("/api/auth/logout", { method: "POST", cookie, headers: { "x-eci-request": "1" } });
    expect((await out.json<any>()).redirect).toMatch(/^https:\/\/login\.microsoftonline\.com\/organizations\/oauth2\/v2\.0\/logout\?post_logout_redirect_uri=https%3A%2F%2Fci\.example\.test%2Fapi%2Fauth%2Fsigned-out$/);
    expect((await req("/api/me", { cookie })).status).toBe(401);

    // Admin ends all sessions.
    cb = await signIn({ oid: "oid-ending" });
    cookie = `__Host-eci_session=${cookieValue(cb, "__Host-eci_session")}`;
    expect((await call(w.a.admin, "POST", `/api/users/${user.id}/sessions/revoke`)).status).toBe(200);
    expect((await req("/api/me", { cookie })).status).toBe(401);

    // Deactivated accounts cannot sign in.
    await call(w.a.admin, "PATCH", `/api/users/${user.id}`, { body: { active: false } });
    expect((await signIn({ oid: "oid-ending" })).headers.get("location")).toBe("/signin?error=deactivated");
  });

  it("expires idle sessions", async () => {
    const cb = await signIn({ oid: "oid-client-1" });
    const token = cookieValue(cb, "__Host-eci_session") as string;
    await env.DB.prepare("UPDATE sessions SET last_seen_at = '2000-01-01T00:00:00.000Z' WHERE created_at = (SELECT MAX(created_at) FROM sessions)").run();
    expect((await req("/api/me", { cookie: `__Host-eci_session=${token}` })).status).toBe(401);
  });

  it("recovers an account whose Microsoft account changed with a new sign-in link", async () => {
    const { user, token } = await inviteFor("mover@partner.test", "Mover");
    await signIn({ oid: "oid-old" }, { invite: token });
    const link = await json(call(w.a.admin, "POST", `/api/users/${user.id}/invite`));
    const cb = await signIn({ oid: "oid-new", tid: OTHER_TID, iss: `https://login.microsoftonline.com/${OTHER_TID}/v2.0` }, { invite: (link.url as string).split("/invite/")[1] });
    expect(cb.headers.get("location")).toBe("/tracker");
    expect((await signIn({ oid: "oid-old" })).headers.get("location")).toBe("/signin?error=not_invited");
  });

  it("analysts can issue links for analyst and client accounts but not admins", async () => {
    const users = await json(call(w.a.analyst, "GET", "/api/users"));
    const admin = users.find((u: any) => u.role === "admin");
    const client = users.find((u: any) => u.role === "client");
    expect((await call(w.a.analyst, "POST", `/api/users/${admin.id}/invite`)).status).toBe(403);
    expect((await call(w.a.analyst, "POST", `/api/users/${client.id}/invite`)).status).toBe(201);
    expect((await call(w.a.client, "POST", `/api/users/${client.id}/invite`)).status).toBe(403);
  });

  it("reports the configuration in Administration → Deployment status", async () => {
    const st = await json(app.fetch(new Request(`${ORIGIN}/api/admin/config-status`, { headers: { "x-dev-user": w.a.admin } }), { ...env, ENTRA_CLIENT_ID: CLIENT_ID }, ctx));
    expect(st.checks.find((c: any) => c.key === "auth").ok).toBe(false); // dev mode in tests
  });
});
