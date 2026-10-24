/**
 * Request 70: the Dashboard's sums. Activity is how much is happening in a
 * trend: each signal counts its impact times its growth intensity, so
 * Activity = signals × impact × growth, summed over the signals of a period.
 * Request 72: the weights are Low 1, Medium 1.1, High 1.2 and Stable 1,
 * Slight Increase 1.1, Strong Increase 1.2 (signals count most; impact and
 * growth lift them a little). A signal without an impact or a growth
 * intensity counts 1 for it.
 */
import type { MegatrendEntry } from "@eradigm/shared";
import { NEUTRAL, PALETTE } from "../megatrends/model";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
export const IMPACT_WEIGHT: Readonly<Record<string, number>> = { low: 1, medium: 1.1, high: 1.2 };
export const GROWTH_WEIGHT: Readonly<Record<string, number>> = { stable: 1, "slight increase": 1.1, "strong increase": 1.2 };
const GROWTH_LEVEL: Readonly<Record<string, number>> = { stable: 1, "slight increase": 2, "strong increase": 3 };
export const GROWTH_LEVELS = ["Stable", "Slight Increase", "Strong Increase"] as const;

export type Entry = MegatrendEntry;
export const activityOf = (e: Pick<Entry, "impact" | "growth">) => (IMPACT_WEIGHT[norm(e.impact)] ?? 1) * (GROWTH_WEIGHT[norm(e.growth)] ?? 1);
/** 1 (Stable) to 3 (Strong Increase), or null. */
export const growthLevel = (g: string | null | undefined): number | null => GROWTH_LEVEL[norm(g)] ?? null;

