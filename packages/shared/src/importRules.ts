/**
 * What the spreadsheet import accepts for each column, derived from the
 * stream's current Inbox columns (so it follows every change made under
 * Inbox → Edit columns), and forgiving matching of dropdown values.
 */
import { AUTO_KEYS, CORE, hasOptions, macrotrends, optionsOf, sortedColumns, subtrendsOf, type TrackerColumn, type TrackerSchema } from "./schema.js";

/**
 * A dropdown value folded for matching: case, spacing, curly vs straight
 * quotes, dash types and Unicode forms do not matter.
 */
export function foldOption(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The configured option a value means: exact, else the one option it matches when folded. */
export function matchOption(value: string, options: readonly string[]): string | null {
  if (options.includes(value)) return value;
  const f = foldOption(value);
  const hits = options.filter((o) => foldOption(o) === f);
  return hits.length === 1 ? (hits[0] as string) : null;
}

/** "A, B, C" (the first `max`, then "and N more"). */
export function listOptions(options: readonly string[], max = 15): string {
  if (!options.length) return "none configured";
  const shown = options.slice(0, max).join(", ");
  return options.length > max ? `${shown} and ${options.length - max} more` : shown;
}

export interface ImportColumnRule {
  key: string;
  label: string;
  required: boolean;
  /** Plain-language description of what the column accepts. */
  accepts: string;
  /** The allowed values of a dropdown column (Subtrend: every subtrend). */
  options?: string[];
}

/** The columns a spreadsheet for this stream may have, in Inbox order, with what each accepts. */
export function importRules(schema: TrackerSchema): ImportColumnRule[] {
  return sortedColumns(schema)
    .filter((c) => !AUTO_KEYS.includes(c.key))
    .map((c) => ({ key: c.key, label: c.label, required: c.required, accepts: accepts(schema, c), ...(hasOptions(c) ? { options: optionsOf(schema, c) } : {}) }));
}

function accepts(schema: TrackerSchema, c: TrackerColumn): string {
  switch (c.type) {
    case "date":
      return "A date: YYYY-MM-DD, DD/MM/YYYY or an Excel date";
    case "text":
      return "Text (up to 2,000 characters)";
    case "long":
      return "Long text (up to 20,000 characters; line breaks are kept)";
    case "multi":
      return "One or more of the options, separated by commas";
    case "macro":
      return "One of the macrotrends";
    case "sub":
      return `A subtrend of the row's ${schema.columns.find((x) => x.key === CORE.macrotrend)?.label ?? "Macrotrend"}`;
    default:
      return "One of the options";
  }
}

/** The import template's extra sheets: every dropdown column's options, and the subtrends of each macrotrend. */
export function optionSheets(schema: TrackerSchema): { name: string; table: string[][] }[] {
  const dropdowns = sortedColumns(schema).filter((c) => hasOptions(c) && c.type !== "sub" && !AUTO_KEYS.includes(c.key));
  const lists = dropdowns.map((c) => optionsOf(schema, c));
  const height = Math.max(0, ...lists.map((l) => l.length));
  const options = [dropdowns.map((c) => c.label), ...Array.from({ length: height }, (_, i) => lists.map((l) => l[i] ?? ""))];
  const macroLabel = schema.columns.find((c) => c.key === CORE.macrotrend)?.label ?? "Macrotrend";
  const subLabel = schema.columns.find((c) => c.key === CORE.subtrend)?.label ?? "Subtrend";
  const subs = [[macroLabel, subLabel], ...macrotrends(schema).flatMap((m) => subtrendsOf(schema, m).map((s) => [m, s]))];
  return [
    { name: "Options", table: options },
    { name: "Subtrends", table: subs },
  ];
}
