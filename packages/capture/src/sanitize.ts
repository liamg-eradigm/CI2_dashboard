/**
 * Content scan, sanitisation and article extraction in ONE streaming pass
 * over the page with the Workers runtime's native HTMLRewriter.
 *
 * Why HTMLRewriter, and why so few handlers: the Cloudflare Workers Free plan
 * allows about 10 ms of CPU per invocation. Building a DOM in JavaScript
 * (linkedom + Readability) costs 100–400 ms for a typical news page. The
 * native parser alone costs ~2 ms for a 500 KB page, but every JavaScript
 * callback costs ~10 µs, so handlers are attached ONLY to the few elements
 * that matter (metadata, removable elements, risky attributes) — never to
 * every element or text chunk. Body text (used for duplicate detection, and as
 * LLM input if automatic pre-fill is enabled) is taken from the main content
 * area with native regular expressions, which is not security-relevant: the
 * stored copy is sanitised by the parser.
 *
 *  - Rejects content with known malware markers (EICAR test signature,
 *    embedded Windows executables / installers in data: URIs).
 *  - Strips scripts, trackers, form controls, frames, plugins, event handlers,
 *    javascript: URLs, meta refresh and <base>, and adds a strict
 *    Content-Security-Policy <meta> so the stored copy stays inert even when an
 *    analyst downloads it and opens it outside the app.
 *  - Extracts headline, body text, publication date, outlet and byline from
 *    Open Graph / schema.org / <time> metadata and the main content area.
 *
 * The snapshot is additionally served to browsers with a sandboxing CSP.
 * This heuristic scan is not a substitute for an antivirus engine.
 */
import { decodeEntities } from "./entities.js";
import type { Article, ScanResult } from "./types.js";

export const MAX_BODY_CHARS = 60_000;

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const EXEC_DATA_URI_RE = /data:(?:application\/(?:x-msdownload|x-msdos-program|x-dosexec|vnd\.microsoft\.portable-executable|x-sh|java-archive|x-msi|hta)|text\/x-shellscript)[;,]/i;
const PE_BASE64_RE = /base64,\s*TV(?:qQ|pQ|oA|pB)AA/;

/** Keeps the saved copy inert wherever it is opened (also from disk after a download). */
export const SNAPSHOT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:; form-action 'none'; base-uri 'none'";
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${SNAPSHOT_CSP}">`;

const REMOVE: Record<string, "scripts" | "forms" | "frames" | "links" | "other"> = {
  script: "scripts",
  noscript: "scripts",
  input: "forms",
  button: "forms",
  select: "forms",
  textarea: "forms",
  iframe: "frames",
  frame: "frames",
  frameset: "frames",
  object: "frames",
  embed: "frames",
  applet: "frames",
  portal: "frames",
  base: "other",
  link: "links",
  "meta[http-equiv]": "other",
};

/**
 * Inline event handlers stripped from the copy. Every script (inline handlers
 * included) is already blocked by the sandboxed viewer and by the CSP <meta>
 * added below, so this is defence in depth; the list covers the handlers seen
 * in real pages because each extra attribute selector costs parser time.
 */
const EVENT_ATTRS = (
  "click dblclick load error mouseover mouseout mouseenter mouseleave mousedown mouseup mousemove focus blur change input submit reset keydown keyup keypress " +
  "scroll resize unload beforeunload pageshow toggle animationstart animationend transitionend pointerdown pointerup touchstart wheel contextmenu"
)
  .split(" ")
  .map((e) => `[on${e}]`);

/**
 * URL attributes that may run script (javascript:, vbscript:, HTML/SVG data
 * URLs), including entity- or whitespace-obfuscated forms; the handler decodes
 * and decides. Executable data: payloads are caught by scanForMalware.
 */
const URL_SUSPECTS = ["href", "src", "action", "formaction", "poster", "data", "background"]
  .flatMap((a) => [`[${a}^="javascript:" i]`, `[${a}^="vbscript:" i]`, `[${a}^="data:text/" i]`, `[${a}^="data:image/svg" i]`, `[${a}^="data:application/" i]`, `[${a}*="&#"]`, `[${a}*="&colon" i]`, `[${a}^=" "]`])
  .concat(['[srcset*="javascript:" i]', "[srcdoc]", "[ping]"]);
const URL_ATTRS = ["href", "src", "action", "formaction", "poster", "background", "srcset", "data"];

