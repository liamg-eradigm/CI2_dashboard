/** Request 61: a company's profile (sheet 3) and its assets (sheet 3's lists, with sheet 4's details). */
import { EPI_QUARTERS, normaliseHeader, type EpilepsyData } from "@eradigm/shared";
import { parseAmount, records, splitList, type Rec } from "./model";

export type Profile = {
  name: string;
  /** The first value the company's rows give for a column. */
  field: (name: string) => string;
  marketCap: number | null;
  /** Q1–Q4 2026 epilepsy revenue. */
  revenue: (number | null)[];
  growth: (string | null)[];
};

export type Asset = { company: string; name: string; moa: string; roa: string; phase: string };

const key = normaliseHeader;

/** The companies of Competitor Profiles (else of Trials & Assets), as first written. */
export function profileCompanies(data: EpilepsyData | undefined): string[] {
  const seen = new Map<string, string>();
  const from = records(data?.sheets.profiles).length ? records(data?.sheets.profiles) : records(data?.sheets.assets);
  for (const r of from) {
    const c = r.get("Company/competitor");
    if (c && !seen.has(key(c))) seen.set(key(c), c);
  }
  return [...seen.values()];
}

export function profileOf(data: EpilepsyData | undefined, company: string): Profile {
  const rows = records(data?.sheets.profiles).filter((r) => key(r.get("Company/competitor")) === key(company));
  const field = (name: string) => rows.map((r) => r.get(name)).find(Boolean) ?? "";
  return {
    name: company,
    field,
    marketCap: parseAmount(field("Market Cap")),
    revenue: EPI_QUARTERS.map((q) => parseAmount(field(`${q} 2026 Epilepsy Revenue`))),
    growth: EPI_QUARTERS.map((q) => field(`${q} 2026 Marketed Epilepsy Asset Growth`) || null),
  };
}

/** A company's epilepsy assets: those listed in Epilepsy Assets (and Asset Name) in its profile, with MoA, RoA and phase from Trials & Assets. */
export function assetsOf(data: EpilepsyData | undefined, company: string): Asset[] {
  const prof = records(data?.sheets.profiles).filter((r) => key(r.get("Company/competitor")) === key(company));
  const trials = records(data?.sheets.assets);
  const names = new Map<string, string>();
  for (const r of prof) for (const n of [...splitList(r.get("Epilepsy Assets")), ...splitList(r.get("Asset Name"))]) if (!names.has(key(n))) names.set(key(n), n);
  const detail = (asset: string, name: string, rowsOf: Rec[]) => rowsOf.filter((t) => key(t.get("Asset Name")) === key(asset)).map((t) => t.get(name)).find(Boolean) ?? "";
  return [...names.values()].map((n) => {
    const own = trials.filter((t) => key(t.get("Company/competitor")) === key(company));
    const pool = own.some((t) => key(t.get("Asset Name")) === key(n)) ? own : trials;
    return {
      company,
      name: n,
      moa: detail(n, "MoA", pool),
      roa: detail(n, "RoA (+frequency)", pool) || detail(n, "RoA", pool),
      phase: detail(n, "Current Phase", pool),
    };
  });
}

export const isApproved = (phase: string) => /^approved\b/i.test(phase.trim());
