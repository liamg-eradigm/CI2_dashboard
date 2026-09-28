/**
 * Sign-in with Microsoft Entra ID (OpenID Connect authorization-code flow with
 * PKCE), accepting work or school accounts from ANY organisation
 * (the "organizations" authority).
 *
 * Microsoft is the trusted sign-in service: passwords, MFA, lockouts after
 * failed attempts and account recovery are handled by each user's own
 * organisation. This system never sees or stores a password.
 *
 * Configuration (see docs/SIGN-IN-ENTRA.md):
 *   ENTRA_CLIENT_ID        secret  Application (client) ID of the app registration
 *   ENTRA_CLIENT_SECRET    secret  Client secret VALUE of the app registration
 *   ENTRA_ALLOWED_TENANTS  secret  optional, comma-separated Directory (tenant) IDs;
 *                                  when set, only those organisations may sign in
 *   APP_ORIGIN             var     public address of the dashboard, e.g. https://ci.eradigm.com
 */
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { TokenError, verifyRs256 } from "./jwt.js";

export const ENTRA_AUTHORITY = "https://login.microsoftonline.com/organizations";
const AUTHORIZE_URL = `${ENTRA_AUTHORITY}/oauth2/v2.0/authorize`;
const TOKEN_URL = `${ENTRA_AUTHORITY}/oauth2/v2.0/token`;
const JWKS_URL = `${ENTRA_AUTHORITY}/discovery/v2.0/keys`;
const LOGOUT_URL = `${ENTRA_AUTHORITY}/oauth2/v2.0/logout`;
/** Tenant id Microsoft uses for personal (consumer) accounts, which are not accepted. */
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let testFetcher: typeof fetch | null = null;
/** Test hook: route calls to Microsoft through a fake. */
export function setEntraFetcher(f: typeof fetch | null): void {
  testFetcher = f;
}
const net = (): typeof fetch => testFetcher ?? fetch;

export interface EntraIdentity {
  tid: string;
  oid: string;
  email: string | null;
  name: string | null;
}

function placeholder(v: string | undefined): boolean {
  return !v || /^(REPLACE|PASTE|YOUR)_/i.test(v.trim());
}

export function entraConfigured(env: Env): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (placeholder(env.ENTRA_CLIENT_ID)) missing.push("ENTRA_CLIENT_ID");
  if (placeholder(env.ENTRA_CLIENT_SECRET)) missing.push("ENTRA_CLIENT_SECRET");
  if (placeholder(env.SESSION_SECRET)) missing.push("SESSION_SECRET");
  if (placeholder(env.APP_ORIGIN) || !/^https?:\/\/[^/]+$/.test(env.APP_ORIGIN ?? "")) missing.push("APP_ORIGIN");
  return { ok: missing.length === 0, missing };
}

export function requireEntra(env: Env): void {
  const c = entraConfigured(env);
  if (!c.ok) throw new ApiError("MISCONFIGURED", `Microsoft sign-in is not configured for this environment (missing: ${c.missing.join(", ")}). See docs/SIGN-IN-ENTRA.md.`);
}

export const redirectUri = (env: Env) => `${env.APP_ORIGIN.replace(/\/$/, "")}/api/auth/callback`;

export function allowedTenants(env: Env): string[] {
  return (env.ENTRA_ALLOWED_TENANTS ?? "")
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => GUID.test(t));
}

export function authorizeUrl(env: Env, p: { state: string; nonce: string; codeChallenge: string; loginHint?: string }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("client_id", env.ENTRA_CLIENT_ID as string);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri(env));
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export function logoutUrl(env: Env): string {
  const u = new URL(LOGOUT_URL);
  u.searchParams.set("post_logout_redirect_uri", `${env.APP_ORIGIN.replace(/\/$/, "")}/api/auth/signed-out`);
  return u.toString();
}

export class SignInError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Exchange the authorization code and validate the ID token. */
export async function redeemCode(env: Env, code: string, codeVerifier: string, expectedNonce: string, nowMs = Date.now()): Promise<EntraIdentity> {
  const res = await net()(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID as string,
      client_secret: env.ENTRA_CLIENT_SECRET as string,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(env),
      code_verifier: codeVerifier,
      scope: "openid profile email",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.id_token) {
    // e.g. invalid_client (wrong or expired client secret), invalid_grant (reused/expired code)
    throw new SignInError(body.error === "invalid_client" ? "config" : "token", `Microsoft rejected the sign-in (${body.error ?? res.status})`);
  }
  let claims: { aud?: string; iss?: string; tid?: string; oid?: string; nonce?: string; exp?: number; nbf?: number; iat?: number; email?: string; preferred_username?: string; name?: string; ver?: string };
  try {
    claims = await verifyRs256(body.id_token, JWKS_URL, net());
  } catch (err) {
    if (err instanceof TokenError) throw new SignInError("token", err.message);
    throw err;
  }
  const now = Math.floor(nowMs / 1000);
  const tid = (claims.tid ?? "").toLowerCase();
  if (claims.aud !== env.ENTRA_CLIENT_ID) throw new SignInError("token", "ID token audience mismatch");
  if (!GUID.test(tid) || claims.iss !== `https://login.microsoftonline.com/${claims.tid}/v2.0`) throw new SignInError("token", "ID token issuer mismatch");
  if (!claims.exp || claims.exp < now - 60) throw new SignInError("token", "ID token expired");
  if (claims.nbf && claims.nbf > now + 60) throw new SignInError("token", "ID token not yet valid");
  if (!claims.nonce || claims.nonce !== expectedNonce) throw new SignInError("token", "ID token nonce mismatch");
  if (!claims.oid) throw new SignInError("token", "ID token has no object id");
  if (tid === CONSUMER_TENANT) throw new SignInError("consumer", "Personal Microsoft accounts are not accepted");
  const allow = allowedTenants(env);
  // Fail closed: a non-empty setting without any valid tenant id (a typo) allows nobody.
  const restricted = (env.ENTRA_ALLOWED_TENANTS ?? "").trim() !== "";
  if (restricted && !allow.includes(tid)) throw new SignInError("tenant", "This organisation is not allowed to sign in");
  const email = (claims.email ?? claims.preferred_username ?? "").toLowerCase() || null;
  return { tid, oid: claims.oid.toLowerCase(), email, name: claims.name ?? null };
}
