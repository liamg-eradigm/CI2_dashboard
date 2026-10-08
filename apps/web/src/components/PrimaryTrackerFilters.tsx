/**
 * Analytics → Primary Tracker's own filters (request 41): one per column of
 * the table, in its order, kept in the address under `pt.` so they never
 * carry over to (or from) the other pages' shared filters.
 *
 * Source Company, Source Role and Insight Topic: a searchable list of the
 * values in the Primary Tracker. Event Date: from / to. Key Intelligence
 * Question, Key Details and Key Metrics: the text they contain (any case).
 */
import { useEffect, useMemo, useState } from "react";
import { ALL, CORE, FIELDS, formatDate, getColumn, isIsoDate, type FilterState, type TrackerSchema } from "@eradigm/shared";
import { useTrackerValues } from "../api/hooks";
import { Combobox } from "./Combobox";
import { filtersToggleLabel, useFiltersOpen } from "../state/filtersOpen";

export const PT_PREFIX = "pt.";
/** Chosen from the values in the tracker. */
const PICK_KEYS: string[] = [FIELDS.sourceCompany, FIELDS.sourceRole, FIELDS.insightTopic];
/** Typed: the text they contain. */
const TYPE_KEYS: string[] = [FIELDS.keyQuestion, FIELDS.keyDetails, FIELDS.keyMetrics];
const ORDER: string[] = [FIELDS.sourceCompany, FIELDS.sourceRole, CORE.date, FIELDS.insightTopic, FIELDS.keyQuestion, FIELDS.keyDetails, FIELDS.keyMetrics];

/** The Primary Tracker's query from its own address parameters (dates default to everything in view). */
export function primaryTrackerFilters(params: URLSearchParams, defaults: { from: string; to: string }): FilterState {
  const get = (k: string) => (params.get(PT_PREFIX + k) ?? "").trim();
  let from = isIsoDate(get("from")) ? get("from") : defaults.from;
  let to = isIsoDate(get("to")) ? get("to") : defaults.to;
  if (from > to) [from, to] = [to, from];
  const text: Record<string, string> = {};
  for (const k of [...PICK_KEYS, ...TYPE_KEYS]) if (get(k)) text[k] = get(k).slice(0, 200);
  return { q: "", from, to, values: {}, ...(Object.keys(text).length ? { text } : {}) };
}

type SetParams = (fn: (p: URLSearchParams) => URLSearchParams, opts?: { replace?: boolean }) => void;

/** A typed "contains" filter, applied once typing pauses. */
function TypedFilter({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onChange(v.trim()), 350);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className={`control${value ? " on" : ""}`} type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder="Contains…" maxLength={200} aria-label={`${label} contains`} />;
}

export function PrimaryTrackerFilters({ title, schema, params, setParams, defaults }: { title: string; schema: TrackerSchema; params: URLSearchParams; setParams: SetParams; defaults: { from: string; to: string } }) {
  const values = useTrackerValues("primary", PICK_KEYS);
  const [shown, setShown] = useFiltersOpen("ptr");
  const f = useMemo(() => primaryTrackerFilters(params, defaults), [params, defaults]);
  const label = (k: string) => getColumn(schema, k)?.label ?? k;
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v == null || v === "" || v === ALL) p.delete(PT_PREFIX + k);
          else p.set(PT_PREFIX + k, v);
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
        for (const k of [...p.keys()]) if (k.startsWith(PT_PREFIX)) p.delete(k);
        p.delete("page");
        return p;
      },
      { replace: true },
    );
  const pills = ORDER.filter((k) => k !== CORE.date && f.text?.[k]).map((k) => ({ key: k, label: label(k), value: f.text![k]! }));
  const datesSet = f.from !== defaults.from || f.to !== defaults.to;

  return (
    <>
      <section className={`band${shown ? "" : " filters-closed"}`} aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">Primary signals</span>
            <h1 id="page-title">{title}</h1>
          </div>
        </div>
        <div className="active-filters" role="region" aria-label="Active filters">
          <span className="lbl">ACTIVE FILTERS</span>
          {pills.map((p) => (
            <span className="pill clearable" key={p.key}>
              <span>
                <b>{p.label}:</b> {TYPE_KEYS.includes(p.key) ? `contains “${p.value}”` : p.value}
              </span>
              <button onClick={() => set({ [p.key]: null })} title={`Clear ${p.label}`} aria-label={`Clear ${p.label} filter`}>
                ✕
              </button>
            </span>
          ))}
          <span className="pill">
            <span>
              <b>{label(CORE.date)}:</b> {formatDate(f.from)} – {formatDate(f.to)}
            </span>
          </span>
          {(pills.length > 0 || datesSet) && (
            <button className="link-btn" onClick={reset}>
              Reset filter
            </button>
          )}
          <button className="link-btn filters-toggle" aria-expanded={shown} aria-controls="ptr-filters" onClick={() => setShown(!shown)} data-testid="filters-toggle">
            {filtersToggleLabel(shown)} <span aria-hidden="true">{shown ? "▴" : "▾"}</span>
          </button>
        </div>
      </section>
      {/* Request 47: closed, the filters give their room to the table (hidden, so the page still measures them). */}
      <section className="filterbar ptr-filters" id="ptr-filters" aria-label="Primary Tracker filters" data-testid="ptr-filters" hidden={!shown}>
        {ORDER.map((k) => {
          if (k === CORE.date)
            return (
              <div className="field ptr-dates" key={k} role="group" aria-label={label(k)}>
                <span>{label(k)}</span>
                <div>
                  <input
                    type="date"
                    className={`control${f.from !== defaults.from ? " on" : ""}`}
                    value={f.from}
                    max={f.to}
                    aria-label={`${label(k)} from`}
                    onChange={(e) => e.target.value && set({ from: e.target.value === defaults.from ? null : e.target.value })}
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="date"
                    className={`control${f.to !== defaults.to ? " on" : ""}`}
                    value={f.to}
                    min={f.from}
                    aria-label={`${label(k)} to`}
                    onChange={(e) => e.target.value && set({ to: e.target.value === defaults.to ? null : e.target.value })}
                  />
                </div>
              </div>
            );
          if (PICK_KEYS.includes(k)) {
            const v = f.text?.[k] ?? ALL;
            return (
              <label className="field" key={k}>
                <span>{label(k)}</span>
                <Combobox className={`control ${v !== ALL ? "on" : ""}`} label={label(k)} options={values.data?.[k] ?? []} pinned={[{ value: ALL, label: "All" }]} value={v} onChange={(x) => set({ [k]: x })} />
              </label>
            );
          }
          return (
            <label className="field" key={k}>
              <span>{label(k)}</span>
              <TypedFilter label={label(k)} value={f.text?.[k] ?? ""} onChange={(x) => set({ [k]: x })} />
            </label>
          );
        })}
      </section>
    </>
  );
}
