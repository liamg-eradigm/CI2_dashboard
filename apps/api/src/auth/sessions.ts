/**
 * Server-side sessions (Microsoft sign-in mode).
 *
 *  - The browser holds a random 256-bit token in an HttpOnly, Secure,
 *    SameSite=Lax `__Host-` cookie; D1 stores only its SHA-256 hash.
 *  - Sessions end after SESSION_IDLE_MINUTES without activity (default 480) and
 *    at most SESSION_MAX_HOURS after sign-in (default 24).
 *  - "End sessions" and deactivation delete them immediately.
 *  - The short-lived sign-in state (state, nonce, PKCE verifier, return path,
 *    invite) travels in a separate cookie signed with SESSION_SECRET.
 */
import type { Env } from "../env.js";
import { sha256Hex, toHex } from "../lib/crypto.js";
import { nowIso } from "../lib/ids.js";
import { b64urlToBytes, bytesToB64url } from "./jwt.js";

export const SESSION_COOKIE = "__Host-eci_session";
export const SIGNIN_COOKIE = "__Host-eci_signin";

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

export const clearCookie = (name: string) => cookie(name, "", 0);

export function randomToken(bytes = 32): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return bytesToB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const idleMinutes = (env: Env) => num(env.SESSION_IDLE_MINUTES, 480);
export const maxHours = (env: Env) => num(env.SESSION_MAX_HOURS, 24);

// ---- signed sign-in state ---------------------------------------------------

export interface SignInState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  invite: string | null;
  exp: number;
}

/** HMAC-SHA256 keyed with the SESSION_SECRET text (any long random string). */
async function sign(env: Env, data: string): Promise<string> {
  const secret = env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function sealState(env: Env, s: SignInState): Promise<string> {
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify(s)));
  return `${payload}.${await sign(env, `signin:${payload}`)}`;
}

export async function openState(env: Env, raw: string | null): Promise<SignInState | null> {
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const expected = await sign(env, `signin:${payload}`);
  if (!timingSafeEqual(mac, expected)) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as SignInState;
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Only same-site paths inside the dashboard (never the API, never another origin). */
export function safeReturnPath(p: string | null | undefined): string {
  if (!p || !p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\") || p.startsWith("/api/") || p.length > 500) return "/dashboard";
  return p;
}

// ---- sessions -----------------------------------------------------------------

export async function createSession(env: Env, userId: string, userAgent: string | null): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + maxHours(env) * 3_600_000);
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?1, ?2, ?3, ?3, ?4, ?5)")
    .bind(await sha256Hex(token), userId, now.toISOString(), expires.toISOString(), (userAgent ?? "").slice(0, 200) || null)
    .run();
  return { token, maxAgeSeconds: maxHours(env) * 3600 };
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

/** Returns the live session for a cookie token, or null (expired, idle, ended). */
export async function lookupSession(env: Env, token: string): Promise<SessionRow | null> {
  const id = await sha256Hex(token);
  const s = await env.DB.prepare("SELECT id, user_id, created_at, last_seen_at, expires_at FROM sessions WHERE id = ?1").bind(id).first<SessionRow>();
  if (!s) return null;
  const now = Date.now();
  if (Date.parse(s.expires_at) <= now || Date.parse(s.last_seen_at) + idleMinutes(env) * 60_000 <= now) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run();
    return null;
  }
  // Sliding idle timeout, written at most once a minute to save D1 writes.
  if (Date.parse(s.last_seen_at) < now - 60_000) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ?1 WHERE id = ?2").bind(nowIso(), id).run();
  }
  return s;
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(await sha256Hex(token)).run();
}

export async function deleteUserSessions(env: Env, userId: string): Promise<number> {
  const r = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId).run();
  return r.meta.changes ?? 0;
}

export async function purgeExpiredSessions(env: Env): Promise<number> {
  const idleCutoff = new Date(Date.now() - idleMinutes(env) * 60_000).toISOString();
  const r = await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?1 OR last_seen_at <= ?2").bind(nowIso(), idleCutoff).run();
  return r.meta.changes ?? 0;
}
