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
  // Request 66: no “Asset Name” here: “Epilepsy Assets” lists a company's assets (several in a cell, or one per row).
  "Pod (FFA/STAP)",
] as const;
export const EPI_QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

/** Asset Launches (sheet 4). */
export const EPI_LAUNCH_FIELDS = ["Company/competitor", "Asset Name", "MoA", "RoA", "FDA Approval Date", "Approval Date (calculated)"] as const;

/** RCA table (sheet 4). */
export const EPI_RCA_TABLE = ["Asset Name", "Study Name", "RoA (+frequency)", "MoA", "Current Phase", "Epilepsy Indication/ Syndrome", "Approval Date (calculated)", "FDA Approval Date", "NCT Number"] as const;
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
  // Request 67.
  "Study Name",
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
  // Request 67.
  "Study Name",
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

/**
 * Request 65: the revenue figures (and market cap), in US dollars in the
 * workbook. The pages put “(USD)” after their names and abbreviate them
 * (1,000,000,000 → “1 bn”).
 */
export const EPI_USD_FIELDS = [
  "Market Cap",
  "2025 Total Revenue",
  "2025 epilepsy revenue",
  "Q1 2026 Epilepsy Revenue",
  "Q2 2026 Epilepsy Revenue",
  "Q3 2026 Epilepsy Revenue",
  "Q4 2026 Epilepsy Revenue",
  "Total Indication revenue",
] as const;
export const isUsdField = (name: string) => EPI_USD_FIELDS.some((f) => normaliseHeader(f) === normaliseHeader(name));
/** A figure's name as the pages show it: “Market Cap (USD)” for the money ones. */
export const epiLabel = (name: string) => (isUsdField(name) ? `${name} (USD)` : name);

/**
 * Request 65: an amount written short for reading: 1,000,000,000 → “1 bn”,
 * 30,500,000,000 → “30.5 bn”, 540,000,000 → “540 m”, 12,500 → “12.5 k”
 * (three significant figures at most).
 */
export function abbreviate(n: number): string {
  const a = Math.abs(n);
  const [d, u] = a >= 1e12 ? [1e12, " tn"] : a >= 1e9 ? [1e9, " bn"] : a >= 1e6 ? [1e6, " m"] : a >= 1e3 ? [1e3, " k"] : [1, ""];
  const v = n / d;
  const av = Math.abs(v);
  const text = v.toFixed(av >= 100 ? 0 : av >= 10 ? 1 : 2).replace(/\.0+$|(\.\d*?)0+$/, "$1");
  return `${text}${u}`;
}

/** Where each column the pages read is used (Admin → Column names). */
const USED_ON = {
  secondary: "News · Secondary",
  primary: "News · Primary",
  profiles: "Competitor Profiles",
  launches: "Asset Launches",
  rca: "RCA",
  trials: "Trial Tracker",
  assets: "Competitor Profiles · Assets",
} as const;

function columnsOf(lists: [readonly string[], string][]): { name: string; usedOn: string[] }[] {
  const out = new Map<string, { name: string; usedOn: string[] }>();
  for (const [names, page] of lists) {
    for (const name of names) {
      const k = normaliseHeader(name);
      const have = out.get(k) ?? { name, usedOn: [] };
      if (!have.usedOn.includes(page)) have.usedOn.push(page);
      out.set(k, have);
    }
  }
  return [...out.values()];
}

/**
 * Request 65: every column the Epilepsy pages read, sheet by sheet, and the
 * pages that use it. Admin → Column names lists them: each is found in the
 * sheet by its name (case, spacing, punctuation and a currency note like
 * “(USD)” do not matter), or an admin picks the workbook's column for it.
 */
export const EPI_COLUMNS: Record<EpilepsySheet, { name: string; usedOn: string[] }[]> = {
  secondary: columnsOf([[EPI_SECONDARY_FIELDS, USED_ON.secondary]]),
  primary: columnsOf([[EPI_PRIMARY_FIELDS, USED_ON.primary]]),
  profiles: columnsOf([[EPI_PROFILE_FIELDS, USED_ON.profiles]]),
  assets: columnsOf([
    [["Company/competitor", "Asset Name", "MoA", "RoA", "RoA (+frequency)", "Current Phase"], USED_ON.assets],
    [EPI_LAUNCH_FIELDS, USED_ON.launches],
    [EPI_RCA_TABLE, USED_ON.rca],
    [EPI_RCA_PANEL, USED_ON.rca],
    [EPI_TRIAL_TABLE, USED_ON.trials],
  ]),
};

