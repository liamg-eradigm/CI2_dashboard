/**
 * Request 64 (CI SQUARED): Earnings Calls. An analyst attaches the call's
 * report (.docx) on the Input page and fills in its text fields; the platform
 * writes a Markdown file of those fields (each field's name on one line, its
 * text below, an empty line between fields). Database → Earnings Calls lists
 * them: the report, the Markdown and each field.
 */
import { z } from "zod";

/** The text fields, in order (the Database's columns after Report and Markdown). */
export const EARNINGS_CALL_FIELDS = [
  { key: "quarter", label: "Quarter", long: false },
  { key: "competitor", label: "Competitor", long: false },
  { key: "tagline", label: "Main Tagline", long: false },
  { key: "loe", label: "Patent Expiry / LOE Response", long: true },
  { key: "aiTools", label: "AI & Automation Tools", long: true },
  { key: "dtp", label: "Direct-to-Patient Strategy", long: true },
  { key: "ira", label: "IRA Pricing / Tariffs", long: true },
  { key: "investment", label: "Strategic Investment & Redeployment", long: true },
  { key: "trends", label: "Observed Trends", long: true },
] as const;
export type EarningsCallField = (typeof EARNINGS_CALL_FIELDS)[number]["key"];
export const EARNINGS_CALL_KEYS = EARNINGS_CALL_FIELDS.map((f) => f.key) as EarningsCallField[];

/** The largest report accepted. */
export const MAX_EARNINGS_REPORT_BYTES = 10 * 1024 * 1024;
export const MAX_EARNINGS_FIELD = 20_000;

const text = z.string().max(MAX_EARNINGS_FIELD);
export const EarningsCallValuesSchema = z.object({
  quarter: z.string().trim().min(1, "Give the quarter").max(40),
  /** Request 64b: one of the Secondary Tracker's Competitors options (the API checks). */
  competitor: z.string().trim().min(1, "Choose the competitor").max(200),
  tagline: text.default(""),
  loe: text.default(""),
  aiTools: text.default(""),
  dtp: text.default(""),
  ira: text.default(""),
  investment: text.default(""),
  trends: text.default(""),
});
export type EarningsCallValues = z.infer<typeof EarningsCallValuesSchema>;

export const EarningsCallSchema = EarningsCallValuesSchema.extend({
  id: z.string(),
  /** The report's file name (.docx). */
  reportName: z.string(),
  reportSize: z.number(),
  submittedAt: z.string(),
  submittedBy: z.string().nullable(),
});
export type EarningsCall = z.infer<typeof EarningsCallSchema>;

/**
 * The Markdown of an earnings call: each field's name on one line, its text
 * below it, and an empty line between fields (every field, in order).
 */
export function earningsCallMarkdown(v: Partial<Record<EarningsCallField, string>>): string {
  return `${EARNINGS_CALL_FIELDS.map((f) => `${f.label}\n${(v[f.key] ?? "").trim()}`).join("\n\n")}\n`;
}

/** The Markdown file's name: competitor and quarter (“J&J Q3 2024.md”), safe on any computer. */
export function earningsCallFileName(v: Pick<EarningsCallValues, "competitor" | "quarter">): string {
  const base = `${v.competitor} ${v.quarter}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return `${base || "earnings-call"}.md`;
}
