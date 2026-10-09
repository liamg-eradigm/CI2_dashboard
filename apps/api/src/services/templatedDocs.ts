/**
 * Request 51: an entry's alert and a newsletter, written into the Word
 * templates (see docxTemplate.ts for how placeholders are filled).
 *
 * Alert (every Tracker entry has one): Title, Competitor, Assets (Drug),
 * Review Date, Publisher (linked to the URL), Key Details, Impact,
 * CI Perspective and Tell Me More.
 *
 * Newsletter: the month (and year) it is generated in; then, in its
 * Technology, People and Process sections, one block per entry assigned to
 * the section: Title (Publisher, linked; Event Date as "September 1st, 2026"),
 * Macrotrend (Subtrend), CI Perspective and Key Details. The Executive
 * Summary lists each section's titles.
 */
import { CORE, FIELDS, tellMeMoreKey, type ItemValues, type NewsletterSection, type TrackerSchema } from "@eradigm/shared";
import { ALERT_TEMPLATE, NEWSLETTER_TEMPLATE } from "../templates/docxTemplates.generated.js";
import { DocxDoc, NA, dateParts, longDate, monthName, paragraphText, paragraphs, plain, shortText, type Find, type Value } from "./docxTemplate.js";

export interface EntryForDoc {
  schema: TrackerSchema;
  values: ItemValues;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** A field's value by its key, else by its column name (the names an admin may have given it). */
function field(e: EntryForDoc, keys: string[], labels: string[] = []): unknown {
  for (const k of keys) {
    const v = e.values[k];
    if (v != null && !(typeof v === "string" && !v.trim()) && !(Array.isArray(v) && !v.length)) return v;
  }
  const wanted = labels.map(norm);
  const col = e.schema.columns.find((c) => wanted.includes(norm(c.label)) && !keys.includes(c.key));
  return col ? (e.values[col.key] ?? null) : null;
}
const text = (e: EntryForDoc, keys: string[], labels: string[] = []) => {
  const v = field(e, keys, labels);
  return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
};

/** Replace, in every paragraph of the document, the placeholders it holds (in the order they appear). */
function fillEach(d: DocxDoc, xml: string, finds: Find[], longs: { find: string; text: string; bulletNumId: string; bulletBase?: number }[]): string {
  let out = xml;
  for (const p of paragraphs(xml).reverse()) {
    const t = paragraphText(p.xml);
    const long = longs.find((l) => t.includes(l.find));
    let next: string;
    if (long) next = d.block(p.xml, long.find, long.text, long);
    else {
      const here = finds.filter((f) => t.includes(f.find)).sort((a, b) => t.indexOf(a.find) - t.indexOf(b.find));
      if (!here.length) continue;
      next = d.fill(p.xml, here);
    }
    out = out.slice(0, p.start) + next + out.slice(p.end);
  }
  return out;
}

/** The bullet list a template uses next to a placeholder (its numbering ID), else `fallback`. */
function bulletNear(xml: string, find: string, fallback: string): string {
  const p = paragraphs(xml).find((x) => paragraphText(x.xml).includes(find));
  return (p && /<w:numId w:val="(\d+)"\/>/.exec(p.xml)?.[1]) || fallback;
}

/** An entry's alert (.docx) from Alert Template.docx. */
export function alertDocx(e: EntryForDoc): Uint8Array {
  const d = new DocxDoc(ALERT_TEMPLATE);
  const bullets = bulletNear(d.doc, "<Insert CI Perspective>", "13");
  const url = text(e, [FIELDS.url], ["URL", "Link"]);
  const more = tellMeMoreKey(e.schema.columns);
  d.doc = fillEach(
    d,
    d.doc,
    [
      { find: "<Insert Title>", value: plain(shortTextOrEmpty(field(e, [CORE.title]))) },
      { find: "<Insert Competitor>", value: plain(shortTextOrEmpty(field(e, [CORE.competitors], ["Competitor", "Company"]))) },
      { find: "<Insert Assets>", value: plain(shortTextOrEmpty(field(e, [FIELDS.assets, FIELDS.sourceBrandAsset], ["Assets", "Asset", "Drug"]))) },
      { find: "<Insert Review Date>", value: plain(dateOrEmpty(text(e, [FIELDS.reviewDate], ["Review Date"]))) },
      { find: "<Insert Publisher>", value: plain(shortTextOrEmpty(field(e, [FIELDS.publisher], ["Publisher", "Source"])), url) },
      { find: "<Insert Impact Rating>", value: plain(shortTextOrEmpty(field(e, [CORE.impact], ["Impact"]))) },
    ],
    [
      { find: "<Insert Key Details>", text: text(e, [FIELDS.keyDetails], ["Key Details"]), bulletNumId: bullets },
      { find: "<Insert CI Perspective>", text: text(e, [FIELDS.ciPerspective], ["CI Perspective"]), bulletNumId: bullets },
      { find: "<Insert Tell Me More>", text: text(e, more ? [more] : [], ["Tell Me More"]), bulletNumId: bullets },
    ],
  );
  return d.pack();
}

const shortTextOrEmpty = (v: unknown) => {
  const t = shortText(v);
  return t === NA ? "" : t;
};
const dateOrEmpty = (iso: string) => {
  const t = longDate(iso);
  return t === NA ? (iso.trim() ? iso.trim() : "") : t;
};

const SECTIONS: NewsletterSection[] = ["technology", "people", "process"];
const empty: Value = { runs: [{ text: "" }] };

/** A newsletter (.docx) from Newsletter Template.docx: each entry in the section it was assigned to. */
export function newsletterDocx(sections: Record<NewsletterSection, EntryForDoc[]>, now: { month: number; year: number }): Uint8Array {
  const d = new DocxDoc(NEWSLETTER_TEMPLATE);
  let doc = d.doc;

  // The month (and the year beside it) the newsletter is written in: only in the paragraphs that say <Month>.
  for (const p of paragraphs(doc).reverse()) {
    const t = paragraphText(p.xml);
    if (!t.includes("<Month>")) continue;
    const finds: Find[] = [{ find: "<Month>", value: plain(monthName(now.month)) }];
    if (t.includes("2026", t.indexOf("<Month>"))) finds.push({ find: "2026", value: plain(String(now.year)) });
    doc = doc.slice(0, p.start) + d.fill(p.xml, finds) + doc.slice(p.end);
  }

  // Executive Summary: each section's titles, as its bullets (the empty bullet under Technology, People, Process).
  SECTIONS.forEach((s, k) => {
    const numId = String(k + 1);
    const p = paragraphs(doc).find((x) => !paragraphText(x.xml).trim() && new RegExp(`<w:numId w:val="${numId}"/>`).test(x.xml));
    if (!p) return;
    const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p.xml)?.[0] ?? "";
    const titles = (sections[s] ?? []).map((e) => shortTextOrEmpty(field(e, [CORE.title])) || NA);
    const items = (titles.length ? titles : [NA]).map((t) => `<w:p>${pPr}${d.valueRuns(plain(t), "")}</w:p>`).join("");
    doc = doc.slice(0, p.start) + items + doc.slice(p.end);
  });

