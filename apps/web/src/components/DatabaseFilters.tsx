/**
 * The Database page's filters (request 43): a search, then one filter per
 * field of the stream, in the Inbox order. Kept in the address under `db.`,
 * so they never carry over to (or from) the other pages' filters.
 *
 * Dropdown fields: a searchable list of their options. Event Date and other
 * date fields: from / to. Text fields: the text they contain (any case).
 * One row shows at first; "All filters" opens the rest.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ALL,
  CORE,
  filtersFromParams,
  formatDate,
  getColumn,
  hasOptions,
  isIsoDate,
  optionsOf,
  sortedColumns,
  subtrendsOf,
  type FilterState,
  type TrackerColumn,
  type TrackerSchema,
} from "@eradigm/shared";
import { Combobox } from "./Combobox";
import { filtersToggleLabel, useFiltersOpen } from "../state/filtersOpen";

export const DB_PREFIX = "db.";

const strip = (params: URLSearchParams) => {
  const out = new URLSearchParams();
  params.forEach((v, k) => k.startsWith(DB_PREFIX) && out.set(k.slice(DB_PREFIX.length), v));
  return out;
};

/** The Database page's query from its own address parameters (Event Dates default to everything in view). */
export function databaseFilters(params: URLSearchParams, defaults: { from: string; to: string }, schema: TrackerSchema): FilterState {
  const own = strip(params);
  const f = filtersFromParams(own, { schema });
  let from = isIsoDate(own.get("from") ?? "") ? own.get("from")! : defaults.from;
  let to = isIsoDate(own.get("to") ?? "") ? own.get("to")! : defaults.to;
  if (from > to) [from, to] = [to, from];
  return { ...f, from, to };
}

type SetParams = (fn: (p: URLSearchParams) => URLSearchParams, opts?: { replace?: boolean }) => void;

/** A typed "contains" filter, applied once typing pauses. */
function TypedFilter({ label, value, onChange, placeholder = "Contains…" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onChange(v.trim()), 350);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className={`control${value ? " on" : ""}`} type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} maxLength={200} aria-label={`${label} contains`} />;
}

/** How many filters show before "All filters" (the search, Event Date and the first fields). */
const FIRST_ROW = 5;

