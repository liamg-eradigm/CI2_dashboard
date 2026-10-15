/**
 * Request 61: the data viewer's points: a trial's change in seizure frequency
 * from baseline vs placebo, against time (weeks). A cell may give one value
 * (its time then from Primary Endpoint Timeframes, else Study Duration) or
 * several (“-28% at week 12; -35% at week 24”, “W12: -20%”).
 */
export type Point = { weeks: number; value: number; text: string };

const UNIT: Record<string, number> = { d: 1 / 7, day: 1 / 7, days: 1 / 7, w: 1, wk: 1, wks: 1, week: 1, weeks: 1, m: 52 / 12, mo: 52 / 12, mos: 52 / 12, month: 52 / 12, months: 52 / 12, y: 52, yr: 52, yrs: 52, year: 52, years: 52 };

/** A time written in a piece of text, in weeks, or null. */
export function weeksIn(text: string): number | null {
  const s = text.toLowerCase();
  const after = /(\d+(?:\.\d+)?)\s*-?\s*(days?|d|weeks?|wks?|w|months?|mos?|m|years?|yrs?|y)\b/.exec(s);
  if (after) return Number(after[1]) * (UNIT[after[2]!] ?? 1);
  const before = /\b(days?|d|weeks?|wks?|w|months?|mos?|m|years?|yrs?|y)\s*(\d+(?:\.\d+)?)\b/.exec(s);
  if (before) return Number(before[2]) * (UNIT[before[1]!] ?? 1);
  return null;
}

/** The value of a piece (the first number, a percentage preferred), or null. */
function valueIn(text: string, time: number | null): number | null {
  const pct = /([-−+]?\d+(?:\.\d+)?)\s*%/.exec(text);
  if (pct) return Number(pct[1]!.replace("−", "-"));
  if (time != null) return null;
  const n = /([-−+]?\d+(?:\.\d+)?)/.exec(text);
  return n ? Number(n[1]!.replace("−", "-")) : null;
}

export function trialSeries(value: string, timeframe: string, duration: string): Point[] {
  const pieces = value.split(/[;\n|]+/).map((p) => p.trim()).filter(Boolean);
  const fallback = weeksIn(timeframe) ?? weeksIn(duration);
  const out: Point[] = [];
  for (const p of pieces) {
    const t = weeksIn(p);
    // A percentage's own time, else (one value only) the trial's endpoint time.
    const v = valueIn(t != null ? p.replace(/(\d+(?:\.\d+)?)\s*-?\s*(days?|d|weeks?|wks?|w|months?|mos?|m|years?|yrs?|y)\b|\b(days?|d|weeks?|wks?|w|months?|mos?|m|years?|yrs?|y)\s*\d+(?:\.\d+)?\b/gi, " ") : p, null);
    if (v == null) continue;
    const weeks = t ?? (pieces.length === 1 ? fallback : null);
    if (weeks == null) continue;
    out.push({ weeks: Math.round(weeks * 10) / 10, value: v, text: p });
  }
  return out.sort((a, b) => a.weeks - b.weeks);
}