const TRACKER_IMGS = [
  'img[width="1"][height="1"]',
  ...["google-analytics", "googletagmanager", "doubleclick", "facebook.com/tr", "scorecardresearch", "quantserve", "hotjar", "segment.io", "segment.com", "mixpanel", "chartbeat", "parsely", "pixel.", "analytics."].map((h) => `img[src*="${h}" i]`),
];

const DATE_META = [
  "article:published_time",
  "og:published_time",
  "datepublished",
  "pubdate",
  "publishdate",
  "publish-date",
  "date",
  "dc.date.issued",
  "dcterms.created",
  "parsely-pub-date",
  "sailthru.date",
];

/** Normalise a date-ish string to YYYY-MM-DD, keeping the publisher's local calendar date. */
export function toIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1990 || y > 2100) return null;
  return d.toISOString().slice(0, 10);
}

export interface ProcessedHtml {
  /** Sanitised snapshot, UTF-8. */
  html: Uint8Array;
  scan: ScanResult;
  article: Article;
  /** <meta name="robots" content="noarchive"> present. */
  noarchive: boolean;
  /** The page contains a password field (login wall signal). */
  passwordField: boolean;
}

/** Malware markers anywhere in the page (native string search, no per-element work). */
export function scanForMalware(html: string): string[] {
  const reasons: string[] = [];
  if (html.includes(EICAR)) reasons.push("EICAR antivirus test signature");
  if (EXEC_DATA_URI_RE.test(html)) reasons.push("Embedded executable data URI");
  if (PE_BASE64_RE.test(html)) reasons.push("Embedded Windows executable (PE header)");
  return reasons;
}

