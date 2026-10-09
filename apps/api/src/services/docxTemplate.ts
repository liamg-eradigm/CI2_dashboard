/**
 * Request 51: alerts and newsletters written into the Word templates at the
 * root of the repo ("Alert Template.docx", "Newsletter Template.docx", packed
 * into `templates/docxTemplates.generated.ts` by scripts/build-docx-templates.mjs).
 *
 * The templates' placeholders ("<Insert Title>", "<Alert Title>"…) are
 * replaced in the document XML, keeping the template's own formatting:
 * a value takes the look of the text where its placeholder starts (Word often
 * splits a placeholder over several runs). Long fields (Key Details, CI
 * Perspective, Tell Me More) keep their structure: each line its own
 * paragraph, "- " bullets as Word bullets at their level, and the light
 * formatting of the dashboard's text boxes (bold, underline, size, titles).
 * A missing value is written "N/A".
 */
import { parseRich, plainText, xmlEscape, zipStore, type RichBlock, type RichRun } from "@eradigm/shared";
import type { TemplatePart } from "../templates/docxTemplates.generated.js";

const W_NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
export const NA = "N/A";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "September" for "2026-09-01" (or for a month number 1–12). */
export const monthName = (m: number) => MONTHS[m - 1] ?? "";
const ordinal = (d: number) => (d % 100 >= 11 && d % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] ?? "th");

/** An ISO date as its parts ("2026-09-01" → September, 1, "st", 2026), or null. */
export function dateParts(iso: string | null | undefined): { month: string; day: number; suffix: string; year: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month: monthName(month), day, suffix: ordinal(day), year: Number(m[1]) };
}

/** "September 1, 2026" (Month day, year), or N/A. */
export function longDate(iso: string | null | undefined): string {
  const p = dateParts(iso);
  return p ? `${p.month} ${p.day}, ${p.year}` : NA;
}

// ---------------------------------------------------------------------------
// Run properties: kept in the order the Word schema expects.
// ---------------------------------------------------------------------------

const RPR_ORDER = [
  "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid",
  "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em",
  "lang", "eastAsianLayout", "specVanish", "oMath",
];

/** The children of a <w:rPr> by name (each element kept whole). */
function rprParts(rPr: string): Map<string, string> {
  const inner = /^<w:rPr>([\s\S]*)<\/w:rPr>$/.exec(rPr)?.[1] ?? "";
  const out = new Map<string, string>();
  for (const m of inner.matchAll(/<w:([A-Za-z]+)\b[^>]*?(?:\/>|>[\s\S]*?<\/w:\1>)/g)) out.set(m[1]!, m[0]);
  return out;
}
function rprXml(parts: Map<string, string>): string {
  const keys = [...parts.keys()].sort((a, b) => (RPR_ORDER.indexOf(a) + 1 || 99) - (RPR_ORDER.indexOf(b) + 1 || 99));
  return parts.size ? `<w:rPr>${keys.map((k) => parts.get(k)).join("")}</w:rPr>` : "";
}

/** The base look with a value run's own bold / underline / size (relative to the base size, 11 pt when none). */
function runProps(base: string, run: Partial<RichRun> & { link?: boolean; hyperlinkStyle?: boolean }): string {
  const parts = rprParts(base);
  if (run.bold) {
    parts.set("b", "<w:b/>");
    parts.set("bCs", "<w:bCs/>");
  }
  if (run.underline) parts.set("u", '<w:u w:val="single"/>');
  if (run.size && run.size !== 1) {
    const sz = Number(/w:val="(\d+)"/.exec(parts.get("sz") ?? "")?.[1] ?? 22);
    const v = Math.max(2, Math.round(sz * run.size));
    parts.set("sz", `<w:sz w:val="${v}"/>`);
    parts.set("szCs", `<w:szCs w:val="${v}"/>`);
  }
  if (run.link) {
    if (run.hyperlinkStyle) parts.set("rStyle", '<w:rStyle w:val="Hyperlink"/>');
    else {
      parts.set("color", '<w:color w:val="0563C1"/>');
      parts.set("u", '<w:u w:val="single"/>');
    }
  }
  return rprXml(parts);
}

