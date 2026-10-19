/**
 * Request 68: NSO Comparator (non-seizure outcomes). Each company's NSO
 * profile, from the Competitor Profiles sheet: its text fields, and a chart
 * of up to six bars (x1 to x6, a name and a value each) against its metric.
 * A company's block of rows may give one profile per asset (Epilepsy Assets
 * on the same row), or one for the company.
 */
import { EPI_NSO_BARS, EPI_NSO_METRIC, EPI_NSO_TEXT, EPI_NSO_XAXIS, normaliseHeader, type EpilepsyData } from "@eradigm/shared";
import { parseAmount, records, splitList } from "./model";

export type NsoBar = { name: string; raw: string; value: number };
export type NsoProfile = {
  /** The assets of the row it was written on (Epilepsy Assets), or none (the company's). */
  assets: string[];
  text: Record<(typeof EPI_NSO_TEXT)[number], string>;
  /** The y-axis: the metric and its unit. */
  metric: string;
  /** Request 69: the x-axis title. */
  xAxis: string;
  bars: NsoBar[];
};

/** A company's NSO profiles: one per row of its block that gives any NSO field. */
export function nsoOf(data: EpilepsyData | undefined, company: string): NsoProfile[] {
  const key = normaliseHeader(company);
  const out: NsoProfile[] = [];
  for (const r of records(data?.sheets.profiles)) {
    if (normaliseHeader(r.get("Company/competitor")) !== key) continue;
    const text = Object.fromEntries(EPI_NSO_TEXT.map((f) => [f, r.get(f)])) as NsoProfile["text"];
    const bars: NsoBar[] = [];
    for (const b of EPI_NSO_BARS) {
      const name = r.get(b.name);
      const raw = r.get(b.value);
      const value = parseAmount(raw);
      if ((name || raw) && value != null) bars.push({ name: name || b.name.replace(" name", ""), raw, value });
    }
    const metric = r.get(EPI_NSO_METRIC);
    const xAxis = r.get(EPI_NSO_XAXIS);
    if (!Object.values(text).some(Boolean) && !bars.length && !metric) continue;
    out.push({ assets: splitList(r.get("Epilepsy Assets")), text, metric, xAxis, bars });
  }
  return out;
}
