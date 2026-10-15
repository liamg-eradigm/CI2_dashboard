/**
 * Request 61: the Epilepsy project. Its pages are built from four sheets of
 * a SharePoint workbook (“Epilepsy Dashboard Excel.xlsx”), read with
 * Microsoft Graph and kept in step (every minute, or Sync now). The rows are
 * kept as the workbook has them (each sheet's columns, as written); the pages
 * pick the columns they show by name (normalised: case, spacing and
 * punctuation do not matter).
 */
import { z } from "zod";

export const EPILEPSY_SHEETS = ["secondary", "primary", "profiles", "assets"] as const;
export type EpilepsySheet = (typeof EPILEPSY_SHEETS)[number];

/** The sheets as the workbook names them (matched loosely: “3, Platform Competitor Profiles” is “3. Platform …”). */
export const EPILEPSY_SHEET_NAME: Record<EpilepsySheet, string> = {
  secondary: "1. Platform Secondary",
  primary: "2. Platform Primary",
  profiles: "3. Platform Competitor Profiles",
  assets: "4. Platform Trials & Assets",
};

export const EPILEPSY_DEFAULT_FILE = "Epilepsy Dashboard Excel.xlsx";

/** A column name with case, spacing and punctuation left out (“RoA (+ frequency)” = “roafrequency”). */
export const normaliseHeader = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9≥%]+/g, "");

/** Which of the four sheets a worksheet is (by its name), or null. */
export function epilepsySheetOf(name: string): EpilepsySheet | null {
  const n = normaliseHeader(name.replace(/^\s*\d+\s*[.,)]\s*/, ""));
  if (!n.startsWith("platform")) return null;
  if (n.includes("secondary")) return "secondary";
  if (n.includes("primary")) return "primary";
  if (n.includes("profile")) return "profiles";
  if (n.includes("trial") || n.includes("asset")) return "assets";
  return null;
}

/** News → Primary (sheet 2), in this order. */
export const EPI_PRIMARY_FIELDS = ["Event Date", "Source Role", "Source Company", "Source Location", "Source Confidence", "Employee Status", "Insight Topic", "KIQ", "Key Details"] as const;
/** News → Secondary (sheet 1), in this order. */
export const EPI_SECONDARY_FIELDS = ["Date of Newsletter", "Date of News Article", "Article Topic", "Article Title", "URL", "Key Details", "CI Perspective"] as const;

/** Competitor Profiles (sheet 3). */
export const EPI_PROFILE_FIELDS = [
  "Company/competitor",
  "Epilepsy Focus",
  "HQ",
  "Size",
  "Market Cap",
  "2025 Total Revenue",
  "2025 epilepsy revenue",
  "Q1 2026 Epilepsy Revenue",
  "Q2 2026 Epilepsy Revenue",
  "Q3 2026 Epilepsy Revenue",
  "Q4 2026 Epilepsy Revenue",
  "Q1 2026 Marketed Epilepsy Asset Growth",
  "Q2 2026 Marketed Epilepsy Asset Growth",
  "Q3 2026 Marketed Epilepsy Asset Growth",
  "Q4 2026 Marketed Epilepsy Asset Growth",
  "Total Indication revenue",
  "Epilepsy Assets",
  "Recent Relevant Updates",
  "Number of Pipeline Assets",
  "Asset Name",
  "Pod (FFA/STAP)",
] as const;
export const EPI_QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

/** Asset Launches (sheet 4). */
export const EPI_LAUNCH_FIELDS = ["Company/competitor", "Asset Name", "MoA", "RoA", "FDA Approval Date", "Approval Date (calculated)"] as const;