const textRun = (rPr: string, text: string) => (text ? `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>` : "");

// ---------------------------------------------------------------------------
// A document being filled
// ---------------------------------------------------------------------------

/** A value: plain text, or the runs of a formatted line; optionally a link. */
export interface Value {
  runs: RichRun[];
  link?: string | null;
}
export const plain = (text: string | null | undefined, link?: string | null): Value => {
  const t = String(text ?? "").trim();
  return { runs: [{ text: t || NA }], link: t ? link : null };
};

export interface Find {
  /** The text to replace, as it reads in Word (e.g. "<Insert Title>"). */
  find: string;
  value: Value;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** A paragraph's text as it reads in Word. */
export const paragraphText = (p: string) => [...p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decode(m[1] ?? "")).join("");

/** Every paragraph of an XML part (top-level paragraphs and those in table cells), with its position. */
export function paragraphs(xml: string): { start: number; end: number; xml: string }[] {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, xml: m[0] }));
}

export class DocxDoc {
  private parts: Map<string, string | Uint8Array>;
  private relSeq = 9000;
  readonly hyperlinkStyle: boolean;
  doc: string;

  constructor(template: TemplatePart[]) {
    this.parts = new Map(template.map((p) => [p.name, p.text ?? Uint8Array.from(atob(p.b64 ?? ""), (c) => c.charCodeAt(0))]));
    this.doc = this.text("word/document.xml");
    this.hyperlinkStyle = /w:styleId="Hyperlink"/.test(this.text("word/styles.xml"));
    this.dropComments();
  }

  text(name: string): string {
    const v = this.parts.get(name);
    return typeof v === "string" ? v : "";
  }

