/**
 * Reading the Epilepsy workbook's sheets (request 61): rows as records by
 * column name (loosely matched), numbers and money as written, dates, and
 * each company's colour.
 */
import { EPI_PALETTE, cellOf, columnIndex, normaliseHeader, type EpilepsyData, type EpilepsySheetData } from "@eradigm/shared";

/** A sheet's row: its values by column name, and its place in the sheet. */
export type Rec = { i: number; get: (name: string) => string };

export function records(sheet: EpilepsySheetData | null | undefined): Rec[] {
  if (!sheet) return [];
  return sheet.rows.map((row, i) => ({ i, get: (name: string) => cellOf(sheet, row, name) }));
}

/** Whether the sheet has a column named (loosely) like this. */
export const hasColumn = (sheet: EpilepsySheetData | null | undefined, name: string) => !!sheet && columnIndex(sheet, name) >= 0;

/** A number in a cell (“$12.5bn”, “1,234”, “-25%”, “4.2 B”) in plain units, or null. Percentages stay as their number (25% → 25). */
export function parseAmount(v: string): number | null {
  const s = v.replace(/[,\s]/g, "").replace(/[$£€¥]|USD|GBP|EUR/gi, "");
  const m = /^(-|−)?(\d+(?:\.\d+)?)(%|k|m|mn|mm|b|bn|t|tn|thousand|million|billion|trillion)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[2]) * (m[1] ? -1 : 1);
  const unit = (m[3] ?? "").toLowerCase();
  const mult: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
  return n * (mult[unit] ?? 1);
}

/** An amount of money for reading (“$12.5B”). */
export function money(n: number): string {
  const a = Math.abs(n);
  const [d, u] = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  const v = n / d;
  return `$${v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2).replace(/\.0+$/, "")}${u}`;
}

/** YYYY-MM-DD at the start of a cell (the API writes dates so), or null. */
export const isoDate = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** A date for reading: 14 Oct 2026 (anything else as written). */
export function showDate(v: string): string {
  const d = isoDate(v);
  if (!d) return v;
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

/** Split a list written in one cell (commas, semicolons, new lines, bullets). */
export const splitList = (v: string) =>
  v
    .split(/[\n;,•]+/)
    .map((x) => x.replace(/^\s*[-–*]\s*/, "").trim())
    .filter(Boolean);

export const sameName = (a: string, b: string) => normaliseHeader(a) === normaliseHeader(b);

/** Every company of the workbook (Competitor Profiles, then Trials & Assets), as first written. */
export function companies(data: EpilepsyData | undefined): string[] {
  const seen = new Map<string, string>();
  for (const sheet of [data?.sheets.profiles, data?.sheets.assets]) {
    for (const r of records(sheet)) {
      const c = r.get("Company/competitor");
      if (c && !seen.has(normaliseHeader(c))) seen.set(normaliseHeader(c), c);
    }
  }
  return [...seen.values()];
}

/** Each company's colour: the one an admin set, else the next of the default palette (in the workbook's order, so it never changes with a filter). */
export function colourMap(data: EpilepsyData | undefined): (company: string) => string {
  const set = new Map(Object.entries(data?.colours ?? {}).map(([k, v]) => [normaliseHeader(k), v]));
  const order = companies(data);
  const auto = new Map<string, string>();
  let next = 0;
  for (const c of order) {
    const k = normaliseHeader(c);
    if (!set.has(k)) auto.set(k, EPI_PALETTE[next++ % EPI_PALETTE.length] as string);
  }
  return (company: string) => {
    const k = normaliseHeader(company);
    return set.get(k) ?? auto.get(k) ?? "#7e95a1";
  };
}

/** A URL in a cell, made safe to link to (http/https only). */
export function safeUrl(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A date written loosely (“2027-06-30”, “Q3 2027”, “H2 2027”, “2028”, “Jun 2027”) as a time and how precise it is, or null. */
export function looseDate(v: string): { t: number; label: string } | null {
  const s = v.trim();
  if (!s) return null;
  const iso = isoDate(s);
  if (iso) return { t: Date.parse(`${iso}T00:00:00Z`), label: showDate(iso) };
  const q = /^q([1-4])\s*[-/ ]?\s*((?:19|20)\d\d)$/i.exec(s) ?? /^((?:19|20)\d\d)\s*[-/ ]?\s*q([1-4])$/i.exec(s);
  if (q) {
    const [qq, yy] = /^q/i.test(s) ? [Number(q[1]), Number(q[2])] : [Number(q[2]), Number(q[1])];
    return { t: Date.UTC(yy, (qq - 1) * 3 + 1, 15), label: `Q${qq} ${yy}` };
  }
  const h = /^h([12])\s*((?:19|20)\d\d)$/i.exec(s);
  if (h) return { t: Date.UTC(Number(h[2]), h[1] === "1" ? 3 : 9, 1), label: `H${h[1]} ${h[2]}` };
  const y = /^((?:19|20)\d\d)$/.exec(s);
  if (y) return { t: Date.UTC(Number(y[1]), 6, 1), label: y[1]! };
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return { t: parsed, label: s };
  return null;
}