function clean(s: string): string {
  return decodeEntities(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function jsonLdObjects(blocks: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(push);
    else if (x && typeof x === "object") {
      out.push(x as Record<string, unknown>);
      const graph = (x as Record<string, unknown>)["@graph"];
      if (graph) push(graph);
    }
  };
  for (const b of blocks) {
    try {
      push(JSON.parse(b) as unknown);
    } catch {
      // Ignore malformed JSON-LD.
    }
  }
  return out;
}

/** Is this URL attribute value dangerous once the browser decodes it? */
function dangerousUrl(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- strip control characters used to obfuscate "javascript:" URLs
  const v = decodeEntities(value.slice(0, 512)).replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  return v.startsWith("javascript:") || v.startsWith("vbscript:") || v.startsWith("data:text/html") || v.startsWith("data:image/svg+xml") || v.startsWith("data:application/") || v.startsWith("data:text/x-");
}

// ---------------------------------------------------------------------------
// Body text (native regular expressions over the main content region)
// ---------------------------------------------------------------------------

const DROP = /<!--[\s\S]*?-->|<(script|style|noscript|template|svg|nav|header|footer|aside|button|select|textarea|iframe|object|figure)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const FURNITURE_CLASS = /<(div|section|ul|aside|span|p)\b[^>]*\b(?:class|id)=["'][^"']*\b(?:share|sharing|social|cookie|consent|newsletter|related|comments?|advert|promo|breadcrumbs?)\b[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK_TAG = /<\/?(?:p|div|h[1-6]|li|blockquote|pre|td|th|tr|section|article|main|figcaption|dd|dt|ul|ol|table|br|hr)\b[^>]*>/gi;
const ANY_TAG = /<[^>]*>/g;

/** [start, end) of the element that opens at `from`, counting nested same-name tags. */
function elementRange(html: string, from: number, tag: string): [number, number] {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return [from, m.index + m[0].length];
  }
  return [from, html.length];
}

/** The main content region: articleBody, else <article>, else <main>, else <body>. */
function contentRegion(html: string): string | null {
  const body = /<(\w+)\b[^>]*\bitemprop=["']?articleBody\b[^>]*>/i.exec(html);
  if (body) return html.slice(...elementRange(html, body.index, body[1] as string));
  for (const tag of ["article", "main"]) {
    const i = html.search(new RegExp(`<${tag}\\b`, "i"));
    if (i >= 0) return html.slice(...elementRange(html, i, tag));
  }
  return null;
}

function textLines(fragment: string): string[] {
  return decodeEntities(fragment.replace(DROP, " ").replace(FURNITURE_CLASS, " ").replace(BLOCK_TAG, "\n").replace(ANY_TAG, ""))
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1);
}

/** Remove long inline data: payloads (SingleFile images) with indexOf, before any regex runs. */
export function stripLongDataUris(html: string, max = 2048): string {
  let i = html.indexOf("data:");
  if (i < 0) return html;
  let out = "";
  let from = 0;
  while (i >= 0) {
    let end = html.length;
    for (const q of ['"', "'", ")"]) {
      const k = html.indexOf(q, i);
      if (k >= 0 && k < end) end = k;
    }
    if (end - i > max) {
      out += html.slice(from, i) + "data:";
      from = end;
    }
    i = html.indexOf("data:", end);
  }
  return out + html.slice(from);
}

export function extractBodyText(page: string): string {
  const html = stripLongDataUris(page);
  const region = contentRegion(html);
  let text = region ? textLines(region).join("\n\n") : "";
  if (text.length < 200) {
    const b = html.search(/<body\b/i);
    const all = textLines(b >= 0 ? html.slice(b) : html);
    const long = all.filter((l) => l.length >= 40);
    const candidate = (long.length ? long : all).join("\n\n");
    if (candidate.length > text.length) text = candidate;
  }
  return text;
}

export async function processHtml(input: string | Uint8Array, pageUrl: string | null): Promise<ProcessedHtml> {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);
  const reasons = new Set(scanForMalware(text));
  const stats = { scriptsRemoved: 0, formsRemoved: 0, framesRemoved: 0, handlersRemoved: 0, linksRemoved: 0 };
  let title = "";
  let titleDone = false;
  let h1 = "";
  let h1Count = 0;
  let timeDt: string | null = null;
  let noarchive = false;
  let passwordField = false;
  let hadHead = false;
  const meta = new Map<string, string>();
  const ld: string[] = [];
  let ldBuf = "";

  let rw = new HTMLRewriter()
    .on("title", {
      text(t) {
        if (titleDone) return;
        title += t.text;
        if (t.lastInTextNode) titleDone = true;
      },
    })
    .on("h1", {
      element() {
        h1Count++;
      },
      text(t) {
        if (h1Count === 1) h1 += t.text;
      },
    })
    .on("head", {
      element(el) {
        hadHead = true;
        el.prepend(CSP_META, { html: true });
      },
    })
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? el.getAttribute("itemprop") ?? "").toLowerCase().trim();
        const content = el.getAttribute("content");
        if (key && content != null && !meta.has(key)) meta.set(key, clean(content));
        if (key === "robots" && /noarchive/i.test(content ?? "")) noarchive = true;
      },
    })
    .on("time[datetime]", {
      element(el) {
        timeDt ??= el.getAttribute("datetime");
      },
    })
    .on('script[type="application/ld+json" i]', {
      text(t) {
        ldBuf += t.text;
        if (t.lastInTextNode) {
          ld.push(ldBuf);
          ldBuf = "";
        }
      },
    })
    .on('input[type="password" i]', {
      element() {
        passwordField = true;
      },
    });

  // ---- Sanitisation (registered after extraction so those handlers still see the elements)
  for (const [sel, kind] of Object.entries(REMOVE)) {
    rw = rw.on(sel, {
      element(el) {
        if (kind === "scripts") stats.scriptsRemoved++;
        else if (kind === "forms") stats.formsRemoved++;
        else if (kind === "frames") stats.framesRemoved++;
        else if (kind === "links") stats.linksRemoved++;
        el.remove();
      },
    });
  }
  rw = rw
    .on("form", {
      element(el) {
        // Keep the content (some sites wrap the whole page in one form) but drop the element.
        stats.formsRemoved++;
        el.removeAndKeepContent();
      },
    })
    .on(TRACKER_IMGS.join(", "), {
      element(el) {
        stats.scriptsRemoved++;
        el.remove();
      },
    })
    .on(EVENT_ATTRS.join(", "), {
      element(el) {
        for (const [name = ""] of [...el.attributes]) {
          if (name.toLowerCase().startsWith("on")) {
            el.removeAttribute(name);
            stats.handlersRemoved++;
          }
        }
      },
    })
    .on(URL_SUSPECTS.join(", "), {
      element(el) {
        for (const name of ["srcdoc", "ping"]) {
          if (el.hasAttribute(name)) {
            el.removeAttribute(name);
            stats.handlersRemoved++;
          }
        }
        for (const name of URL_ATTRS) {
          const v = el.getAttribute(name);
          if (v == null) continue;
          const lower = decodeEntities(v.slice(0, 200)).toLowerCase();
          if (EXEC_DATA_URI_RE.test(lower)) reasons.add("Embedded executable data URI");
          if (PE_BASE64_RE.test(v.slice(0, 200))) reasons.add("Embedded Windows executable (PE header)");
          if (dangerousUrl(v)) {
            el.removeAttribute(name);
            stats.handlersRemoved++;
          }
        }
      },
    });

  const out = new Uint8Array(await rw.transform(new Response(typeof input === "string" ? input : new Uint8Array(input), { headers: { "content-type": "text/html; charset=utf-8" } })).arrayBuffer());
  const html = finalise(out, hadHead);

  // ---- Metadata --------------------------------------------------------
  const ldObjs = jsonLdObjects(ld);
  const ldArticle = ldObjs.find((o) => /Article|NewsArticle|BlogPosting|PressRelease|Report/i.test(String(o["@type"] ?? "")));
  let publicationDate: string | null = null;
  for (const k of DATE_META) {
    publicationDate = toIsoDate(meta.get(k));
    if (publicationDate) break;
  }
  if (!publicationDate && ldArticle) publicationDate = toIsoDate(String(ldArticle.datePublished ?? ldArticle.dateCreated ?? ""));
  if (!publicationDate) publicationDate = toIsoDate(timeDt ? decodeEntities(timeDt) : null);

  const publisher = ldArticle?.publisher as { name?: string } | undefined;
  let siteName = meta.get("og:site_name") || meta.get("application-name") || (typeof publisher?.name === "string" ? publisher.name : null) || null;
  if (!siteName && pageUrl) {
    try {
      siteName = new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      siteName = null;
    }
  }
  const author = ldArticle?.author as { name?: string } | { name?: string }[] | string | undefined;
  const ldAuthor = typeof author === "string" ? author : Array.isArray(author) ? author[0]?.name : author?.name;
  const byline = meta.get("author") || (typeof ldAuthor === "string" ? ldAuthor : null);

  // ---- Body text ------------------------------------------------------------
  let bodyText = extractBodyText(text);
  const truncated = bodyText.length > MAX_BODY_CHARS;
  if (truncated) bodyText = bodyText.slice(0, MAX_BODY_CHARS);

  const headline = clean(meta.get("og:title") || meta.get("twitter:title") || h1 || title || "Untitled").slice(0, 300) || "Untitled";
  const article: Article = {
    headline,
    bodyText,
    publicationDate,
    siteName: siteName ? clean(siteName).slice(0, 200) : null,
    byline: byline ? clean(byline).slice(0, 200) : null,
    wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
    truncated,
  };
  const r = [...reasons];
  return { html, scan: { malicious: r.length > 0, reasons: r, ...stats }, article, noarchive, passwordField };
}

