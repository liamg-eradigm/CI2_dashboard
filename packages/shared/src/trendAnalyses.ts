/**
 * Trend Analyses (request 29, contract 1.18): an analysis of a Macrotrend,
 * Subtrend or competitor, written on the Input page (one at a time or from a
 * spreadsheet). Submitting one replaces the analysis shown on the Trend
 * analysis subtab and in the knowledge graph (the trend's summary), and keeps
 * the submission in the Trend Analyses tracker as a Markdown file.
 */
import { yamlScalar } from "./markdown.js";
import type { TrendLevel } from "./megatrends.js";

/** The first spreadsheet column: which tab the trend is on. */
export const TREND_ANALYSIS_CATEGORIES = ["macrotrend", "competitor"] as const;
export type TrendAnalysisCategory = (typeof TREND_ANALYSIS_CATEGORIES)[number];

export const TREND_CATEGORY_LABEL: Record<TrendAnalysisCategory, string> = {
  macrotrend: "Macrotrend",
  competitor: "Competitor",
};
export const TREND_LEVEL_LABEL: Record<TrendLevel, string> = {
  macro: "Macrotrend",
  sub: "Subtrend",
  competitor: "Competitor",
};

export const categoryOfLevel = (level: TrendLevel): TrendAnalysisCategory => (level === "competitor" ? "competitor" : "macrotrend");

/** The spreadsheet's columns, in order (also the rows of the Markdown file). */
export const TREND_ANALYSIS_COLUMNS = {
  category: "Macrotrend or Competitor",
  level: "Competitor, Macrotrend, or Subtrend",
  name: "Name",
  text: "Trend analysis",
} as const;
export type TrendAnalysisColumn = keyof typeof TREND_ANALYSIS_COLUMNS;

/** Where a submission came from: the Input page form or a spreadsheet. */
export const TREND_ANALYSIS_SOURCES = ["form", "import"] as const;
export type TrendAnalysisSource = (typeof TREND_ANALYSIS_SOURCES)[number];

const word = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");

/** "Macrotrend or Competitor": Macrotrend(s) / Megatrend(s) or Competitor(s), any case. */
export function parseTrendCategory(v: string): TrendAnalysisCategory | null {
  const w = word(v);
  if (["macrotrend", "macrotrends", "megatrend", "megatrends"].includes(w)) return "macrotrend";
  if (["competitor", "competitors"].includes(w)) return "competitor";
  return null;
}

/** "Competitor, Macrotrend, or Subtrend", any case. */
export function parseTrendLevel(v: string): TrendLevel | null {
  const w = word(v);
  if (["macrotrend", "macrotrends", "megatrend", "megatrends", "macro"].includes(w)) return "macro";
  if (["subtrend", "subtrends", "sub"].includes(w)) return "sub";
  if (["competitor", "competitors"].includes(w)) return "competitor";
  return null;
}

/**
 * A Macrotrend's analysis in sections (request 34): one per text cell of its
 * dashboard. Each is optional; a submission changes only the sections it
 * fills in. `cell` is the dashboard heading ({name} = the Macrotrend).
 */
export const MACRO_SECTIONS = [
  { key: "overview", label: "Macrotrend overview", cell: "What is {name}?" },
  { key: "why", label: "Why does it matter?", cell: "Why does it matter?" },
  { key: "current", label: "Current Landscape", cell: "Current Landscape" },
  { key: "longterm", label: "Long-Term Landscape", cell: "Long-Term Landscape" },
  { key: "next", label: "What's Next?", cell: "What's Next?" },
  { key: "abbvie", label: "Impact on AbbVie", cell: "Impact on AbbVie" },
] as const;
export const MACRO_SECTION_KEYS = ["overview", "why", "current", "longterm", "next", "abbvie"] as const;
export type MacroSectionKey = (typeof MACRO_SECTION_KEYS)[number];
export const macroSectionLabel = (k: MacroSectionKey) => MACRO_SECTIONS.find((x) => x.key === k)!.label;
export const macroSectionCell = (k: MacroSectionKey, name: string) => MACRO_SECTIONS.find((x) => x.key === k)!.cell.replace("{name}", name);
/** The Macrotrend sections spreadsheet: "Macrotrend", then one column per section. */
export const MACRO_SECTIONS_MACRO_COLUMN = "Macrotrend";
export const MACRO_SECTIONS_COLUMNS = [MACRO_SECTIONS_MACRO_COLUMN, ...MACRO_SECTIONS.map((x) => x.label)];

export interface TrendAnalysisDoc {
  level: TrendLevel;
  name: string;
  /** A Subtrend's Macrotrend. */
  parent: string | null;
  text: string;
  /** A Macrotrend's sections submission (request 34): only the sections filled in. */
  sections?: Partial<Record<MacroSectionKey, string>> | null;
  submittedAt: string;
  submittedBy: string;
}

const row = (key: string, v: string) => {
  const s = yamlScalar(v.replace(/\s*\n\s*/g, " ").trim());
  return `${key}:${s ? ` ${s}` : ""}`;
};

/**
 * The Markdown file of a submission: one row per spreadsheet column (the
 * analysis itself as the last row, kept with its paragraphs) and the date of
 * submission.
 */
export function trendAnalysisMarkdown(a: TrendAnalysisDoc): string {
  return [
    "---",
    row("Macrotrend_or_Competitor", TREND_CATEGORY_LABEL[categoryOfLevel(a.level)]),
    row("Competitor_Macrotrend_or_Subtrend", TREND_LEVEL_LABEL[a.level]),
    row("Name", a.name),
    ...(a.level === "sub" && a.parent ? [row("Macrotrend", a.parent)] : []),
    row("Date_of_submission", a.submittedAt.slice(0, 10)),
    row("Submitted_by", a.submittedBy),
    "---",
    ...(a.sections
      ? MACRO_SECTIONS.filter((x) => a.sections?.[x.key]?.trim()).flatMap((x, i) => [...(i ? [""] : []), `## ${x.label}`, a.sections![x.key]!.trim()])
      : ["## Trend analysis", a.text.trim()]),
    "",
  ].join("\n");
}

/** e.g. Trend_analysis_Subtrend_Agentic_AI_Platforms_2026-10-05.md */
export function trendAnalysisFileName(a: Pick<TrendAnalysisDoc, "level" | "name" | "submittedAt">): string {
  const safe = `${TREND_LEVEL_LABEL[a.level]}_${a.name}`
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return `Trend_analysis_${safe}_${a.submittedAt.slice(0, 10)}.md`;
}