  /** The template's review comments are not part of a generated document. */
  private dropComments() {
    this.doc = this.doc
      .replace(/<w:commentRange(?:Start|End)\b[^>]*\/>/g, "")
      .replace(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, "")
      .replace(/<w:r\s[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, "")
      // Paragraph IDs repeat once paragraphs are copied; Word does not need them.
      .replace(/ w14:(?:paraId|textId)="[0-9A-Fa-f]+"/g, "");
    for (const name of ["word/comments.xml", "word/commentsExtended.xml", "word/commentsIds.xml", "word/commentsExtensible.xml", "word/documenttasks/documenttasks1.xml"]) {
      const x = this.text(name);
      if (!x) continue;
      // Keep the root element (with its namespaces), empty.
      const open = /<([A-Za-z0-9]+:[A-Za-z]+)\b[^>]*?>/.exec(x.replace(/^<\?xml[^>]*\?>\s*/, ""));
      if (open) this.parts.set(name, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${open[0].replace(/\/>$/, ">")}</${open[1]}>`);
    }
  }

  /** A new external link: its relationship ID. */
  link(url: string): string {
    const id = `rIdEci${++this.relSeq}`;
    const rels = this.text("word/_rels/document.xml.rels");
    this.parts.set(
      "word/_rels/document.xml.rels",
      rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${W_NS_REL}" Target="${xmlEscape(url)}" TargetMode="External"/></Relationships>`),
    );
    return id;
  }

  /** The runs of a value, in the look `base` (a <w:rPr>), linked if it has a link. */
  valueRuns(v: Value, base: string): string {
    const url = safeUrl(v.link);
    const runs = v.runs.map((r) => textRun(runProps(base, { ...r, link: !!url, hyperlinkStyle: this.hyperlinkStyle }), r.text)).join("");
    return url ? `<w:hyperlink r:id="${this.link(url)}" w:history="1">${runs}</w:hyperlink>` : runs;
  }

  /**
   * Replace texts in one paragraph, each found after the one before it. A
   * value takes the look of the run where its text starts; the rest of the
   * found text is removed from the runs after it. A value with a link inside
   * an existing hyperlink re-points that hyperlink (or drops it without a link).
   */
  fill(p: string, finds: Find[]): string {
    type Run = { start: number; end: number; at: number; xml: string; rPr: string; text: string; inLink: string | null };
    const runs: Run[] = [];
    // Runs, noting the hyperlink (its r:id) each sits in.
    const links = [...p.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, id: /r:id="([^"]+)"/.exec(m[1] ?? "")?.[1] ?? null }));
    let pos = 0;
    for (const m of p.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const t = [...(m[1] ?? "").matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => decode(x[1] ?? "")).join("");
      if (!t) continue;
      const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(m[1] ?? "")?.[0] ?? "";
      const at = m.index!;
      runs.push({ start: pos, end: pos + t.length, at, xml: m[0], rPr, text: t, inLink: links.find((l) => at > l.start && at < l.end)?.id ?? null });
      pos += t.length;
    }
    const full = runs.map((r) => r.text).join("");
    // The spans to replace, in order.
    const spans: { s: number; e: number; value: Value }[] = [];
    let from = 0;
    for (const f of finds) {
      const s = full.indexOf(f.find, from);
      if (s < 0) continue;
      spans.push({ s, e: s + f.find.length, value: f.value });
      from = s + f.find.length;
    }
    if (!spans.length) return p;
    const relink = new Map<string, string | null>();
    let out = p;
    // Rebuild the runs from the last to the first, so positions stay valid.
    for (const r of [...runs].reverse()) {
      if (!spans.some((sp) => sp.s < r.end && sp.e > r.start)) continue;
      let xml = "";
      let i = r.start;
      while (i < r.end) {
        const sp = spans.find((x) => x.s <= i && x.e > i);
        if (!sp) {
          const next = Math.min(r.end, ...spans.filter((x) => x.s > i).map((x) => x.s));
          xml += textRun(r.rPr, r.text.slice(i - r.start, next - r.start));
          i = next;
          continue;
        }
        if (sp.s === i) {
          if (r.inLink) {
            // Already a hyperlink in the template: keep its look, change where it points.
            relink.set(r.inLink, safeUrl(sp.value.link));
            xml += sp.value.runs.map((x) => textRun(runProps(r.rPr, x), x.text)).join("");
          } else xml += this.valueRuns(sp.value, r.rPr);
        }
        i = Math.min(r.end, sp.e);
      }
      // Other contents of the run (a line break, a tab…) stay, before its text.
      const others = r.xml.replace(/^<w:r(?:\s[^>]*)?>/, "").replace(/<\/w:r>$/, "").replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, "").replace(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>/g, "");
      if (others.trim()) xml = `<w:r>${r.rPr}${others}</w:r>${xml}`;
      // Last run first: the text before it has not moved.
      out = out.slice(0, r.at) + xml + out.slice(r.at + r.xml.length);
    }
    for (const [id, url] of relink) {
      out = url
        ? out.replace(`r:id="${id}"`, `r:id="${this.link(url)}"`)
        : out.replace(new RegExp(`<w:hyperlink\\b[^>]*r:id="${id}"[^>]*>([\\s\\S]*?)</w:hyperlink>`), "$1");
    }
    return out;
  }

  /**
   * A long field in place of its placeholder paragraph: each line its own
   * paragraph (text before the placeholder stays at the start of the first),
   * "- " bullets as Word bullets. In a bulleted placeholder every line is a
   * bullet (bullets one level further in); elsewhere bullets use `bulletNumId`.
   */
  block(p: string, find: string, text: string | null | undefined, opts: { bulletNumId: string; bulletBase?: number }): string {
    const blocks = richBlocks(text);
    const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? "";
    const num = /<w:numId w:val="(\d+)"\/>/.exec(pPr)?.[1] ?? null;
    const lvl = Number(/<w:ilvl w:val="(\d+)"\/>/.exec(pPr)?.[1] ?? 0);
    const full = paragraphText(p);
    const at = full.indexOf(find);
    if (at < 0) return p;
    // The look of the placeholder's first character.
    const base = this.baseLook(p, at);
    const hasPlain = blocks.some((b) => b.kind !== "item");
    const level = (b: RichBlock) => (b.kind === "item" ? b.depth + (num && hasPlain ? 1 : 0) : 0);
    const paraFor = (b: RichBlock) => {
      const runs = b.kind === "title" ? b.runs.map((r) => ({ ...r, bold: true })) : b.runs;
      let ppr = pPr;
      if (num) ppr = setLevel(pPr, num, Math.min(8, lvl + level(b)));
      else if (b.kind === "item") ppr = setLevel(listPPr(pPr), opts.bulletNumId, Math.min(8, (opts.bulletBase ?? 0) + b.depth));
      return `<w:p>${ppr}${this.valueRuns({ runs }, base)}</w:p>`;
    };
    const before = full.slice(0, at).trim();
    const after = full.slice(at + find.length).trim();
    // Only the placeholder in its paragraph: one paragraph per line.
    if (!before && !after) return blocks.map(paraFor).join("");
    // Text around it: the first line stays inline; the rest follow as paragraphs.
    const [first, ...rest] = blocks;
    const inline = this.fill(p, [{ find, value: { runs: first!.kind === "title" ? first!.runs.map((r) => ({ ...r, bold: true })) : first!.runs } }]);
    return inline + rest.map(paraFor).join("");
  }

  /** The <w:rPr> of the run holding a paragraph's `at`-th character. */
  private baseLook(p: string, at: number): string {
    let pos = 0;
    for (const m of p.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const t = [...(m[1] ?? "").matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => decode(x[1] ?? "")).join("");
      if (t && at < pos + t.length) return /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(m[1] ?? "")?.[0] ?? "";
      pos += t.length;
    }
    return "";
  }

  /** The finished .docx. */
  pack(): Uint8Array {
    this.parts.set("word/document.xml", this.doc);
    const enc = new TextEncoder();
    return zipStore([...this.parts].map(([name, v]) => ({ name, data: typeof v === "string" ? enc.encode(v) : v })));
  }
}

