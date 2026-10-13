/**
 * Request 55 (contract 2.1): the Test tab and its SharePoint workbook.
 *
 * Admins see a test space on the Test tab: a copy of the Database, the
 * Megatrends Dashboard and the Primary Tracker whose contents come only from
 * the workbook "Power_Automate_Test.xlsx" on SharePoint, kept in step every
 * minute (and on Sync now). The workbook has four sheets whose columns are the
 * fields of the matching input: Primary and Secondary (the Trackers' columns),
 * Competitor Trend Analysis (a competitor's Company Profile) and Macrotrend
 * Analysis (a Macrotrend's sections).
 */
import { z } from "zod";
import { MACRO_SECTIONS, MACRO_SECTIONS_MACRO_COLUMN, type MacroSectionKey } from "./trendAnalyses.js";

/** Requests in the test space carry this header (`test`); the API then reads and writes the test space. */
export const SPACE_HEADER = "x-eradigm-space";
export const SPACES = ["live", "test"] as const;
export type Space = (typeof SPACES)[number];
/** The Test tab's pages live under this path (the same pages as the live ones, in the test space). */
export const TEST_PATH_PREFIX = "/test";

export const EXCEL_WORKBOOK_NAME = "Power_Automate_Test.xlsx";
export const EXCEL_SHEET_KINDS = ["primary", "secondary", "competitor", "macrotrend"] as const;
export type ExcelSheetKind = (typeof EXCEL_SHEET_KINDS)[number];
export const EXCEL_SHEETS: Record<ExcelSheetKind, string> = {
  primary: "Primary",
  secondary: "Secondary",
  competitor: "Competitor Trend Analysis",
  macrotrend: "Macrotrend Analysis",
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which input a sheet feeds, by its name (any case or spacing; "Primary Tracker" too); null: not one of the four. */
export function sheetKindOf(name: string): ExcelSheetKind | null {
  const n = squash(name);
  for (const k of EXCEL_SHEET_KINDS) if (n === squash(EXCEL_SHEETS[k]) || n === `${squash(EXCEL_SHEETS[k])}tracker`) return k;
  if (n === "competitortrendanalyses" || n === "competitoranalysis" || n === "competitors") return "competitor";
  if (n === "macrotrendanalyses" || n === "macrotrends" || n === "macrotrendsections") return "macrotrend";
  return null;
}

/**
 * Input Trend Analysis → Competitor: the competitor and its Company Profile.
 * The first name of each list is the field's; the others are also accepted
 * (the trend analyses import's columns among them).
 */
export const COMPETITOR_COLUMNS = {
  name: ["Competitor", "Name", "Company", "Competitor name"],
  text: ["Company Profile", "Trend analysis", "Profile", "Company profile text"],
} as const;

/** Input Trend Analysis → Macrotrend: the Macrotrend and one column per section (its label, or the question the form asks). */
export const MACROTREND_COLUMNS: { name: readonly string[]; sections: Record<MacroSectionKey, readonly string[]> } = {
  name: [MACRO_SECTIONS_MACRO_COLUMN, "Name", "Macrotrend name"],
  sections: Object.fromEntries(
    MACRO_SECTIONS.map((x) => [x.key, [x.label, x.cell, ...(x.key === "overview" ? ["Overview", "What is it?", "What is the Macrotrend?"] : [])]]),
  ) as unknown as Record<MacroSectionKey, readonly string[]>,
};

/** Whether a sheet's column is one of these names (any case, spacing or punctuation; "What is {name}?" counts for any name). */
export function columnIs(header: string, names: readonly string[]): boolean {
  const h = squash(header);
  return names.some((n) => (n.includes("{name}") ? h.startsWith(squash(n.slice(0, n.indexOf("{name}")))) && h.length > squash(n.slice(0, n.indexOf("{name}"))).length : h === squash(n)));
}

export const WorkbookFileSchema = z.object({
  name: z.string(),
  size: z.number().nullable(),
  lastModified: z.string().nullable(),
  lastModifiedBy: z.string().nullable(),
  webUrl: z.string().nullable(),
  version: z.string(),
});

export const GraphProblemSchema = z.object({
  stage: z.enum(["config", "token", "file", "download", "read"]),
  status: z.number().nullable(),
  code: z.string().nullable(),
  message: z.string(),
  /** What to fix, in plain words. */
  hint: z.string(),
  /** Microsoft's request id, for a support ticket. */
  requestId: z.string().nullable(),
});

/** GET /api/excel/check: can the API read the workbook? Each step, then the sheets with their columns. */
export const ExcelCheckSchema = z.object({
  ok: z.boolean(),
  steps: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })),
  file: WorkbookFileSchema.nullable(),
  sheets: z.array(z.object({ name: z.string(), columns: z.array(z.string()), rows: z.number() })),
  error: GraphProblemSchema.nullable(),
});
export type ExcelCheck = z.infer<typeof ExcelCheckSchema>;

export const ExcelIssueSchema = z.object({
  sheet: z.string(),
  /** The Excel row number (the header is row 1 when it is the first row). */
  row: z.number().nullable(),
  column: z.string().nullable(),
  message: z.string(),
});
export type ExcelIssue = z.infer<typeof ExcelIssueSchema>;

export const ExcelSheetReportSchema = z.object({
  name: z.string(),
  kind: z.enum([...EXCEL_SHEET_KINDS, "ignored"]),
  rows: z.number(),
  /** Columns read (as written in the sheet). */
  columns: z.array(z.string()),
  /** Columns that are not a field of that input (left out). */
  ignored: z.array(z.string()),
});

/** The sync from the workbook into the test space (GET /api/excel/status, POST /api/excel/sync). */
export const ExcelSyncStatusSchema = z.object({
  /** All five SharePoint secrets are set. */
  configured: z.boolean(),
  missing: z.array(z.string()),
  /** The test space exists (it is made on the first sync). */
  linked: z.boolean(),
  status: z.enum(["never", "idle", "syncing", "error"]),
  message: z.string().nullable(),
  /** The last problem reaching the workbook, with what to fix. */
  problem: GraphProblemSchema.nullable(),
  file: z.object({ name: z.string(), url: z.string().nullable(), modifiedAt: z.string().nullable(), modifiedBy: z.string().nullable() }).nullable(),
  lastCheckedAt: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastChangeAt: z.string().nullable(),
  /** More changes are waiting (large changes are applied a few rows at a time on the Workers Free plan). */
  more: z.boolean(),
  /** What this run changed. */
  applied: z.object({ created: z.number(), updated: z.number(), deleted: z.number(), trends: z.number() }),
  sheets: z.array(ExcelSheetReportSchema),
  issues: z.array(ExcelIssueSchema),
  /** What the test space holds now. */
  counts: z.object({ primary: z.number(), secondary: z.number(), competitors: z.number(), macrotrends: z.number() }).nullable(),
});
export type ExcelSyncStatus = z.infer<typeof ExcelSyncStatusSchema>;

export const ExcelSyncRequest = z.object({
  /** Read the workbook even if it has not changed (and copy the live workspace's columns and settings again). */
  force: z.boolean().optional(),
});
