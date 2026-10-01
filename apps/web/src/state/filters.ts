/**
 * Shared filter state for the Dashboard and Tracker, stored in the URL so it
 * survives navigation, deep links and opening a record.
 *
 * The dates default to everything in view: "Date from" = the oldest Tracker
 * entry's Event Date, "Date to" = today (in the tenant's time zone) or the
 * newest entry if later. When the URL has no explicit dates the defaults are
 * recomputed as the day changes and as entries are added. `ready` is false
 * until the oldest date is known, so pages do not load the wrong range first.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDateBounds } from "../api/hooks";
import { ALL, FILTER_PARAM_PREFIX, defaultDateRange, filtersFromParams, setFilterValue, todayIso, type FilterState, type TrackerSchema } from "@eradigm/shared";

export function useToday(timeZone?: string): string {
  const compute = useCallback(() => {
    try {
      return todayIso(new Date(), timeZone);
    } catch {
      return todayIso(new Date());
    }
  }, [timeZone]);
  const [today, setToday] = useState(compute);
  useEffect(() => {
    setToday(compute());
    const t = setInterval(() => setToday(compute()), 60_000);
    return () => clearInterval(t);
  }, [compute]);
  return today;
}

const FILTER_KEYS = (k: string) => k === "q" || k === "from" || k === "to" || k.startsWith(FILTER_PARAM_PREFIX);

export function useFilters(schema: TrackerSchema | undefined, timeZone?: string) {
  const [params, setParams] = useSearchParams();
  const today = useToday(timeZone);
  const b = useDateBounds();
  const bounds = b.data ?? null;
  const ready = !!b.data || b.isError;
  const filters: FilterState = useMemo(() => filtersFromParams(params, { today, schema, bounds }), [params, today, schema, bounds]);
  const defaults = useMemo(() => defaultDateRange(today, bounds), [today, bounds]);

  const update = useCallback(
    (fn: (p: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          fn(p);
          p.delete("page");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setValue = useCallback(
    (key: string, value: string) =>
      update((p) => {
        const next = setFilterValue(filters, key, value);
        for (const k of [...p.keys()]) if (k.startsWith(FILTER_PARAM_PREFIX)) p.delete(k);
        for (const [k, v] of Object.entries(next.values)) if (v && v !== ALL) p.set(FILTER_PARAM_PREFIX + k, v);
      }),
    [filters, update],
  );
  const setQuery = useCallback((q: string) => update((p) => (q ? p.set("q", q) : p.delete("q"))), [update]);
  const setDate = useCallback(
    (which: "from" | "to", v: string) =>
      update((p) => {
        if (!v || v === defaults[which]) p.delete(which);
        else p.set(which, v);
      }),
    [update, defaults],
  );
  const reset = useCallback(() => update((p) => [...p.keys()].filter(FILTER_KEYS).forEach((k) => p.delete(k))), [update]);
  const apply = useCallback(
    (f: FilterState) =>
      update((p) => {
        [...p.keys()].filter(FILTER_KEYS).forEach((k) => p.delete(k));
        if (f.q) p.set("q", f.q);
        if (f.from !== defaults.from) p.set("from", f.from);
        if (f.to !== defaults.to) p.set("to", f.to);
        for (const [k, v] of Object.entries(f.values)) if (v && v !== ALL) p.set(FILTER_PARAM_PREFIX + k, v);
      }),
    [update, defaults],
  );
  const isDefault = !filters.q && filters.from === defaults.from && filters.to === defaults.to && Object.keys(filters.values).length === 0;
  return { filters, today, defaults, ready, setValue, setQuery, setDate, reset, apply, isDefault, params, setParams };
}