  // The three alert blocks (Technology, People, Process): from "<Alert Title>" to "<Insert Key Details>".
  const found: { start: number; end: number }[] = [];
  const ps = paragraphs(doc);
  ps.forEach((p, i) => {
    if (!paragraphText(p.xml).includes("<Alert Title>")) return;
    const last = ps.slice(i).find((q) => paragraphText(q.xml).includes("<Insert Key Details>"));
    if (last) found.push({ start: p.start, end: last.end });
  });
  const bullets = bulletNear(doc, "<Insert Key Details>", "12");
  for (let k = Math.min(found.length, SECTIONS.length) - 1; k >= 0; k--) {
    const b = found[k]!;
    const template = doc.slice(b.start, b.end);
    const entries = sections[SECTIONS[k]!] ?? [];
    const filled = entries.length
      ? entries.map((e) => alertBlock(d, template, e, bullets)).join("<w:p/>")
      : `<w:p>${/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(template)?.[0] ?? ""}<w:r><w:t>${NA}</w:t></w:r></w:p>`;
    doc = doc.slice(0, b.start) + filled + doc.slice(b.end);
  }
  d.doc = doc;
  return d.pack();
}

/** One entry in a newsletter section, from the section's block. */
function alertBlock(d: DocxDoc, template: string, e: EntryForDoc, bullets: string): string {
  const date = dateParts(text(e, [CORE.date], ["Event Date"]));
  const publisher = shortTextOrEmpty(field(e, [FIELDS.publisher], ["Publisher", "Source"]));
  const url = text(e, [FIELDS.url], ["URL", "Link"]);
  return fillEach(
    d,
    template,
    [
      { find: "<Alert Title>", value: plain(shortTextOrEmpty(field(e, [CORE.title]))) },
      { find: "Source", value: plain(publisher, url) },
      ...(date
        ? [
            { find: "September 1", value: plain(`${date.month} ${date.day}`) },
            { find: "st", value: plain(date.suffix) },
            { find: "2026", value: plain(String(date.year)) },
          ]
        : [
            { find: "September 1", value: plain("") },
            { find: "st", value: empty },
            { find: ", 2026", value: empty },
          ]),
      { find: "<Insert Macrotrend>", value: plain(shortTextOrEmpty(field(e, [CORE.macrotrend]))) },
      { find: "<Insert Substrend>", value: plain(shortTextOrEmpty(field(e, [CORE.subtrend]))) },
      { find: "<Insert Subtrend>", value: plain(shortTextOrEmpty(field(e, [CORE.subtrend]))) },
    ],
    [
      { find: "<Insert CI Perspective>", text: text(e, [FIELDS.ciPerspective], ["CI Perspective"]), bulletNumId: bullets, bulletBase: 1 },
      { find: "<Insert Key Details>", text: text(e, [FIELDS.keyDetails], ["Key Details"]), bulletNumId: bullets, bulletBase: 1 },
    ],
  );
}