/**
 * Request 67: the Epilepsy pages' tables, each with its columns in their
 * default order. Admin → Table columns sets each table's order.
 */
export const EPI_TABLES = {
  newsPrimary: { label: "News · Primary", columns: EPI_PRIMARY_FIELDS },
  newsSecondary: { label: "News · Secondary", columns: EPI_SECONDARY_FIELDS },
  rca: { label: "RCA", columns: EPI_RCA_TABLE },
  trials: { label: "Trial Tracker", columns: EPI_TRIAL_TABLE },
} as const satisfies Record<string, { label: string; columns: readonly string[] }>;
export type EpiTableKey = keyof typeof EPI_TABLES;
export const EPI_TABLE_KEYS = Object.keys(EPI_TABLES) as EpiTableKey[];

/**
 * A table's columns in the order an admin set (request 67): the saved order
 * of the columns it still has, then any column not in it (added since) where
 * it falls by default. Each column once, under its default spelling.
 */
export function orderColumns(defaults: readonly string[], saved: readonly string[] | undefined): string[] {
  const byKey = new Map(defaults.map((c) => [normaliseHeader(c), c]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of saved ?? []) {
    const k = normaliseHeader(c);
    const name = byKey.get(k);
    if (name && !seen.has(k)) {
      seen.add(k);
      out.push(name);
    }
  }
  defaults.forEach((c, i) => {
    const k = normaliseHeader(c);
    if (seen.has(k)) return;
    seen.add(k);
    // After the column that comes before it by default (else first).
    const before = defaults.slice(0, i).reverse().find((d) => out.includes(d));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, c);
  });
  return out;
}

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
  /** Request 65: when read from the workbook, its dropdowns: column → the options its data validation list allows. */
  lists: z.record(z.string(), z.array(z.string())).optional(),
});
export type EpilepsySheetData = z.infer<typeof EpilepsySheetDataSchema>;

export const EpilepsyDataSchema = z.object({
  sheets: z.object({ secondary: EpilepsySheetDataSchema.nullable(), primary: EpilepsySheetDataSchema.nullable(), profiles: EpilepsySheetDataSchema.nullable(), assets: EpilepsySheetDataSchema.nullable() }),
  /** Company → hex colour (Admin → Epilepsy settings). */
  colours: z.record(z.string(), z.string()),
  /** Request 65: sheet → (column the pages read → the workbook's column), set in Admin → Column names. */
  columnNames: z.partialRecord(z.enum(EPILEPSY_SHEETS), z.record(z.string(), z.string())),
  /** Request 65: sheet → (the workbook's column → the options its dropdown allows), as last read. */
  dropdowns: z.partialRecord(z.enum(EPILEPSY_SHEETS), z.record(z.string(), z.array(z.string()))),
  /** Request 65: sheet → (the workbook's column → options added in Admin): the platform accepts them too (the workbook is not changed). */
  addedOptions: z.partialRecord(z.enum(EPILEPSY_SHEETS), z.record(z.string(), z.array(z.string()))),
  /** Request 67: table → its columns in the order set in Admin → Table columns (none: the default order). */
  columnOrder: z.partialRecord(z.enum(["newsPrimary", "newsSecondary", "rca", "trials"]), z.array(z.string())),
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
  /**
   * Request 65: sheet → (column the pages read → the workbook's column for
   * it). Sent in full: a column left out is found by its own name again.
   */
  columnNames: z.partialRecord(z.enum(EPILEPSY_SHEETS), z.record(z.string().min(1).max(200), z.string().trim().min(1).max(300))).optional(),
  /** Request 65: sheet → (the workbook's dropdown column → options added in Admin). Sent in full. */
  addedOptions: z
    .partialRecord(z.enum(EPILEPSY_SHEETS), z.record(z.string().min(1).max(300), z.array(z.string().trim().min(1, "An option cannot be empty").max(300)).max(500)))
    .optional(),
  /** Request 67: table → its columns in order (each a column of that table). Sent in full: a table left out takes its default order. */
  columnOrder: z.partialRecord(z.enum(["newsPrimary", "newsSecondary", "rca", "trials"]), z.array(z.string().min(1).max(300)).max(200)).optional(),
});

/** Request 65: the options a dropdown column accepts: the workbook's, then those added in Admin (each once). */
export function acceptedOptions(workbook: readonly string[] | undefined, added: readonly string[] | undefined): string[] {
  const out = new Map<string, string>();
  for (const o of [...(workbook ?? []), ...(added ?? [])]) {
    const t = o.trim();
    if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), t);
  }
  return [...out.values()];
}
export const EpilepsySyncRequest = z.object({ force: z.boolean().optional() });