const enc = new TextEncoder();

/** Ensure a doctype and the CSP <meta> (added to <head> during the pass when there is one). */
function finalise(out: Uint8Array, hadHead: boolean): Uint8Array {
  const head = new TextDecoder().decode(out.subarray(0, 1024));
  const doctype = /^\s*<!doctype[^>]*>/i.exec(head);
  let prefix = "";
  let skipBytes = 0;
  if (doctype) {
    if (hadHead) return out;
    // Keep the original doctype first, then the CSP meta.
    skipBytes = enc.encode(doctype[0]).byteLength;
    prefix = `${doctype[0]}\n${CSP_META}`;
  } else {
    prefix = `<!doctype html>\n${hadHead ? "" : CSP_META}`;
  }
  const p = enc.encode(prefix);
  const rest = out.subarray(skipBytes);
  const html = new Uint8Array(p.byteLength + rest.byteLength);
  html.set(p, 0);
  html.set(rest, p.byteLength);
  return html;
}

/** Sanitise a page (string in, string out). */
export async function sanitizeHtml(raw: string): Promise<{ html: string; scan: ScanResult }> {
  const p = await processHtml(raw, null);
  return { html: new TextDecoder().decode(p.html), scan: p.scan };
}

/** Extract article text and metadata from a page. */
export async function extractArticle(raw: string, pageUrl: string | null): Promise<Article> {
  return (await processHtml(raw, pageUrl)).article;
}
