/**
 * Article extraction and noise removal — the Worker-compatible alternative to
 * trafilatura: Mozilla Readability on a linkedom DOM, plus metadata from
 * Open Graph / schema.org / <time> for the publication date and outlet.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { Article, SingleFileInfo } from "./types.js";

export const MAX_BODY_CHARS = 60_000;

const DATE_META = [
  'meta[property="article:published_time"]',
  'meta[name="article:published_time"]',
  'meta[property="og:published_time"]',
  'meta[itemprop="datePublished"]',
  'meta[name="pubdate"]',
  'meta[name="publishdate"]',
  'meta[name="publish-date"]',
  'meta[name="date"]',
  'meta[name="DC.date.issued"]',
  'meta[name="dcterms.created"]',
  'meta[name="parsely-pub-date"]',
  'meta[name="sailthru.date"]',
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

interface Queryable {
  querySelectorAll(selector: string): ArrayLike<{ textContent: string | null }> & Iterable<{ textContent: string | null }>;
}

function jsonLdObjects(doc: Queryable): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const s of [...doc.querySelectorAll('script[type="application/ld+json"]')]) {
    try {
      const v = JSON.parse(s.textContent ?? "") as unknown;
      const push = (x: unknown) => {
        if (Array.isArray(x)) x.forEach(push);
        else if (x && typeof x === "object") {
          out.push(x as Record<string, unknown>);
          const graph = (x as Record<string, unknown>)["@graph"];
          if (graph) push(graph);
        }
      };
      push(v);
    } catch {
      // Ignore malformed JSON-LD.
    }
  }
  return out;
}

export function detectSingleFile(html: string): SingleFileInfo {
  const head = html.slice(0, 8000);
  const detected = /Page saved with SingleFile/i.test(head);
  if (!detected) return { detected: false, sourceUrl: null, savedAt: null };
  const url = /^\s*url:\s*(https?:\/\/\S+)\s*$/im.exec(head)?.[1] ?? null;
  const saved = /^\s*saved date:\s*(.+?)\s*$/im.exec(head)?.[1] ?? null;
  return { detected, sourceUrl: url, savedAt: saved };
}

function cleanText(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function blocksToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const blocks = [...document.querySelectorAll("p, h1, h2, h3, h4, h5, li, blockquote, pre, td")]
    .filter((el) => !el.querySelector("p, li, blockquote"))
    .map((el) => cleanText(el.textContent ?? ""))
    .filter((t) => t.length > 1);
  if (blocks.length) return blocks.join("\n\n");
  return cleanText(document.body?.textContent ?? "");
}

export function extractArticle(rawHtml: string, pageUrl: string | null): Article {
  const { document } = parseHTML(rawHtml);
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() || null;
  const ld = jsonLdObjects(document as unknown as Queryable);
  const ldArticle = ld.find((o) => /Article|NewsArticle|BlogPosting|PressRelease|Report/i.test(String(o["@type"] ?? "")));

  let publicationDate: string | null = null;
  for (const sel of DATE_META) {
    publicationDate = toIsoDate(meta(sel));
    if (publicationDate) break;
  }
  if (!publicationDate && ldArticle) publicationDate = toIsoDate(String(ldArticle.datePublished ?? ldArticle.dateCreated ?? ""));
  if (!publicationDate) publicationDate = toIsoDate(document.querySelector("time[datetime]")?.getAttribute("datetime"));

  const publisher = ldArticle?.publisher as { name?: string } | undefined;
  let siteName = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || publisher?.name || null;
  if (!siteName && pageUrl) {
    try {
      siteName = new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      siteName = null;
    }
  }

  const ogTitle = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]');
  const h1 = cleanText(document.querySelector("h1")?.textContent ?? "");
  const titleTag = cleanText(document.querySelector("title")?.textContent ?? "");

  let parsed: { title?: string | null; content?: string | null; textContent?: string | null; byline?: string | null; siteName?: string | null; publishedTime?: string | null } | null = null;
  try {
    // Readability mutates the document, so it runs on its own parse.
    const { document: rdoc } = parseHTML(rawHtml);
    parsed = new Readability(rdoc as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 200 }).parse();
  } catch {
    parsed = null;
  }

  let bodyText = parsed?.content ? blocksToText(parsed.content) : "";
  if (bodyText.length < 200) {
    const paras = [...document.querySelectorAll("p")].map((p) => cleanText(p.textContent ?? "")).filter((t) => t.length > 40);
    if (paras.join(" ").length > bodyText.length) bodyText = paras.join("\n\n");
  }
  if (!publicationDate) publicationDate = toIsoDate(parsed?.publishedTime);
  const truncated = bodyText.length > MAX_BODY_CHARS;
  if (truncated) bodyText = bodyText.slice(0, MAX_BODY_CHARS);

  const headline = (ogTitle || h1 || parsed?.title || titleTag || "Untitled").slice(0, 300);
  return {
    headline: cleanText(headline),
    bodyText,
    publicationDate,
    siteName: siteName || parsed?.siteName || null,
    byline: parsed?.byline ? cleanText(parsed.byline).slice(0, 200) : null,
    wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
    truncated,
  };
}