/** Default company colours, in order (a company without one set takes the next). */
export const EPI_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"] as const;

/** The value in a row of a column named (loosely) like `name`. */
export function cellOf(sheet: Pick<EpilepsySheetData, "columns">, row: readonly string[], name: string): string {
  const i = columnIndex(sheet, name);
  return i < 0 ? "" : (row[i] ?? "").trim();
}

/**
 * Request 65: a currency note in a column's name — “(USD)”, “($)”, “(USD bn)”,
 * “[US$ m]”, “in USD” — and the unit it gives the column's plain numbers.
 */
const CURRENCY_NOTE = /\s*(?:[([]\s*(?:in\s+)?(?:(?:usd|us\$|\$|eur|€|gbp|£)\s*(k|m|mn|mm|bn|b|thousands?|millions?|billions?)?|(k|m|mn|mm|bn|b|thousands?|millions?|billions?)\s*(?:usd|us\$|\$|eur|€|gbp|£))\s*[)\]]|\s+in\s+(?:usd|us\$|\$)\s*$|\s+usd\s*$)/i;
const UNIT: Record<string, number> = { k: 1e3, thousand: 1e3, thousands: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, millions: 1e6, b: 1e9, bn: 1e9, billion: 1e9, billions: 1e9 };
/** A column's name without its currency note (“Market Cap (USD)” → “Market Cap”). */
export const withoutCurrencyNote = (header: string) => header.replace(CURRENCY_NOTE, "").trim();
/** What a column's plain numbers are worth, from its currency note (“Revenue (USD m)” → 1,000,000; else 1). */
export function headerScale(header: string | null | undefined): number {
  const m = CURRENCY_NOTE.exec(header ?? "");
  const u = (m?.[1] ?? m?.[2] ?? "").toLowerCase();
  return UNIT[u] ?? 1;
}

const indexCache = new WeakMap<object, { exact: Map<string, number>; loose: Map<string, number> }>();
/** Where a column named (loosely) like `name` is, or -1: its own name first, then its name without a currency note. */
export function columnIndex(sheet: Pick<EpilepsySheetData, "columns">, name: string): number {
  let m = indexCache.get(sheet.columns);
  if (!m) {
    m = { exact: new Map(), loose: new Map() };
    sheet.columns.forEach((c, i) => {
      const k = normaliseHeader(c);
      if (k && !m!.exact.has(k)) m!.exact.set(k, i);
      const l = normaliseHeader(withoutCurrencyNote(c));
      if (l && l !== k && !m!.loose.has(l)) m!.loose.set(l, i);
    });
    indexCache.set(sheet.columns, m);
  }
  const k = normaliseHeader(name);
  return m.exact.get(k) ?? m.loose.get(k) ?? -1;
}

/** The workbook's name of the column the pages read as `name`, or null. */
export function columnHeader(sheet: Pick<EpilepsySheetData, "columns"> | null | undefined, name: string): string | null {
  if (!sheet) return null;
  const i = columnIndex(sheet, name);
  return i < 0 ? null : (sheet.columns[i] ?? null);
}

/**
 * Request 65: a sheet with the columns an admin named (Admin → Column names)
 * under the names the pages read, keeping any currency note (so its unit
 * still counts). A column the sheet has under the page's name, but which is
 * not the one picked, is set aside.
 */
export function withColumnNames(sheet: EpilepsySheetData, names: Record<string, string> | undefined): EpilepsySheetData {
  const pairs = Object.entries(names ?? {}).filter(([k, v]) => k && v);
  if (!pairs.length) return sheet;
  const columns = [...sheet.columns];
  const norm = columns.map(normaliseHeader);
  for (const [want, header] of pairs) {
    const at = norm.indexOf(normaliseHeader(header));
    if (at < 0) continue;
    const note = CURRENCY_NOTE.exec(columns[at] ?? "")?.[0]?.trim();
    const w = normaliseHeader(want);
    columns.forEach((c, i) => {
      if (i !== at && (normaliseHeader(c) === w || normaliseHeader(withoutCurrencyNote(c)) === w)) columns[i] = `${c} [not used]`;
    });
    columns[at] = note && !isUsdField(want) ? want : note ? `${want} ${note}` : want;
  }
  return { ...sheet, columns };
}
