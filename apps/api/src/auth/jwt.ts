/**
 * RS256 JSON Web Token signature verification against a JWKS endpoint
 * (Microsoft Entra ID publishes its signing keys this way). Claims are
 * checked by the caller (entra.ts).
 */
interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; keys: Map<string, CryptoKey> }>();

export class TokenError extends Error {}

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i] as number);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJson<T>(part: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as T;
  } catch {
    throw new TokenError("Malformed token");
  }
}

async function loadKeys(url: string, fetcher: typeof fetch, force: boolean): Promise<Map<string, CryptoKey>> {
  const hit = cache.get(url);
  if (!force && hit && Date.now() - hit.at < JWKS_TTL_MS) return hit.keys;
  const res = await fetcher(url);
  if (!res.ok) throw new TokenError(`Could not load signing keys (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of body.keys ?? []) {
    if (k.kty !== "RSA" || !k.kid) continue;
    keys.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  cache.set(url, { at: Date.now(), keys });
  return keys;
}

/** Verifies the signature and returns the claims (unchecked). */
export async function verifyRs256<T>(token: string, jwksUrl: string, fetcher: typeof fetch = fetch): Promise<T> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenError("Malformed token");
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson<{ alg?: string; kid?: string }>(h);
  if (header.alg !== "RS256" || !header.kid) throw new TokenError("Unsupported token algorithm");
  let key = (await loadKeys(jwksUrl, fetcher, false)).get(header.kid);
  if (!key) key = (await loadKeys(jwksUrl, fetcher, true)).get(header.kid); // key rotation
  if (!key) throw new TokenError("Unknown signing key");
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new TokenError("Invalid token signature");
  return decodeJson<T>(p);
}

/** Test hook. */
export function _resetJwksCache(): void {
  cache.clear();
}
