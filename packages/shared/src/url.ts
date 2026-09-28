/**
 * URL input policy (2_Input_Architecture, "input security features").
 *
 *  - HTTP/HTTPS only; embedded credentials rejected.
 *  - Normalise: add a scheme if missing, lower-case host, strip fragment and
 *    tracking parameters, sort remaining query parameters.
 *  - Block private, loopback, link-local, metadata-service, CGNAT, multicast,
 *    reserved, documentation, IPv6 ULA/link-local/loopback, IPv4-mapped and
 *    internal hostnames. The API re-checks after DNS resolution and after
 *    every redirect.
 */

export const CAPTURE_LIMITS = {
  maxRedirects: 5,
  // 5 MB keeps parsing within the Workers Free plan CPU budget.
  maxBytes: 5 * 1024 * 1024,
  pageLoadMs: 20_000,
  jobMs: 30_000,
  acceptedContentTypes: ["text/html", "application/xhtml+xml"],
  allowedPorts: ["", "80", "443"],
} as const;

const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_.*|igshid|ref|ref_src|_hsenc|_hsmi|yclid|oly_.*|vero_.*)$/i;
const BLOCKED_EXTENSIONS = /\.(pdf|zip|gz|tar|rar|7z|exe|msi|dmg|pkg|apk|iso|docx?|xlsx?|pptx?|mp[34]|mov|avi|mkv|wav|png|jpe?g|gif|webp|svg|bin)$/i;

export type UrlCheck =
  | { ok: true; url: string; host: string; notes: string[] }
  | { ok: false; stage: "validate" | "destination" | "content_type"; code: string; reason: string; url?: string };

/** Classify an IP literal. Returns a reason when the address must not be fetched. */
export function blockedIpReason(ip: string): string | null {
  const v4 = parseIPv4(ip);
  if (v4) return blockedV4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return blockedV6(v6);
  return null;
}

export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return parseIPv4(h) !== null || parseIPv6(h) !== null;
}

function blockedV4([a, b, c]: number[]): string | null {
  if (a === undefined || b === undefined || c === undefined) return "invalid address";
  if (a === 0) return "unspecified address";
  if (a === 10) return "private network address";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT range";
  if (a === 127) return "loopback address";
  if (a === 169 && b === 254) return "link-local / cloud metadata service";
  if (a === 172 && b >= 16 && b <= 31) return "private network address";
  if (a === 192 && b === 0 && c === 0) return "IETF protocol assignment range";
  if (a === 192 && b === 0 && c === 2) return "documentation range";
  if (a === 192 && b === 88 && c === 99) return "6to4 relay range";
  if (a === 192 && b === 168) return "private network address";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking range";
  if (a === 198 && b === 51 && c === 100) return "documentation range";
  if (a === 203 && b === 0 && c === 113) return "documentation range";
  if (a >= 224 && a <= 239) return "multicast range";
  if (a >= 240) return "reserved range";
  return null;
}

function blockedV6(w: number[]): string | null {
  const [w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0] = w;
  const allZeroTo = (n: number) => w.slice(0, n).every((x) => x === 0);
  if (allZeroTo(8)) return "IPv6 unspecified address";
  if (allZeroTo(7) && w7 === 1) return "IPv6 loopback";
  if (allZeroTo(5) && w5 === 0xffff) {
    const inner = blockedV4([w6 >> 8, w6 & 255, w7 >> 8, w7 & 255]);
    return `IPv4-mapped address${inner ? ` (${inner})` : ""}`;
  }
  if (allZeroTo(6)) return "IPv4-compatible address";
  if (w0 === 0x64 && w1 === 0xff9b) return "NAT64 address";
  if ((w0 & 0xfe00) === 0xfc00) return "IPv6 private range (ULA)";
  if ((w0 & 0xffc0) === 0xfe80) return "IPv6 link-local";
  if ((w0 & 0xffc0) === 0xfec0) return "IPv6 site-local";
  if ((w0 & 0xff00) === 0xff00) return "IPv6 multicast";
  if (w0 === 0x2001 && w1 === 0x0db8) return "IPv6 documentation range";
  if (w0 === 0x2001 && w1 === 0) return "Teredo tunnelling address";
  if (w0 === 0x2002) return "6to4 address";
  if (w0 === 0x0100 && w1 === 0 && w2 === 0 && w3 === 0) return "IPv6 discard range";
  void w4;
  return null;
}