export function DatabaseFilters({ schema, params, setParams, defaults }: { schema: TrackerSchema; params: URLSearchParams; setParams: SetParams; defaults: { from: string; to: string } }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useFiltersOpen("db");
  const f = useMemo(() => databaseFilters(params, defaults, schema), [params, defaults, schema]);
  const cols = sortedColumns(schema);
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v == null || v === "" || v === ALL) p.delete(DB_PREFIX + k);
          else p.set(DB_PREFIX + k, v);
        }
        p.delete("page");
        return p;
      },
      { replace: true },
    );
  const reset = () =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const k of [...p.keys()]) if (k.startsWith(DB_PREFIX)) p.delete(k);
        p.delete("page");
        return p;
      },
      { replace: true },
    );

  // The active filters, as pills to clear one at a time.
  const pills: { key: string; label: string; text: string; clear: Record<string, null> }[] = [];
  if (f.q) pills.push({ key: "q", label: "Search", text: `“${f.q}”`, clear: { q: null } });
  for (const c of cols) {
    const v = f.values[c.key];
    if (v) pills.push({ key: c.key, label: c.label, text: v, clear: { [`f.${c.key}`]: null, ...(c.key === CORE.macrotrend ? { [`f.${CORE.subtrend}`]: null } : {}) } });
    const t = f.text?.[c.key];
    if (t) pills.push({ key: c.key, label: c.label, text: `contains “${t}”`, clear: { [`t.${c.key}`]: null } });
    const d = f.dates?.[c.key];
    if (d) pills.push({ key: c.key, label: c.label, text: `${d.from ? formatDate(d.from) : "…"} – ${d.to ? formatDate(d.to) : "…"}`, clear: { [`df.${c.key}`]: null, [`dt.${c.key}`]: null } });
  }
  const datesSet = f.from !== defaults.from || f.to !== defaults.to;
  const dateLabel = getColumn(schema, CORE.date)?.label ?? "Event Date";

  const dateRange = (key: string, label: string, from: string, to: string, onFrom: (v: string | null) => void, onTo: (v: string | null) => void, active: [boolean, boolean]) => (
    <div className="field ptr-dates" key={key} role="group" aria-label={label}>
      <span>{label}</span>
      <div>
        <input type="date" className={`control${active[0] ? " on" : ""}`} value={from} max={to || undefined} aria-label={`${label} from`} onChange={(e) => onFrom(e.target.value || null)} />
        <span aria-hidden="true">–</span>
        <input type="date" className={`control${active[1] ? " on" : ""}`} value={to} min={from || undefined} aria-label={`${label} to`} onChange={(e) => onTo(e.target.value || null)} />
      </div>
    </div>
  );

  const field = (c: TrackerColumn) => {
    if (c.type === "date") {
      if (c.key === CORE.date)
        return dateRange(
          c.key,
          c.label,
          f.from,
          f.to,
          (v) => v && set({ from: v === defaults.from ? null : v }),
          (v) => v && set({ to: v === defaults.to ? null : v }),
          [f.from !== defaults.from, f.to !== defaults.to],
        );
      const d = f.dates?.[c.key] ?? {};
      return dateRange(c.key, c.label, d.from ?? "", d.to ?? "", (v) => set({ [`df.${c.key}`]: v }), (v) => set({ [`dt.${c.key}`]: v }), [!!d.from, !!d.to]);
    }
    if (hasOptions(c)) {
      const v = f.values[c.key] ?? ALL;
      const options = c.type === "sub" ? subtrendsOf(schema, f.values[CORE.macrotrend] ?? ALL) : optionsOf(schema, c);
      return (
        <label className="field" key={c.key}>
          <span>{c.label}</span>
          <Combobox
            className={`control ${v !== ALL ? "on" : ""}`}
            label={c.label}
            options={options}
            pinned={[{ value: ALL, label: "All" }]}
            value={v}
            onChange={(x) => set({ [`f.${c.key}`]: x, ...(c.key === CORE.macrotrend ? { [`f.${CORE.subtrend}`]: null } : {}) })}
          />
        </label>
      );
    }
    return (
      <label className="field" key={c.key}>
        <span>{c.label}</span>
        <TypedFilter label={c.label} value={f.text?.[c.key] ?? ""} onChange={(x) => set({ [`t.${c.key}`]: x })} />
      </label>
    );
  };

  // The search first, then Event Date, then the other fields in order.
  const dateCol = cols.find((c) => c.key === CORE.date);
  const items = [
    <label className="field" key="q">
      <span>Search</span>
      <TypedFilter label="Search" value={f.q} onChange={(x) => set({ q: x })} placeholder="Title or page text…" />
    </label>,
    ...(dateCol ? [field(dateCol)] : []),
    ...cols.filter((c) => c.key !== CORE.date).map(field),
  ];
  const hidden = items.length - FIRST_ROW;

  return (
    <>
      <section className={`band${shown ? "" : " filters-closed"}`} aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">Every database in one place</span>
            <h1 id="page-title">Database</h1>
          </div>
        </div>
        <div className="active-filters" role="region" aria-label="Active filters">
          <span className="lbl">ACTIVE FILTERS</span>
          {pills.map((p) => (
            <span className="pill clearable" key={`${p.key}-${p.text}`}>
              <span>
                <b>{p.label}:</b> {p.text}
              </span>
              <button onClick={() => set(p.clear)} title={`Clear ${p.label}`} aria-label={`Clear ${p.label} filter`}>
                ✕
              </button>
            </span>
          ))}
          <span className="pill">
            <span>
              <b>{dateLabel}:</b> {formatDate(f.from)} – {formatDate(f.to)}
            </span>
          </span>
          {(pills.length > 0 || datesSet) && (
            <button className="link-btn" onClick={reset}>
              Reset filter
            </button>
          )}
          <button className="link-btn filters-toggle" aria-expanded={shown} aria-controls="db-filters" onClick={() => setShown(!shown)} data-testid="filters-toggle">
            {filtersToggleLabel(shown)} <span aria-hidden="true">{shown ? "▴" : "▾"}</span>
          </button>
        </div>
      </section>
      {/* Request 47: closed, the filters give their room to the table (hidden, so the page still measures them). */}
      <section className={`filterbar db-filters${open ? " open" : ""}`} id="db-filters" aria-label="Database filters" data-testid="db-filters" hidden={!shown}>
        <div className="db-filter-grid" id="db-filter-grid">
          {open ? items : items.slice(0, FIRST_ROW)}
        </div>
        {hidden > 0 && (
          <button className="link-btn db-more" aria-expanded={open} aria-controls="db-filter-grid" onClick={() => setOpen((o) => !o)}>
            {open ? "Fewer filters" : `All filters (${items.length})`}
          </button>
        )}
      </section>
    </>
  );
}
