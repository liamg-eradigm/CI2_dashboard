/**
 * Source capture pipeline (steps 1–5 of the Input pipeline).
 *
 *   0 Validate and normalise     – HTTP/HTTPS only, credentials rejected, tracking params stripped
 *   1 Destination check          – DNS resolved, every address public; re-checked after every redirect
 *   2 Isolated capture worker    – ≤ 5 redirects, ≤ 5 MB, ≤ 20 s, text/html only
 *   3 Access restrictions        – robots.txt, login walls, paywalls and bot challenges respected
 *   4 Content scan before storage– malware markers rejected; scripts, trackers and forms stripped
 */
import { CAPTURE_LIMITS, FILE_CAPTURE_STEPS, URL_CAPTURE_STEPS, checkAndNormaliseUrl, isAcceptedContentType } from "@eradigm/shared";
import { resolvePublic } from "./dns.js";
import { detectSingleFile } from "./extract.js";
import { isAllowed } from "./robots.js";
import { processHtml, type ProcessedHtml } from "./sanitize.js";
import type { CaptureFailure, CaptureFailureCode, CaptureResult, CaptureStep, CaptureSuccess } from "./types.js";

export const URL_STEP_LABELS = URL_CAPTURE_STEPS;
export const FILE_STEP_LABELS = FILE_CAPTURE_STEPS;

export interface CaptureOptions {
  fetcher: typeof fetch;
  resolverUrl: string;
  userAgent: string;
  now?: () => number;
}

class Stop extends Error {
  constructor(
    readonly code: CaptureFailureCode,
    message: string,
    readonly stepIndex: number,
    readonly retryable = false,
    readonly finalUrl: string | null = null,
  ) {
    super(message);
  }
}

const enc = new TextEncoder();

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : Uint8Array.from(data);
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function charsetOf(contentType: string | null, head: Uint8Array): string {
  const m = /charset=([\w-]+)/i.exec(contentType ?? "");
  if (m?.[1]) return m[1].toLowerCase();
  const sniff = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  return (/<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1] ?? "utf-8").toLowerCase();
}

/** Page bytes as UTF-8 for the HTML pass: UTF-8 bytes pass through untouched (no copy). */
function asUtf8Input(raw: Uint8Array, charset: string): string | Uint8Array {
  if (charset === "utf-8" || charset === "utf8" || charset === "us-ascii") return raw;
  try {
    return new TextDecoder(charset).decode(raw);
  } catch {
    return raw;
  }
}

/** The first part of the page as text, for the cheap header heuristics. */
function headText(input: string | Uint8Array, max = 400_000): string {
  return typeof input === "string" ? input.slice(0, max) : new TextDecoder().decode(input.subarray(0, max));
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new Stop("TOO_LARGE", `Response is ${Math.round(len / 1048576)} MB · limit is ${maxBytes / 1048576} MB`, 2);
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Stop("TOO_LARGE", `Response exceeds the ${maxBytes / 1048576} MB limit`, 2);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.byteLength;
  }
  return out;
}

