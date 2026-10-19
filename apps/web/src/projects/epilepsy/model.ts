/**
 * Reading the Epilepsy workbook's sheets (request 61): rows as records by
 * column name (loosely matched), numbers and money as written, dates, and
 * each company's colour.
 */
import { EPI_PALETTE, EPI_TABLES, abbreviate, orderColumns, type EpiTableKey, cellOf, columnIndex, normaliseHeader, type EpilepsyData, type EpilepsySheet, type EpilepsySheetData } from "@eradigm/shared";

/** Request 65: the data as the pages read it, with each dropdown column's accepted options (by the column's place in its sheet). */
export type EpiData = EpilepsyData & { accepted?: Partial<Record<EpilepsySheet, Record<number, string[]>>> };

/** Request 65: the options a column accepts (its workbook dropdown's, and those added in Admin), or none. */
export function acceptedFor(data: EpiData | undefined, sheet: EpilepsySheet, name: string): string[] {
  const s = data?.sheets[sheet];
  if (!s) return [];
  return data?.accepted?.[sheet]?.[columnIndex(s, name)] ?? [];
}

/** Request 67: a table's columns in the order set in Admin → Table columns. */
export const tableColumns = (data: EpilepsyData | undefined, table: EpiTableKey): string[] => orderColumns(EPI_TABLES[table].columns, data?.columnOrder?.[table]);

/** A sheet's row: its values by column name, and its place in the sheet. */
export type Rec = { i: number; get: (name: string) => string };

export function records(sheet: EpilepsySheetData | null | undefined): Rec[] {
  if (!sheet) return [];
  return sheet.rows.map((row, i) => ({ i, get: (name: string) => cellOf(sheet, row, name) }));
}

/** Whether the sheet has a column named (loosely) like this. */
export const hasColumn = (sheet: EpilepsySheetData | null | undefined, name: string) => !!sheet && columnIndex(sheet, name) >= 0;

/**
 * A number in a cell (“$12.5bn”, “1,234”, “-25%”, “4.2 B”, “~USD 30bn (Oct 2025)”, “30B+”) in plain units, or null.
 * Percentages stay as their number (25% → 25). `scale`: what a plain number is worth (a column named “… (USD m)”: 1,000,000).
 */
export function parseAmount(v: string, scale = 1): number | null {
  let s = v.trim();
  if (!s) return null;
  // Accounting style: (1,234) is minus 1,234.
  const negative = /^\(\s*[$£€]?\s*[\d.,]+\s*[a-z]*\s*\)$/i.test(s);
  if (negative) s = s.slice(1, -1);
  s = s
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/US\$|\bUSD\b|\bGBP\b|\bEUR\b|[$£€¥]/gi, "")
    .replace(/^\s*(?:~|≈|c\.|ca\.|approx\.?|approximately|about|around|est\.?)\s*/i, "")
    .replace(/,(?=\d{3}(?!\d))/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^(-|−)?\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(%|k|m|mn|mm|b|bn|t|tn|thousand|million|billion|trillion)?(?=$|[\s+;/])/i.exec(s);
  if (!m) return null;
  const n = Number(m[2]) * (m[1] || negative ? -1 : 1);
  if (!Number.isFinite(n)) return null;
  const unit = (m[3] ?? "").toLowerCase();
  const mult: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
  return n * (mult[unit] ?? (unit === "%" ? 1 : scale));
}

/** Request 65: an amount of money for reading, in US dollars (the names say “(USD)”): 1,000,000,000 → “1 bn”. */
export const money = abbreviate;

/** A money cell for reading: abbreviated when it reads as a number (“1,000,000,000” → “1 bn”), else as written. */
export function moneyText(v: string, scale = 1): string {
  const n = parseAmount(v, scale);
  return n == null ? v : abbreviate(n);
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
