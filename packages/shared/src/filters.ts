/**
 * Shared dashboard filter state. The tracker, KPIs and every chart are driven
 * by the same state so counts reconcile across the page.
 *
 * Date defaults: everything in view. "Date from" = the oldest Tracker entry's
 * Event Date, "Date to" = today (or the newest entry, if later), evaluated on
 * the day the platform is used. With no entries yet: the last three months.
 */
import { ALL, CORE, filterableColumns, type TrackerSchema } from "./schema.js";
import { isIsoDate } from "./validation.js";

export interface FilterState {
  /** Free-text search over title and extracted text. */
  q: string;
  from: string;
  to: string;
  /** Column key -> selected option, or "All" (no filter). */
  values: Record<string, string>;
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's date as YYYY-MM-DD in the given IANA time zone (defaults to the browser/runtime zone). */
export function todayIso(now: Date = new Date(), timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Subtract calendar months, clamping to the last valid day (31 May - 3 months = 28/29 Feb). */
export function minusMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toIso(target);
}

export function addDays(iso: string, n: number): string {
  return toIso(new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

/** The Event Dates of the oldest and newest Tracker entries (null with no entries). */
export interface DateBounds {
  oldest: string | null;
  newest: string | null;
}

export function defaultDateRange(today: string = todayIso(), bounds?: DateBounds | null): { from: string; to: string } {
  const to = bounds?.newest && bounds.newest > today ? bounds.newest : today;
  const from = bounds?.oldest ? (bounds.oldest < to ? bounds.oldest : to) : minusMonths(today, 3);
  return { from, to };
}

export function defaultFilters(today: string = todayIso(), bounds?: DateBounds | null): FilterState {
  return { q: "", ...defaultDateRange(today, bounds), values: {} };
}

export function isDefaultFilters(f: FilterState, today: string = todayIso(), bounds?: DateBounds | null): boolean {
  const d = defaultDateRange(today, bounds);
  return f.q === "" && f.from === d.from && f.to === d.to && activeValueKeys(f).length === 0;
}

export function activeValueKeys(f: FilterState): string[] {
  return Object.keys(f.values).filter((k) => f.values[k] && f.values[k] !== ALL);
}

/**
 * Set one filter. Changing the macrotrend resets the subtrend because the
 * available subtrends depend on the selected macrotrend.
 */
export function setFilterValue(f: FilterState, key: string, value: string): FilterState {
  const values = { ...f.values, [key]: value };
  if (key === CORE.macrotrend) values[CORE.subtrend] = ALL;
  for (const k of Object.keys(values)) if (values[k] === ALL) delete values[k];
  return { ...f, values };
}

// ---------------------------------------------------------------------------
// Query-string encoding shared by the URL bar (deep links) and API requests.
//   q=...&from=YYYY-MM-DD&to=YYYY-MM-DD&f.macrotrend=Geopolitics
// ---------------------------------------------------------------------------

export const FILTER_PARAM_PREFIX = "f.";
export const MAX_QUERY_LENGTH = 200;

export function filtersToParams(f: FilterState, params = new URLSearchParams()): URLSearchParams {
  if (f.q) params.set("q", f.q);
  params.set("from", f.from);
  params.set("to", f.to);
  for (const k of activeValueKeys(f)) params.set(FILTER_PARAM_PREFIX + k, f.values[k] as string);
  return params;
}

/**
 * Parse filters from query parameters. Invalid or missing dates fall back to
 * today's defaults; unknown keys are ignored when a schema is supplied.
 */
export function filtersFromParams(
  params: URLSearchParams,
  opts: { today?: string; schema?: TrackerSchema; bounds?: DateBounds | null } = {},
): FilterState {
  const d = defaultDateRange(opts.today, opts.bounds);
  let from = params.get("from") ?? "";
  let to = params.get("to") ?? "";
  if (!isIsoDate(from)) from = d.from;
  if (!isIsoDate(to)) to = d.to;
  if (from > to) [from, to] = [to, from];
  const allowed = opts.schema ? new Set(filterableColumns(opts.schema).map((c) => c.key)) : null;
  const values: Record<string, string> = {};
  params.forEach((v, k) => {
    if (!k.startsWith(FILTER_PARAM_PREFIX)) return;
    const key = k.slice(FILTER_PARAM_PREFIX.length);
    if (allowed && !allowed.has(key)) return;
    if (v && v !== ALL) values[key] = v.slice(0, 200);
  });
  const q = (params.get("q") ?? "").slice(0, MAX_QUERY_LENGTH).trim();
  return { q, from, to, values };
}

/**
 * Which filter each chart ignores: each chart ignores its own dimension so
 * that its bars still show the full distribution (noted in each subtitle).
 */
export const CHART_SKIPS = {
  timeline: [] as string[],
  macrotrend: [CORE.macrotrend, CORE.subtrend],
  subtrend: [CORE.subtrend],
  competitor: [CORE.competitors],
} as const;
