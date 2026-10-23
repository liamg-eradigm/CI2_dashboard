/**
 * Request 70: the Dashboard's sums. Activity is how much is happening in a
 * trend: each signal counts its impact (Low 1, Medium 2, High 3) times its
 * growth intensity (Stable 1, Slight Increase 2, Strong Increase 3), so
 * Activity = signals × impact × growth, summed over the signals of a period.
 * A signal without an impact or a growth intensity counts 1 for it.
 */
import type { MegatrendEntry } from "@eradigm/shared";
import { NEUTRAL, PALETTE } from "../megatrends/model";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
export const IMPACT_WEIGHT: Readonly<Record<string, number>> = { low: 1, medium: 2, high: 3 };
export const GROWTH_WEIGHT: Readonly<Record<string, number>> = { stable: 1, "slight increase": 2, "strong increase": 3 };
export const GROWTH_LEVELS = ["Stable", "Slight Increase", "Strong Increase"] as const;

export type Entry = MegatrendEntry;
export const activityOf = (e: Pick<Entry, "impact" | "growth">) => (IMPACT_WEIGHT[norm(e.impact)] ?? 1) * (GROWTH_WEIGHT[norm(e.growth)] ?? 1);
/** 1 (Stable) to 3 (Strong Increase), or null. */
export const growthLevel = (g: string | null | undefined): number | null => GROWTH_WEIGHT[norm(g)] ?? null;
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

export type Bucket = { start: string; end: string; label: string };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** The periods a span is summed by: weeks (from Monday) up to about seven months, else months. Each is [start, end) and the last ends after `to`. */
export function bucketsOf(from: string, to: string): Bucket[] {
  const out: Bucket[] = [];
  if (toDay(to) - toDay(from) <= 215 * DAY) {
    const f = new Date(toDay(from));
    let t = toDay(from) - ((f.getUTCDay() + 6) % 7) * DAY;
    while (t <= toDay(to)) {
      const start = isoOf(t);
      out.push({ start, end: isoOf(t + 7 * DAY), label: `Week of ${dayLabel(start)}` });
      t += 7 * DAY;
    }
    return out;
  }
  let m = `${from.slice(0, 7)}-01`;
  while (m <= to) {
    const next = addMonths(m, 1);
    out.push({ start: m, end: next, label: monthLabel(m) });
    m = next;
  }
  return out;
}

/** Activity per key per period: each entry counts for every key it belongs to (a signal naming two competitors counts for both). */
export function activitySeries<E extends Entry>(entries: E[], buckets: Bucket[], keysOf: (e: E) => string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (!buckets.length) return out;
  const first = buckets[0]!.start;
  const last = buckets[buckets.length - 1]!.end;
  for (const e of entries) {
    if (e.date < first || e.date >= last) continue;
    let i = buckets.findIndex((b) => e.date >= b.start && e.date < b.end);
    if (i < 0) i = buckets.length - 1;
    const a = activityOf(e);
    for (const k of keysOf(e)) {
      const row = out.get(k) ?? out.set(k, new Array<number>(buckets.length).fill(0)).get(k)!;
      row[i] = (row[i] ?? 0) + a;
    }
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

/** A colour mixed toward a background (t = 1: the colour itself; 0: the background). */
export function towards(hex: string, bg: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.replace("#", "").slice(i - 1, i + 1), 16));
  const [a, b] = [p(hex), p(bg)];
  return `#${a.map((c, i) => Math.round(b[i]! + (c - b[i]!) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** A matrix cell's brightness from its signals (more signals, brighter): 0.35 to 1. */
export const brightness = (n: number, max: number) => (max > 0 ? 0.35 + 0.65 * Math.sqrt(Math.min(1, n / max)) : 0.35);

export function impactCounts(entries: Pick<Entry, "impact">[]): { n: number; high: number; medium: number; low: number } {
  const c = { n: 0, high: 0, medium: 0, low: 0 };
  for (const e of entries) {
    c.n++;
    const k = impactKey(e.impact);
    if (k) c[k]++;
  }
  return c;
}
