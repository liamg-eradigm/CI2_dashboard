/** Time-ordered, URL-safe identifiers (ULID-like: 48-bit time + 80-bit randomness). */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function newId(prefix: string): string {
  let t = Date.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let r = "";
  for (let i = 0; i < 16; i++) r += ALPHABET[(rand[i] ?? 0) % 32];
  return `${prefix}_${time}${r}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
