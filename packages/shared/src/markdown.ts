/**
 * Phantoms Markdown: generated from a tracker entry's field values only.
 * Primary and Secondary entries have different fields and sections (below);
 * the layout rules are the same.
 *
 * The front matter keeps the agreed keys, order and nesting, written as valid
 * YAML (two-space indentation; a value is double-quoted only when it would
 * otherwise be misread, e.g. "Roche: new lab", "#1", "true" or "007").
 * Empty fields are written as `key:` (YAML null). The three sections are
 * copied verbatim, keeping paragraphs and line breaks.
 */
import { CORE, DEFAULT_KEYS, FIELDS, type Stream } from "./schema.js";
import type { FieldValue, ItemValues } from "./validation.js";

export interface MarkdownMeta {
  /** Name of the person who approved the entry (QC.Reviewed_by). */
  reviewedBy: string | null;
  /**
   * Secondary: the key of the "Tell Me More" column, if the Inbox has one. Its
   * text is printed under Key Details, as part of that section (no heading).
   */
  tellMeMoreKey?: string | null;
}

/** The Secondary Inbox column labelled "Tell Me More" (any case or punctuation), if there is one. */
export function tellMeMoreKey(columns: readonly { key: string; label: string }[]): string | null {
  return columns.find((c) => c.label.toLowerCase().replace(/[^a-z]/g, "") === "tellmemore")?.key ?? null;
}

const RESERVED = /^(true|false|yes|no|on|off|y|n|null|~)$/i;
const NUMBER = /^[-+]?(\.\d+|\d[\d_]*(\.\d*)?)([eE][-+]?\d+)?$|^0x[0-9a-f]+$|^0o[0-7]+$|^[-+]?\.(inf|nan)$/i;

/** A value as a YAML scalar: plain when safe, otherwise double-quoted. Empty → "" (written as `key:`). */
export function yamlScalar(value: string): string {
  if (value === "") return "";
  const needsQuotes =
    RESERVED.test(value) ||
    NUMBER.test(value) ||
    /^[\s]|[\s]$/.test(value) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /:(\s|$)|\s#/.test(value) ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value);
  if (!needsQuotes) return value;
  const esc = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `"${esc}"`;
}

function text(v: FieldValue | undefined): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return v;
}

function line(indent: number, key: string, v: FieldValue | undefined | string): string {
  const s = yamlScalar(typeof v === "string" ? v.replace(/\s*\n\s*/g, " ").trim() : text(v));
  return `${"  ".repeat(indent)}${key}:${s ? ` ${s}` : ""}`;
}

const section = (values: ItemValues, title: string, k: string) => `## ${title}\n${text(values[k]).trim()}`;

function render(frontMatter: string[], sections: string[]): string {
  return `${["---", ...frontMatter, "---"].join("\n")}\n${sections.join("\n\n")}\n`;
}

/**
 * Primary sources: every Primary field except the Tracker/Dashboard
 * classification (Macrotrend, Subtrend, Growth Intensity, Impact, Source Type,
 * Competitors). Source details are grouped under `Source:`.
 */
export function primaryMarkdown(values: ItemValues): string {
  const v = (k: string) => values[k];
  return render(
    [
      line(0, "id", v(FIELDS.id)),
      line(0, "title", v(CORE.title)),
      line(0, "event_date", v(CORE.date)),
      "Source:",
      line(1, "Role", v(FIELDS.sourceRole)),
      line(1, "Company", v(FIELDS.sourceCompany)),
      line(1, "Location", v(FIELDS.sourceLocation)),
      line(1, "Confidence", v(FIELDS.sourceConfidence)),
      line(1, "Therapeutic_area", v(FIELDS.sourceTherapeuticArea)),
      line(1, "Brand_or_asset", v(FIELDS.sourceBrandAsset)),
      line(0, "Action", v(DEFAULT_KEYS.action)),
      line(0, "Workstream", v(FIELDS.workstream)),
      line(0, "Insight_topic", v(FIELDS.insightTopic)),
    ],
    [section(values, "Key Intelligence Question", FIELDS.keyQuestion), section(values, "Key Details", FIELDS.keyDetails), section(values, "Key Metrics", FIELDS.keyMetrics)],
  );
}

/** The Markdown document for one entry (Primary or Secondary layout). */
export function entryMarkdown(values: ItemValues, meta: MarkdownMeta, stream: Stream = "secondary"): string {
  if (stream === "primary") return primaryMarkdown(values);
  return secondaryMarkdown(values, meta);
}

/** Secondary sources: the agreed layout with Source and QC groups. */
export function secondaryMarkdown(values: ItemValues, meta: MarkdownMeta): string {
  const v = (k: string) => values[k];
  const fm = [
    line(0, "id", v(FIELDS.id)),
    line(0, "title", v(CORE.title)),
    line(0, "event_date", v(CORE.date)),
    line(0, "source_type", v(DEFAULT_KEYS.source)),
    "Source:",
    line(1, "Publisher", v(FIELDS.publisher)),
    line(1, "URL", v(FIELDS.url)),
    line(1, "Raw_ref", v(FIELDS.rawRef)),
    line(0, "Source_tier", v(FIELDS.sourceTier)),
    line(0, "Competitors", v(CORE.competitors)),
    line(0, "Other_entities", v(FIELDS.otherEntities)),
    line(0, "Therapeutic_area", v(FIELDS.therapeuticArea)),
    line(0, "Assets", v(FIELDS.assets)),
    line(0, "Products", v(FIELDS.products)),
    "QC:",
    line(1, "Reviewed_by", meta.reviewedBy ?? ""),
    line(1, "Review_date", v(FIELDS.reviewDate)),
    line(1, "Accurate_as_of", v(CORE.date)),
  ];
  // Key Details, continued with Tell Me More (when the column exists and has text).
  const more = meta.tellMeMoreKey ? text(values[meta.tellMeMoreKey]).trim() : "";
  const details = section(values, "Key Details", FIELDS.keyDetails);
  return render(fm, [section(values, "Header", FIELDS.header), more ? `${details}\n\n${more}` : details, section(values, "CI Perspective", FIELDS.ciPerspective)]);
}

/** Safe download name: the entry's ID, else the signal code. */
export function markdownFileName(values: ItemValues, fallback: string): string {
  const id = text(values[FIELDS.id]).trim() || fallback;
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|_+$/g, "").slice(0, 100);
  return `${safe || fallback}.md`;
}