/** RCA table (sheet 4). */
export const EPI_RCA_TABLE = ["Asset Name", "RoA (+frequency)", "MoA", "Current Phase", "Epilepsy Indication/ Syndrome", "Approval Date (calculated)", "FDA Approval Date", "NCT Number"] as const;
/** The trial's results: shared by the RCA panel and the Trial Tracker table. */
const EPI_RESULTS = [
  "Time to Onset of Seizure Response [Response Threshold]",
  "Time to Maximum / Stable Seizure Response",
  "Change in Seizure Severity from Baseline, Non-placebo-adjusted [Instrument]",
  "≥50% Seizure-Reduction Responder Rate",
  "Participants Achieving ≥75% Seizure Reduction",
  "Seizure-Freedom Rate",
  "Efficacy Notes (source, method)",
  "Change in Seizure Frequency from Baseline vs Placebo",
  "Rate of AEs",
  "DC Rate",
  "DC Rate due to AE",
  "SAE Rate",
  "Overall [Dose]",
  "Nausea Rate [Dose]",
  "Vomiting Rate [Dose]",
  "Diarrhea Rate [Dose]",
  "Constipation [Dose]",
  "Fatigue [Dose]",
  "Somnolence Rate [Dose]",
  "Dizziness Rate [Dose]",
  "Change in Quality-of-Life Score",
  "Change in Patient- or Caregiver-Reported Outcome Score",
  "Developmental Milestones",
  "Development Trajectory",
  "Behaviour",
  "Vineland-3 Scores",
  "Communication, Language and socialization",
  "Bayley Scores",
  "Executive Functioning",
  "Neurological Function",
  "Hospitalizations",
  "HCRU",
  "QoL Score",
  "Mortality",
  "Sleep",
  "Caregiver Sleep",
] as const;
/** RCA: a row's panel, one field per line. */
export const EPI_RCA_PANEL = [
  "Company/competitor",
  "Asset Name",
  "RoA",
  "RoA (+frequency)",
  "MoA",
  "MoA (Detailed description)",
  "Asset Characteristics",
  "FDA Approval Date",
  "Approval Date (calculated)",
  "Approved Age Group",
  "Current Phase",
  "Phase 1 Start",
  "Phase 1 PCD",
  "Phase 2 Start",
  "Phase 2 PCD",
  "Phase 3 Start",
  "Phase 3 PCD",
  "Open label extension",
  "Expanded Access programme",
  "Current Trial Status",
  "FDA Submission Date",
  "EMA submission date",
  "Assumptions",
  "Changes in Assumptions",
  "Notes",
  "NCT Number",
  "Asset Class",
  "Molecule",
  "Epilepsy Indication/ Syndrome",
  "Study Duration",
  "Highest Dose Studied",
  "M/F (%)",
  "Dose Escalation",
  "Convenience",
  "Commercial Presence",
  "Cost of Goods",
  "N=/ Enrolment",
  "TAE Rate",
  "Tolerability Notes",
  "Data Qualifiers",
  "Source/Information",
  "Tier of Competitor",
  "Key Inclusion Criteria",
  "Dosing & Regimen",
  "Primary Endpoints",
  "Primary Endpoint Timeframes",
  "Comparator",
  "Age/ Target age group",
  "other Demographics",
  ...EPI_RESULTS,
] as const;
/** Trial Tracker table (sheet 4). */
export const EPI_TRIAL_TABLE = [
  "Company/competitor",
  "Asset Name",
  "RoA (+frequency)",
  "MoA",
  "Current Phase",
  "Current Trial Status",
  "NCT Number",
  "Epilepsy Indication/ Syndrome",
  "Study Duration",
  "M/F (%)",
  "N=/ Enrolment",
  "Key Inclusion Criteria",
  "Dosing & Regimen",
  "Primary Endpoints",
  "Primary Endpoint Timeframes",
  "Comparator",
  "Age/ Target age group",
  "other Demographics",
  ...EPI_RESULTS,
] as const;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const EpilepsySheetDataSchema = z.object({
  /** The worksheet's name in the workbook. */
  name: z.string(),
  /** Its columns, as written (the header row). */
  columns: z.array(z.string()),
  /** Its rows, one value per column (dates as YYYY-MM-DD). */
  rows: z.array(z.array(z.string())),
});
export type EpilepsySheetData = z.infer<typeof EpilepsySheetDataSchema>;

export const EpilepsyDataSchema = z.object({
  sheets: z.object({ secondary: EpilepsySheetDataSchema.nullable(), primary: EpilepsySheetDataSchema.nullable(), profiles: EpilepsySheetDataSchema.nullable(), assets: EpilepsySheetDataSchema.nullable() }),
  /** Company → hex colour (Admin → Epilepsy settings). */
  colours: z.record(z.string(), z.string()),
  syncedAt: z.string().nullable(),
});
export type EpilepsyData = z.infer<typeof EpilepsyDataSchema>;

export const EpilepsySyncStatusSchema = z.object({
  /** never: no workbook set (or never read); error: the last check failed (message says why). */
  status: z.enum(["never", "idle", "syncing", "error"]),
  message: z.string().nullable(),
  link: z.string().nullable(),
  fileName: z.string(),
  file: z.object({ name: z.string().nullable(), url: z.string().nullable(), modifiedAt: z.string().nullable(), modifiedBy: z.string().nullable() }),
  lastCheckedAt: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  /** Rows read from each sheet (null: the sheet was not found). */
  counts: z.record(z.string(), z.number().nullable()),
  /** Microsoft's answer and what to fix, when reading the workbook failed. */
  problem: z.object({ stage: z.string(), message: z.string(), hint: z.string(), status: z.number().nullable(), code: z.string().nullable() }).nullable(),
});
export type EpilepsySyncStatus = z.infer<typeof EpilepsySyncStatusSchema>;

export const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
export const EpilepsySettingsRequest = z.object({
  /** The workbook's SharePoint link (“Copy link” in Excel or SharePoint); empty clears it. */
  link: z.string().trim().max(2000).optional(),
  /** Its file name, used to find it on the site when the link cannot be opened directly. */
  fileName: z.string().trim().min(1).max(200).optional(),
  /** Company → hex colour (#rrggbb); a company left out takes its default colour. */
  colours: z.record(z.string().min(1).max(200), z.string().regex(HEX_COLOUR, "Use a hex colour like #1c9ca5")).optional(),
});
export const EpilepsySyncRequest = z.object({ force: z.boolean().optional() });

/** Default company colours, in order (a company without one set takes the next). */
export const EPI_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"] as const;

/** The value in a row of a column named (loosely) like `name`. */
export function cellOf(sheet: Pick<EpilepsySheetData, "columns">, row: readonly string[], name: string): string {
  const i = columnIndex(sheet, name);
  return i < 0 ? "" : (row[i] ?? "").trim();
}

const indexCache = new WeakMap<object, Map<string, number>>();
/** Where a column named (loosely) like `name` is, or -1. */
export function columnIndex(sheet: Pick<EpilepsySheetData, "columns">, name: string): number {
  let m = indexCache.get(sheet.columns);
  if (!m) {
    m = new Map();
    sheet.columns.forEach((c, i) => {
      const k = normaliseHeader(c);
      if (k && !m!.has(k)) m!.set(k, i);
    });
    indexCache.set(sheet.columns, m);
  }
  return m.get(normaliseHeader(name)) ?? -1;
}
