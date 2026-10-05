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

export interface TrendAnalysisDoc {
  level: TrendLevel;
  name: string;
  /** A Subtrend's Macrotrend. */
  parent: string | null;
  text: string;
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
    "## Trend analysis",
    a.text.trim(),
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
