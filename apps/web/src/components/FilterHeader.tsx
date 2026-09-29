import { useEffect, useState, type ReactNode } from "react";
import { ALL, CORE, filterableColumns, formatDate, optionsOf, subtrendsOf, type TrackerSchema } from "@eradigm/shared";
import type { useFilters } from "../state/filters";
import { Combobox } from "./Combobox";
import { SavedViews } from "./SavedViews";

type F = ReturnType<typeof useFilters>;

/** Header band + active-filter summary + sticky filter bar (Dashboard and Tracker). */
export function FilterHeader({ title, schema, f, kpis, viewKind }: { title: string; schema: TrackerSchema; f: F; kpis?: ReactNode; viewKind: "dashboard" | "tracker" }) {
  const cols = filterableColumns(schema);
  const [q, setQ] = useState(f.filters.q);
  useEffect(() => setQ(f.filters.q), [f.filters.q]);
  // Debounce free-text search.
  useEffect(() => {
    if (q === f.filters.q) return;
    const t = setTimeout(() => f.setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const pills = cols
    .filter((c) => f.filters.values[c.key])
    .map((c) => ({ key: c.key, label: c.label, value: f.filters.values[c.key] as string }));
  const hasActive = pills.length > 0 || !!f.filters.q || !f.isDefault;

  return (
    <>
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">Approved signals</span>
            <h1 id="page-title">{title}</h1>
          </div>
          <label>
            <span className="sr-only">Search titles and extracted text</span>
            <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and extracted text" maxLength={200} />
          </label>
        </div>
        {kpis && (
          <>
            <div className="band-rule" />
            {kpis}
          </>
        )}
        <div className="active-filters" role="region" aria-label="Active filters">
          <span className="lbl">ACTIVE FILTERS</span>
          {pills.map((p) => (
            <span className="pill clearable" key={p.key}>
              <span>
                <b>{p.label}:</b> {p.value}
              </span>
              <button onClick={() => f.setValue(p.key, ALL)} title={`Clear ${p.label}`} aria-label={`Clear ${p.label} filter`}>
                ✕
              </button>
            </span>
          ))}
          {f.filters.q && (
            <span className="pill clearable">
              <span>
                <b>Search:</b> “{f.filters.q}”
              </span>
              <button onClick={() => f.setQuery("")} aria-label="Clear search">
                ✕
              </button>
            </span>
          )}
          <span className="pill">
            <span>
              <b>Date:</b> {formatDate(f.filters.from)} – {formatDate(f.filters.to)}
            </span>
          </span>
          {hasActive && (
            <button className="link-btn" onClick={f.reset}>
              Reset filter
            </button>
          )}
          <span style={{ marginLeft: 8, paddingLeft: 12, borderLeft: "1px solid var(--rule)" }}>
            <SavedViews kind={viewKind} f={f} />
          </span>
        </div>
      </section>

      <section className="filterbar" aria-label="Filters">
        {cols.map((c) => {
          const opts = c.type === "sub" ? subtrendsOf(schema, f.filters.values[CORE.macrotrend] ?? ALL) : optionsOf(schema, c);
          const v = f.filters.values[c.key] ?? ALL;
          return (
            <label className={`field ${c.key === CORE.competitors ? "span2" : ""}`} key={c.key}>
              <span>{c.label}</span>
              <Combobox className={`control ${v !== ALL ? "on" : ""}`} label={c.label} options={opts} pinned={[{ value: ALL, label: "All" }]} value={v} onChange={(x) => f.setValue(c.key, x)} />
            </label>
          );
        })}
        <label className="field">
          <span>Date from</span>
          <input type="date" className="control" value={f.filters.from} max={f.filters.to} onChange={(e) => e.target.value && f.setDate("from", e.target.value)} />
        </label>
        <label className="field">
          <span>Date to</span>
          <input type="date" className="control" value={f.filters.to} min={f.filters.from} onChange={(e) => e.target.value && f.setDate("to", e.target.value)} />
        </label>
      </section>
    </>
  );
}
