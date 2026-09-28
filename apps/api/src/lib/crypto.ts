const enc = new TextEncoder();

/** Byte arrays backed by a plain ArrayBuffer (what WebCrypto accepts). */
type Bytes = Uint8Array<ArrayBuffer>;
const bytesOf = (b: ArrayBuffer | Uint8Array): Bytes => (b instanceof Uint8Array ? new Uint8Array(b) : new Uint8Array(b));

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes: Bytes = bytesOf(typeof data === "string" ? enc.encode(data) : data);
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

// Native base64 (Uint8Array.prototype.toBase64 / Uint8Array.fromBase64) is
// ~80x faster than a JavaScript loop — it matters for multi-MB snapshots under
// the Workers Free plan CPU limit. The loops are fallbacks for older runtimes.
type NativeB64 = { toBase64?: () => string };
type NativeFromB64 = { fromBase64?: (s: string) => Uint8Array<ArrayBuffer> };

export function bytesToB64(b: Uint8Array): string {
  const native = (b as unknown as NativeB64).toBase64;
  if (typeof native === "function") return native.call(b);
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function b64ToBytes(b64: string): Bytes {
  const native = (Uint8Array as unknown as NativeFromB64).fromBase64;
  if (typeof native === "function") return native(b64.trim());
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hmacHex(keyB64: string | undefined, data: string): Promise<string> {
  if (!keyB64) return sha256Hex(data);
  const key = await crypto.subtle.importKey("raw", b64ToBytes(keyB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function aesKey(keyB64: string): Promise<CryptoKey> {
  let k = keyCache.get(keyB64);
  if (!k) {
    const raw = b64ToBytes(keyB64);
    if (raw.length !== 32) throw new Error("SNAPSHOT_ENCRYPTION_KEY must be 32 bytes (base64)");
    k = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(keyB64, k);
  }
  return k;
}

/** AES-256-GCM: output = 12-byte IV || ciphertext+tag. */
export async function encryptBytes(keyB64: string, plain: Uint8Array): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), bytesOf(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(keyB64: string, data: Uint8Array): Promise<Bytes> {
  const b = bytesOf(data);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, await aesKey(keyB64), b.slice(12)));
}

/** Deterministic JSON (sorted keys) for hashing. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}
