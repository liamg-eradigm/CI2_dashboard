/**
 * Cloudflare Access JWT verification.
 *
 * Cloudflare Access (with the organisation's identity provider, e.g. Microsoft
 * Entra ID) is the trusted sign-in service: it handles passwords/MFA, login
 * attempt limits and account recovery. Access injects a signed JWT in the
 * `Cf-Access-Jwt-Assertion` header; the API verifies the signature, issuer,
 * audience and expiry on every request and never trusts the dashboard to
 * assert identity.
 */
export interface AccessIdentity {
  email: string;
  name: string | null;
  subject: string;
  issuedAt: number;
  expiresAt: number;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { domain: string; at: number; keys: Map<string, CryptoKey> } | null = null;

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as T;
}

async function loadKeys(teamDomain: string, fetcher: typeof fetch, force = false): Promise<Map<string, CryptoKey>> {
  if (!force && jwksCache && jwksCache.domain === teamDomain && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Could not load Access signing keys (${res.status})`);
  const body = (await res.json()) as { keys: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of body.keys ?? []) {
    if (k.kty !== "RSA") continue;
    keys.set(
      k.kid,
      await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
        "verify",
      ]),
    );
  }
  jwksCache = { domain: teamDomain, at: Date.now(), keys };
  return keys;
}

export class AccessVerificationError extends Error {}

export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; audience: string; fetcher?: typeof fetch; now?: number },
): Promise<AccessIdentity> {
  const fetcher = opts.fetcher ?? fetch;
  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessVerificationError("Malformed token");
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson<{ alg: string; kid: string }>(h);
  if (header.alg !== "RS256") throw new AccessVerificationError("Unsupported token algorithm");
  let keys = await loadKeys(opts.teamDomain, fetcher);
  let key = keys.get(header.kid);
  if (!key) {
    keys = await loadKeys(opts.teamDomain, fetcher, true); // key rotation
    key = keys.get(header.kid);
  }
  if (!key) throw new AccessVerificationError("Unknown signing key");
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new AccessVerificationError("Invalid token signature");

  const claims = decodeJson<{ aud?: string | string[]; iss?: string; exp?: number; nbf?: number; iat?: number; email?: string; sub?: string; name?: string; identity_nonce?: string }>(p);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!aud.includes(opts.audience)) throw new AccessVerificationError("Token audience mismatch");
  if (claims.iss !== `https://${opts.teamDomain}`) throw new AccessVerificationError("Token issuer mismatch");
  if (!claims.exp || claims.exp < now - 30) throw new AccessVerificationError("Token expired");
  if (claims.nbf && claims.nbf > now + 30) throw new AccessVerificationError("Token not yet valid");
  if (!claims.email) throw new AccessVerificationError("Token has no email (service tokens are not accepted)");
  return {
    email: claims.email.toLowerCase(),
    name: claims.name ?? null,
    subject: claims.sub ?? claims.email,
    issuedAt: claims.iat ?? now,
    expiresAt: claims.exp,
  };
}

/** Test hook: reset the JWKS cache. */
export function _resetJwksCache(): void {
  jwksCache = null;
}