/** Request 72: short Macrotrend labels (the matrix's columns, the focus bars); the full name shows on hover. */
const MACRO_ABBR: [RegExp, string][] = [
  [/^ai investment in r&d$/i, "AI R&D"],
  [/workforce ai upskilling/i, "AI Upskill"],
  [/integrated digital pharma innovation/i, "Dig Innov"],
  [/^geopolitics$/i, "Geo"],
  [/portfolio restructuring/i, "Portfolio"],
  [/direct-to-patient|\bdtp\b/i, "DTP"],
  [/^manufacturing$/i, "Manufact"],
  [/medical-grade intelligence/i, "Med AI"],
  [/robotics/i, "Robotics"],
  [/^others?$/i, "Others"],
];
export function macroAbbr(name: string): string {
  const hit = MACRO_ABBR.find(([re]) => re.test(name.trim()));
  if (hit) return hit[1];
  // Any other: its first word (up to nine letters).
  const w = name.trim().split(/\s+/)[0] ?? name;
  return w.length > 9 ? `${w.slice(0, 8)}.` : w;
}
export const impactKey = (i: string | null | undefined): "high" | "medium" | "low" | null => {
  const k = norm(i);
  return k === "high" || k === "medium" || k === "low" ? k : null;
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
export const toDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
export const todayIso = () => isoOf(Date.now());
export const addDays = (iso: string, n: number) => isoOf(toDay(iso) + n * DAY);
export function addMonths(iso: string, n: number): string {
  const d = new Date(toDay(iso));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoOf(d.getTime());
}

/** The Activity chart's time spans (request 70: three months to begin with). */
export const RANGES = [
  { key: "1m", label: "1 month", months: 1 },
  { key: "3m", label: "3 months", months: 3 },
  { key: "6m", label: "6 months", months: 6 },
  { key: "1y", label: "1 year", months: 12 },
  { key: "all", label: "All", months: null },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "3m";

export function rangeDates(key: RangeKey, entries: Pick<Entry, "date">[], today = todayIso()): { from: string; to: string } {
  const r = RANGES.find((x) => x.key === key) ?? RANGES[1];
  if (r.months == null) {
    const first = entries.reduce((m, e) => (e.date < m ? e.date : m), today);
    return { from: first, to: today };
  }
  return { from: addMonths(today, -r.months), to: today };
}

/** A point of the Activity chart: the month (30 days) up to `at`, i.e. [start, end). */
export type Bucket = { start: string; end: string; at: string; label: string };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** The days each point sums: a month. */
export const WINDOW_DAYS = 30;

/**
 * Request 71: the points a span is drawn with. Each is the Activity of the
 * month (30 days) up to its date, so every point is a month's total and the
 * line runs smoothly from one to the next. Points every week up to about seven
 * months, every fortnight up to about fourteen, else every month; the last is
 * `to`.
 */
export function bucketsOf(from: string, to: string): Bucket[] {
  const span = (toDay(to) - toDay(from)) / DAY;
  const step = span <= 215 ? 7 : span <= 430 ? 14 : 30;
  const out: Bucket[] = [];
  for (let t = toDay(to); t >= toDay(from) - (step - 1) * DAY && out.length < 400; t -= step * DAY) {
    const at = isoOf(t);
    out.push({ start: isoOf(t - (WINDOW_DAYS - 1) * DAY), end: isoOf(t + DAY), at, label: `Month to ${dayLabel(at)}` });
  }
  return out.reverse();
}

/** Activity per key per point: each entry counts in every point whose month holds it, and for every key it belongs to (a signal naming two competitors counts for both). */
export function activitySeries<E extends Entry>(entries: E[], buckets: Bucket[], keysOf: (e: E) => string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (!buckets.length) return out;
  const first = buckets[0]!.start;
  const last = buckets[buckets.length - 1]!.end;
  for (const e of entries) {
    if (e.date < first || e.date >= last) continue;
    const a = activityOf(e);
    const keys = keysOf(e);
    buckets.forEach((b, i) => {
      if (e.date < b.start || e.date >= b.end) return;
      for (const k of keys) {
        const row = out.get(k) ?? out.set(k, new Array<number>(buckets.length).fill(0)).get(k)!;
        row[i] = (row[i] ?? 0) + a;
      }
    });
  }
  return out;
}

/** The `n` keys with the most activity in order, the rest summed as "Others". */
export function topWithOthers(series: Map<string, number[]>, n: number, others = "Others"): { key: string; values: number[] }[] {
  const all = [...series.entries()].map(([key, values]) => ({ key, values, total: values.reduce((s, v) => s + v, 0) })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const top = all.slice(0, n).map(({ key, values }) => ({ key, values }));
  const rest = all.slice(n);
  if (rest.length) {
    const len = rest[0]!.values.length;
    top.push({ key: others, values: Array.from({ length: len }, (_, i) => rest.reduce((s, r) => s + (r.values[i] ?? 0), 0)) });
  }
  return top;
}

// ---------------------------------------------------------------------------
// Change over the last month
// ---------------------------------------------------------------------------

/** Activity over the last 30 days against the 30 days before: the change in %, or "new" (nothing before), or null (nothing in either). */
export function activityChange(entries: Entry[], today = todayIso()): { pct: number | null; isNew: boolean; now: number; before: number } {
  const a = addDays(today, -30);
  const b = addDays(today, -60);
  let now = 0;
  let before = 0;
  for (const e of entries) {
    if (e.date > a && e.date <= today) now += activityOf(e);
    else if (e.date > b && e.date <= a) before += activityOf(e);
  }
  now = Math.round(now * 100) / 100;
  before = Math.round(before * 100) / 100;
  if (!before) return { pct: null, isNew: now > 0, now, before };
  return { pct: Math.round(((now - before) / before) * 100), isNew: false, now, before };
}

/** The default pick (request 70): of the three with the most signals, the one whose activity grew the most over the last month. */
export function defaultPick<T>(byVolume: T[], changeOf: (t: T) => ReturnType<typeof activityChange>): T | null {
  const top = byVolume.slice(0, 3);
  if (!top.length) return null;
  const score = (t: T) => {
    const c = changeOf(t);
    return c.isNew ? Number.POSITIVE_INFINITY : (c.pct ?? Number.NEGATIVE_INFINITY);
  };
  return top.reduce((best, t) => (score(t) > score(best) ? t : best), top[0]!);
}

export const changeText = (c: ReturnType<typeof activityChange>) => (c.isNew ? "New" : c.pct == null ? "—" : `${c.pct > 0 ? "+" : ""}${c.pct}%`);

// ---------------------------------------------------------------------------
// Focus bars
// ---------------------------------------------------------------------------

export type Segment = { name: string; n: number; pct: number; others?: string[] };

/** Shares of a total, largest first; two or more under 5% are put together as "Other" (one alone stays itself). */
export function focusSplit(counts: [string, number][], min = 0.05, other = "Other"): Segment[] {
  const list = counts.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = list.reduce((s, [, n]) => s + n, 0);
  if (!total) return [];
  const small = list.filter(([, n]) => n / total < min);
  const keep = small.length >= 2 ? list.filter(([, n]) => n / total >= min) : list;
  const segs: Segment[] = keep.map(([name, n]) => ({ name, n, pct: (n / total) * 100 }));
  if (small.length >= 2) {
    const n = small.reduce((s, [, x]) => s + x, 0);
    segs.push({ name: other, n, pct: (n / total) * 100, others: small.map(([x]) => x) });
  }
  return segs;
}

/** "2026 Q4" for a date. */
export const quarterOf = (iso: string) => `${iso.slice(0, 4)} Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
/** The current calendar quarter and the one before it: [start, end) dates and names. */
export function quarters(today = todayIso()): { current: { start: string; end: string; name: string }; previous: { start: string; end: string; name: string } } {
  const y = Number(today.slice(0, 4));
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const start = (yy: number, qq: number) => `${yy}-${String(qq * 3 + 1).padStart(2, "0")}-01`;
  const cur = start(y, q);
  const prev = q === 0 ? start(y - 1, 3) : start(y, q - 1);
  return { current: { start: cur, end: addMonths(cur, 3), name: quarterOf(cur) }, previous: { start: prev, end: cur, name: quarterOf(prev) } };
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/**
 * Each Macrotrend's colour, in the taxonomy's order: the eight categorical
 * hues, then (a ninth Macrotrend: Manufacturing) the first hue again with a
 * hatch so it is never mistaken for the first; Others in grey.
 */
export function macroStyles(names: string[]): Map<string, { colour: string; hatch: boolean }> {
  const m = new Map<string, { colour: string; hatch: boolean }>();
  let i = 0;
  for (const n of names) {
    if (/^others?$/i.test(n.trim())) m.set(n, { colour: NEUTRAL, hatch: false });
    else {
      m.set(n, { colour: PALETTE[i % PALETTE.length] as string, hatch: i >= PALETTE.length });
      i++;
    }
  }
  return m;
}

/** Colours for a breakdown (Subtrends, competitors): the categorical hues in order, Others in grey. */
export function seriesColours(keys: string[]): Map<string, string> {
  const m = new Map<string, string>();
  let i = 0;
  for (const k of keys) m.set(k, /^others?$/i.test(k) ? NEUTRAL : (PALETTE[i++ % PALETTE.length] as string));
  return m;
}

export function impactCounts(entries: Pick<Entry, "impact">[]): { n: number; high: number; medium: number; low: number } {
  const c = { n: 0, high: 0, medium: 0, low: 0 };
  for (const e of entries) {
    c.n++;
    const k = impactKey(e.impact);
    if (k) c[k]++;
  }
  return c;
}

/** Request 71: a dot's size in the matrix grows a little with its Growth Intensity (Stable, Slight Increase, Strong Increase; none as Stable). */
export const dotSize = (g: string | null | undefined, base = 5, step = 1.5) => base + step * ((growthLevel(g) ?? 1) - 1);

/**
 * Request 71: a smooth line through points (x rising), as SVG path commands
 * after the first point: a monotone cubic (Fritsch–Carlson), so the curve
 * never overshoots a point (no bumps above a peak or below zero).
 */
export function smoothSegments(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return "";
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i]![0]);
  const slope = pts.slice(1).map((p, i) => (p[1] - pts[i]![1]) / (dx[i] || 1));
  const m = pts.map((_, i) => (i === 0 ? slope[0]! : i === n - 1 ? slope[n - 2]! : slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / slope[i]!;
    const b = m[i + 1]! / slope[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i]!;
      m[i + 1] = t * b * slope[i]!;
    }
  }
  const f = (v: number) => v.toFixed(1);
  let d = "";
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${f(x0 + h)},${f(y0 + m[i]! * h)} ${f(x1 - h)},${f(y1 - m[i + 1]! * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}