/** Access-restriction heuristics: login walls, paywalls and bot challenges. */
export function detectRestriction(html: string, wordCount: number, passwordField = false): string | null {
  const h = html.slice(0, 400_000);
  if (/cf-browser-verification|challenge-platform|cf_chl_|<title>\s*(just a moment|attention required)|px-captcha|g-recaptcha|h-captcha|datadome|perimeterx/i.test(h)) {
    return "Bot challenge detected";
  }
  const shortPage = wordCount < 250;
  if (shortPage && (passwordField || /<input[^>]+type=["']?password/i.test(h))) return "Login wall detected";
  if (shortPage && /(subscribe|sign in|log in|register)\s+(now\s+)?to\s+(continue|read|keep reading|view)|this (article|content) is (only )?(available )?(for|to) (subscribers|members)|paywall|piano-offer|tp-modal|metered-content/i.test(h)) {
    return "Paywall detected";
  }
  return null;
}

/** Checks a URL (initial, redirect target or browser subrequest) against policy + DNS. Returns a reason when blocked. */
export async function guardUrl(url: string, opts: Pick<CaptureOptions, "fetcher" | "resolverUrl">): Promise<string | null> {
  const c = checkAndNormaliseUrl(url);
  if (!c.ok) return c.reason;
  const r = await resolvePublic(c.host, { resolverUrl: opts.resolverUrl, fetcher: opts.fetcher });
  return r.ok ? null : `Blocked · ${r.reason}`;
}

async function robotsAllows(origin: string, path: string, opts: CaptureOptions): Promise<{ allowed: boolean; detail: string }> {
  try {
    const res = await opts.fetcher(`${origin}/robots.txt`, {
      redirect: "follow",
      headers: { "user-agent": opts.userAgent },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status >= 500) return { allowed: false, detail: `robots.txt unavailable (${res.status}) · treated as disallow` };
    if (!res.ok) return { allowed: true, detail: "no robots.txt" };
    const txt = new TextDecoder().decode(await readLimited(res, 512 * 1024));
    return isAllowed(txt, opts.userAgent, path)
      ? { allowed: true, detail: "robots.txt permits" }
      : { allowed: false, detail: "robots.txt disallows this path for our crawler" };
  } catch {
    return { allowed: true, detail: "robots.txt not reachable · no restriction assumed" };
  }
}

function fail(e: Stop, steps: CaptureStep[], labels: readonly string[]): CaptureFailure {
  const out = [...steps];
  out[e.stepIndex] = { label: labels[e.stepIndex] ?? "Capture", ok: false, detail: e.message };
  return { ok: false, code: e.code, message: e.message, retryable: e.retryable, stepIndex: e.stepIndex, steps: out.slice(0, e.stepIndex + 1), finalUrl: e.finalUrl };
}

export async function captureUrl(input: string, opts: CaptureOptions): Promise<CaptureResult> {
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const steps: CaptureStep[] = [];
  const L = URL_STEP_LABELS;
  try {
    // 0. Validate and normalise
    const c = checkAndNormaliseUrl(input);
    if (!c.ok) throw new Stop(c.stage === "validate" ? "URL_REJECTED" : c.stage === "content_type" ? "CONTENT_TYPE" : "DESTINATION_BLOCKED", c.reason, c.stage === "destination" ? 1 : c.stage === "content_type" ? 2 : 0);
    steps.push({ label: L[0], ok: true, detail: `Normalised to ${c.url}${c.notes.length ? ` · ${c.notes.join(", ")}` : ""}` });

    // 1. Destination check (DNS)
    const dns = await resolvePublic(c.host, { resolverUrl: opts.resolverUrl, fetcher: opts.fetcher });
    if (!dns.ok) throw new Stop(dns.reason?.startsWith("DNS") || dns.reason === "Host does not resolve" ? "DNS_FAILED" : "DESTINATION_BLOCKED", `Blocked · ${dns.reason}`, 1, dns.reason?.startsWith("DNS lookup failed") ?? false);
    steps.push({ label: L[1], ok: true, detail: "Public host · DNS resolved to a public address · re-checked after every redirect" });

    // Robots is evaluated before retrieval but reported under Access restrictions.
    const first = new URL(c.url);
    const robots = await robotsAllows(first.origin, first.pathname + first.search, opts);
    if (!robots.allowed) {
      steps.push({ label: L[2], ok: true, detail: "Retrieval withheld until access rules were checked" });
      throw new Stop("ROBOTS_DISALLOWED", `Stopped · ${robots.detail} · not bypassed`, 3, false, c.url);
    }

    // 2. Isolated capture
    let redirects = 0;
    let contentType = "text/html";
    const t0 = now();
    let url = c.url;
    let res: Response;
    for (;;) {
      try {
        res = await opts.fetcher(url, {
          redirect: "manual",
          headers: { "user-agent": opts.userAgent, accept: "text/html,application/xhtml+xml;q=0.9", "accept-language": "en" },
          signal: AbortSignal.timeout(CAPTURE_LIMITS.pageLoadMs),
        });
      } catch (err) {
        const name = (err as Error).name;
        if (name === "TimeoutError" || name === "AbortError") throw new Stop("TIMEOUT", `Page did not load within ${CAPTURE_LIMITS.pageLoadMs / 1000} s`, 2, true);
        throw new Stop("NETWORK", "Could not connect to the source", 2, true);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        redirects++;
        if (redirects > CAPTURE_LIMITS.maxRedirects) throw new Stop("TOO_MANY_REDIRECTS", `More than ${CAPTURE_LIMITS.maxRedirects} redirects`, 2, false, url);
        const next = new URL(res.headers.get("location") as string, url).toString();
        const blocked = await guardUrl(next, opts);
        if (blocked) throw new Stop("DESTINATION_BLOCKED", `Redirect ${redirects} ${blocked}`, 1, false, next);
        const nu = new URL(next);
        if (nu.origin !== new URL(url).origin) {
          const rb = await robotsAllows(nu.origin, nu.pathname + nu.search, opts);
          if (!rb.allowed) throw new Stop("ROBOTS_DISALLOWED", `Stopped · redirect target ${rb.detail}`, 3, false, next);
        }
        url = next;
        continue;
      }
      break;
    }
    const finalUrl = url;
    const status = res.status;
    contentType = res.headers.get("content-type") ?? "";
    if (status === 401 || status === 403 || status === 407) {
      throw new Stop("ACCESS_RESTRICTED", "Login required or access denied · capture stopped without bypass. Save the page with SingleFile in your own browser and upload the HTML.", 3, false, finalUrl);
    }
    if (status === 402) throw new Stop("ACCESS_RESTRICTED", "Paywall (HTTP 402) · capture stopped without bypass. Upload a SingleFile HTML saved in your own browser.", 3, false, finalUrl);
    if (status === 451) throw new Stop("ACCESS_RESTRICTED", "Unavailable for legal reasons (HTTP 451)", 3, false, finalUrl);
    if (status === 429) throw new Stop("HTTP_ERROR", "The source is rate limiting requests (HTTP 429) · retry later", 2, true, finalUrl);
    if (status >= 500) throw new Stop("HTTP_ERROR", `The source returned HTTP ${status}`, 2, true, finalUrl);
    if (status >= 400) throw new Stop("HTTP_ERROR", `The source returned HTTP ${status}`, 2, false, finalUrl);
    if (!isAcceptedContentType(contentType)) throw new Stop("CONTENT_TYPE", `Content type ${contentType.split(";")[0] || "unknown"} not accepted · text/html only`, 2, false, finalUrl);
    const raw = await readLimited(res, CAPTURE_LIMITS.maxBytes);
    const pageInput = asUtf8Input(raw, charsetOf(contentType, raw));
    const secs = ((now() - t0) / 1000).toFixed(1);
    const kb = Math.round(raw.byteLength / 1024);
    const engine = "Sandboxed fetch worker (no DB/secret access)";
    steps.push({
      label: L[2],
      ok: true,
      detail: `${engine} · ${redirects} redirect(s) of ${CAPTURE_LIMITS.maxRedirects} max · ${kb} KB of ${CAPTURE_LIMITS.maxBytes / 1048576} MB max · ${secs} s of ${CAPTURE_LIMITS.pageLoadMs / 1000} s max · text/html`,
    });

    // 3. Access restrictions (one native pass also scans, sanitises and extracts)
    const page: ProcessedHtml = await processHtml(pageInput, finalUrl);
    const { article, scan } = page;
    const head = headText(pageInput);
    const restriction = detectRestriction(head, article.wordCount, page.passwordField);
    if (restriction) {
      throw new Stop("ACCESS_RESTRICTED", `${restriction} · capture stopped without bypass. Save the page with SingleFile in your own browser and upload the HTML.`, 3, false, finalUrl);
    }
    const warnings: string[] = [];
    if (page.noarchive) warnings.push("Page requests noarchive · snapshot kept for internal review only");
    steps.push({ label: L[3], ok: true, detail: `${robots.detail} · no login wall, paywall or bot challenge detected` });

    // 4. Content scan + sanitise
    if (scan.malicious) throw new Stop("MALICIOUS_CONTENT", `Content scan failed · ${scan.reasons.join(", ")}`, 4, false, finalUrl);
    steps.push({
      label: L[4],
      ok: true,
      detail: `No malware signatures · ${scan.scriptsRemoved} script(s)/tracker(s), ${scan.formsRemoved} form control(s), ${scan.framesRemoved} frame(s) and ${scan.handlersRemoved} handler(s) stripped · snapshot stored immutably`,
    });
    if (article.wordCount < 40) warnings.push("Very little article text was extracted · check the source");
    if (article.truncated) warnings.push("Article text was longer than the extraction limit and was truncated");

    const success: CaptureSuccess = {
      ok: true,
      html: page.html,
      rawSha256: await sha256Hex(raw),
      rawBytes: raw.byteLength,
      contentType: contentType.split(";")[0] || "text/html",
      httpStatus: status,
      finalUrl,
      redirects,
      method: "fetch",
      article,
      singleFile: detectSingleFile(head),
      scan,
      warnings,
      steps,
      durationMs: now() - started,
    };
    return success;
  } catch (err) {
    if (err instanceof Stop) return fail(err, steps, L);
    return fail(new Stop("NETWORK", "Unexpected capture error", Math.min(steps.length, 4), true), steps, L);
  }
}

/** Parse an analyst-uploaded HTML file (e.g. saved with SingleFile). No network access. */
export async function parseUpload(file: Uint8Array, fileName: string): Promise<CaptureResult> {
  const bytes = file.byteLength;
  const started = Date.now();
  const L = FILE_STEP_LABELS;
  const steps: CaptureStep[] = [];
  try {
    if (!/\.html?$/i.test(fileName)) throw new Stop("CONTENT_TYPE", "Only .html or .htm files are accepted", 0);
    if (bytes > CAPTURE_LIMITS.maxBytes) throw new Stop("TOO_LARGE", `File exceeds the ${CAPTURE_LIMITS.maxBytes / 1048576} MB limit`, 0);
    const input = asUtf8Input(file, charsetOf(null, file));
    const head = headText(input);
    if (!/<(html|body|head|p|div|article)\b/i.test(head.slice(0, 200_000))) throw new Stop("CONTENT_TYPE", "The file does not look like an HTML page", 0);
    const sf = detectSingleFile(head);
    steps.push({ label: L[0], ok: true, detail: `${fileName} · ${Math.round(bytes / 1024)} KB of ${CAPTURE_LIMITS.maxBytes / 1048576} MB max · text/html${sf.detected ? " · SingleFile snapshot detected" : ""}` });

    let sourceUrl: string | null = null;
    if (sf.sourceUrl) {
      const chk = checkAndNormaliseUrl(sf.sourceUrl);
      sourceUrl = chk.ok ? chk.url : null;
      steps.push({ label: L[1], ok: true, detail: chk.ok ? `Original URL from SingleFile metadata: ${chk.url}` : `SingleFile URL not used (${chk.reason})` });
    } else {
      steps.push({ label: L[1], ok: true, detail: "No source URL in file · analyst to confirm in Inbox" });
    }
    const page = await processHtml(input, sourceUrl);
    const { article, scan } = page;
    steps.push({ label: L[2], ok: true, detail: "Parsed in sandboxed worker · no network fetch performed" });
    steps.push({ label: L[3], ok: true, detail: "Saved by the analyst in their own authenticated browser · nothing bypassed" });
    if (scan.malicious) throw new Stop("MALICIOUS_CONTENT", `Content scan failed · ${scan.reasons.join(", ")}`, 4);
    steps.push({
      label: L[4],
      ok: true,
      detail: `No malware signatures · ${scan.scriptsRemoved} embedded script(s) stripped · snapshot stored immutably`,
    });
    const warnings: string[] = [];
    if (article.wordCount < 40) warnings.push("Very little article text was extracted · check the file");
    if (article.truncated) warnings.push("Article text was longer than the extraction limit and was truncated");
    return {
      ok: true,
      html: page.html,
      rawSha256: await sha256Hex(file),
      rawBytes: bytes,
      contentType: "text/html",
      httpStatus: null,
      finalUrl: sourceUrl,
      redirects: 0,
      method: "upload",
      article,
      singleFile: sf,
      scan,
      warnings,
      steps,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    if (err instanceof Stop) return fail(err, steps, L);
    return fail(new Stop("NETWORK", "Unexpected parse error", Math.min(steps.length, 4)), steps, L);
  }
}