/** Only web and mail links are written into a document. */
function safeUrl(u: string | null | undefined): string | null {
  const s = String(u ?? "").trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A paragraph's properties as a list item (ListParagraph style, numbering removed). */
function listPPr(pPr: string): string {
  let x = pPr || "<w:pPr></w:pPr>";
  x = x.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, "");
  if (!/<w:pStyle /.test(x)) x = x.replace("<w:pPr>", '<w:pPr><w:pStyle w:val="ListParagraph"/>');
  return x;
}

/** A paragraph's properties with list numbering at a level (numPr goes after pStyle, keepNext… before spacing). */
function setLevel(pPr: string, numId: string, ilvl: number): string {
  const numPr = `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;
  const x = pPr || "<w:pPr></w:pPr>";
  if (/<w:numPr>[\s\S]*?<\/w:numPr>/.test(x)) return x.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, numPr);
  // Schema order: pStyle, keepNext, keepLines, pageBreakBefore, framePr, widowControl, numPr, …
  const after = /<w:pStyle [^>]*\/>(?:<w:keepNext\/>)?(?:<w:keepLines\/>)?(?:<w:pageBreakBefore\/>)?(?:<w:framePr [^>]*\/>)?(?:<w:widowControl\/>)?/.exec(x);
  if (after) return x.replace(after[0], after[0] + numPr);
  return x.replace("<w:pPr>", `<w:pPr>${numPr}`);
}

/** A long field's lines (blank lines left out); "N/A" when it is empty. */
export function richBlocks(text: string | null | undefined): RichBlock[] {
  const blocks = parseRich(String(text ?? "")).filter((b) => b.runs.some((r) => r.text.trim()));
  return blocks.length ? blocks : [{ kind: "p", runs: [{ text: NA }] }];
}

/** A short field as text ("N/A" when empty); lists joined with commas, formatting dropped. */
export function shortText(v: unknown): string {
  const t = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(", ") : plainText(String(v ?? "")).replace(/\s+/g, " ").trim();
  return t || NA;
}