export function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

export function parseIPv6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, "").toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return null;
  // Embedded IPv4 tail.
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = parseIPv4(maybeV4);
    if (!v4) return null;
    tail = [((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0)];
    s = s.slice(0, lastColon + 1) + "0:0";
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (x: string) => (x === "" ? [] : x.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)));
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  let words: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    words = [...head, ...new Array(fill).fill(0), ...rest];
  } else {
    words = head;
  }
  if (words.length !== 8) return null;
  if (tail.length) words.splice(6, 2, ...tail);
  return words;
}

/** Hostname rules applied before any DNS lookup. */
export function blockedHostReason(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  const bare = h.replace(/^\[|\]$/g, "");
  if (isIpLiteral(bare)) return blockedIpReason(bare);
  if (!h) return "missing hostname";
  if (/^(localhost|metadata|metadata\.google\.internal|instance-data|kubernetes|kubernetes\.default)$/.test(h)) {
    return "internal or reserved hostname";
  }
  if (/\.(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain|test|invalid|example|onion)$/.test(h)) {
    return "internal or reserved hostname";
  }
  if (!h.includes(".")) return "single-label (intranet) hostname";
  if (!/^[a-z0-9.-]+$/.test(h) && !h.startsWith("xn--")) {
    // Hostnames are punycoded by the URL parser; anything else is suspicious.
    return "invalid hostname";
  }
  return null;
}

/** Validate and normalise a user-supplied URL. Performs no network access. */
export function checkAndNormaliseUrl(raw: string): UrlCheck {
  let s = (raw ?? "").trim();
  if (!s) return { ok: false, stage: "validate", code: "EMPTY", reason: "Enter a URL to capture." };
  if (s.length > 2048) return { ok: false, stage: "validate", code: "TOO_LONG", reason: "URL is longer than 2048 characters" };
  const notes: string[] = [];
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    s = `https://${s}`;
    notes.push("added https://");
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, stage: "validate", code: "INVALID", reason: "Not a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return {
      ok: false,
      stage: "validate",
      code: "SCHEME",
      reason: `Scheme “${u.protocol.replace(":", "")}” rejected · only HTTP and HTTPS are accepted`,
    };
  }
  if (u.username || u.password) {
    return { ok: false, stage: "validate", code: "CREDENTIALS", reason: "Embedded credentials are not accepted" };
  }
  if (!(CAPTURE_LIMITS.allowedPorts as readonly string[]).includes(u.port)) {
    return { ok: false, stage: "destination", code: "PORT", reason: `Blocked · non-standard port ${u.port}` };
  }
  if (u.hash) {
    u.hash = "";
    notes.push("fragment removed");
  }
  const drop = [...new Set([...u.searchParams.keys()].filter((k) => TRACKING_PARAM.test(k)))];
  drop.forEach((k) => u.searchParams.delete(k));
  if (drop.length) notes.push(`${drop.length} tracking parameter${drop.length > 1 ? "s" : ""} removed`);
  u.searchParams.sort();
  const host = u.hostname;
  const hb = blockedHostReason(host);
  if (hb) return { ok: false, stage: "destination", code: "BLOCKED_HOST", reason: `Blocked · ${hb} (${host})`, url: u.href };
  if (BLOCKED_EXTENSIONS.test(u.pathname)) {
    return { ok: false, stage: "content_type", code: "CONTENT_TYPE", reason: "Content type not accepted · text/html only", url: u.href };
  }
  return { ok: true, url: u.href, host, notes };
}

/** Normalised form used for duplicate detection: scheme-insensitive, no trailing slash, no "www.". */
export function dedupeKey(normalisedUrl: string): string {
  const u = new URL(normalisedUrl);
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${host}${path}${u.search}`;
}

export function isAcceptedContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (CAPTURE_LIMITS.acceptedContentTypes as readonly string[]).includes(base);
}
