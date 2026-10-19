/**
 * Epilepsy → Trial Tracker (request 61): every trial of “4. Platform Trials &
 * Assets” in a wide table (scrolling both ways, its horizontal scrollbar
 * always on screen, as CI SQUARED's Database). A row opens the data viewer,
 * full screen: the trial's change in seizure frequency from baseline vs
 * placebo over time (to be built out later).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { EPI_TRIAL_TABLE, normaliseHeader, type Me } from "@eradigm/shared";
import { useEpilepsyData } from "../api/hooks";
import { useTip } from "../components/Charts";
import { EpiTable, type EpiColumn } from "../components/EpiTable";
import { Filters, distinct } from "../components/Filters";
import { PageHead } from "../components/PageHead";
import { acceptedFor, colourMap, records, tableColumns, type Rec } from "../model";
import { trialSeries } from "../trialSeries";

const LONG = new Set(["Key Inclusion Criteria", "Dosing & Regimen", "Primary Endpoints", "Efficacy Notes (source, method)", "other Demographics"].map(normaliseHeader));
const columnOf = (name: string): EpiColumn => ({ name, kind: name === "Asset Name" ? "title" : LONG.has(normaliseHeader(name)) ? "long" : "plain", width: LONG.has(normaliseHeader(name)) ? 300 : name.length > 30 ? 220 : 160 });
const FILTERS = ["Company/competitor", "Asset Name", "Current Phase", "Current Trial Status", "Epilepsy Indication/ Syndrome"];
const Y_FIELD = "Change in Seizure Frequency from Baseline vs Placebo";

export function TrialsPage({ me }: { me: Me }) {
  const data = useEpilepsyData();
  const all = useMemo(() => records(data.data?.sheets.assets), [data.data]);
  const colour = useMemo(() => colourMap(data.data), [data.data]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState<Rec | null>(null);
  const columns = useMemo(() => tableColumns(data.data, "trials").map(columnOf), [data.data]);
  const rows = all.filter((r) => {
    for (const [name, vals] of Object.entries(picked)) if (vals.length && !vals.includes(r.get(name))) return false;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const text = EPI_TRIAL_TABLE.map((n) => r.get(n)).join(" ").toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  return (
    <>
      <PageHead me={me} title="Trial Tracker" intro="Every trial in “4. Platform Trials & Assets”. Open a row for its data viewer." />
      {/* Request 67: the filters on a strip, the table filling the page below it (as CI SQUARED's Database). */}
      <div className="epi-strip">
        <Filters
          search={q}
          onSearch={setQ}
          choices={FILTERS.map((name) => ({ name, options: distinct([...all.map((r) => r.get(name)), ...acceptedFor(data.data, "assets", name)]), value: picked[name] ?? [] }))}
          onChoice={(name, v) => setPicked((p) => ({ ...p, [name]: v }))}
          onClear={() => {
            setQ("");
            setPicked({});
          }}
        />
      </div>
      <div className="content ptr-content">
        <section className="card flush ptr-card pop-host" aria-label="Trials">
          <div className="table-top">
            <div className="ptr-head">
              <h2 className="card-title">Trials</h2>
              <span className="card-sub info" aria-live="polite">
                {data.isLoading ? "Loading…" : `Showing ${rows.length} of ${all.length} · scroll across for every column`}
              </span>
            </div>
          </div>
          <EpiTable rows={rows} columns={columns} label="Trials" initialSort={{ name: "Company/competitor", dir: "asc" }} onOpen={setOpen} openIndex={open?.i} testId="trial-table" />
        </section>
      </div>
      {open && <DataViewer r={open} colour={colour(open.get("Company/competitor"))} onClose={() => setOpen(null)} />}
    </>
  );
}

/** The data viewer (full screen): the trial's change in seizure frequency vs placebo over time. */
function DataViewer({ r, colour, onClose }: { r: Rec; colour: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const tip = useTip();
  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const raw = r.get(Y_FIELD);
  const pts = trialSeries(raw, r.get("Primary Endpoint Timeframes"), r.get("Study Duration"));
  const W = 900;
  const H = 420;
  const L = 70;
  const B = 50;
  const T = 24;
  const maxW = Math.max(4, ...pts.map((p) => p.weeks)) * 1.1;
  const vals = pts.map((p) => p.value);
  // Round ticks (every 5, 10, 20… percent) spanning the values and zero.
  const span = Math.max(...vals, 0) - Math.min(...vals, 0) || 10;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => span / s <= 6) ?? 100;
  const y0 = Math.floor(Math.min(...vals, 0) / step) * step - (Math.min(...vals) < 0 ? step : 0);
  const y1 = Math.ceil(Math.max(...vals, 0) / step) * step + (Math.max(...vals) > 0 ? step : 0);
  const x = (w: number) => L + (w / maxW) * (W - L - 20);
  const y = (v: number) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
  const yTicks = Array.from({ length: Math.round((y1 - y0) / step) + 1 }, (_, i) => y0 + step * i);
  const xTicks = Array.from({ length: 6 }, (_, i) => (maxW * i) / 5);
  const title = [r.get("Asset Name"), r.get("Study Name"), r.get("NCT Number")].filter(Boolean).join(" · ");
  return (
    <div ref={ref} className="epi-viewer" role="dialog" aria-modal="true" aria-label={`Data viewer: ${title}`} tabIndex={-1} data-testid="data-viewer">
      <div className="epi-viewer-head">
        <div>
          <span className="eyebrow">Data viewer</span>
          <h2>{title || "Trial"}</h2>
          <div className="epi-viewer-meta">{[r.get("Company/competitor"), r.get("Current Phase"), r.get("Current Trial Status"), r.get("Epilepsy Indication/ Syndrome")].filter(Boolean).join(" · ")}</div>
        </div>
        <button className="btn secondary" onClick={onClose}>
          ✕ Close
        </button>
      </div>
      <div className="epi-viewer-body">
        <section className="card" aria-labelledby="viewer-plot">
          <div>
            <h3 className="card-title" id="viewer-plot">
              Change in seizure frequency from baseline vs placebo
            </h3>
            <span className="card-sub">Over time (weeks from the start of treatment)</span>
          </div>
          {pts.length ? (
            <div className="epi-chart" onPointerLeave={tip.hide}>
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Change in seizure frequency vs placebo: ${pts.map((p) => `${p.value}% at week ${p.weeks}`).join(", ")}`}>
                {yTicks.map((t) => (
                  <g key={t}>
                    <line x1={L} x2={W - 20} y1={y(t)} y2={y(t)} className="epi-grid" />
                    <text x={L - 8} y={y(t) + 4} textAnchor="end" className="epi-axis">
                      {`${t}%`}
                    </text>
                  </g>
                ))}
                {xTicks.map((t) => (
                  <text key={t} x={x(t)} y={H - B + 20} textAnchor="middle" className="epi-axis">
                    {Math.round(t)}
                  </text>
                ))}
                <text x={(L + W) / 2} y={H - 8} textAnchor="middle" className="epi-axis">
                  Weeks
                </text>
                <line x1={L} x2={W - 20} y1={y(0)} y2={y(0)} className="epi-base" />
                {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.weeks)},${y(p.value)}`).join(" ")} fill="none" stroke={colour} strokeWidth={2} />}
                {pts.map((p) => (
                  <g key={`${p.weeks}|${p.value}`}>
                    <circle
                      cx={x(p.weeks)}
                      cy={y(p.value)}
                      r={6}
                      fill={colour}
                      stroke="#fff"
                      strokeWidth={2}
                      tabIndex={0}
                      onPointerMove={(e) => tip.show(e, <>Week {p.weeks}: <b>{p.value}%</b><br />{p.text}</>)}
                      onFocus={(e) => tip.show(e, <>Week {p.weeks}: <b>{p.value}%</b><br />{p.text}</>)}
                      onBlur={tip.hide}
                    />
                    <text x={x(p.weeks)} y={y(p.value) - 12} textAnchor="middle" className="epi-val">
                      {p.value}%
                    </text>
                  </g>
                ))}
              </svg>
              {tip.view}
            </div>
          ) : (
            <div className="empty">{raw ? "The workbook's value has no time to plot it against." : "The workbook gives no change in seizure frequency vs placebo for this trial yet."}</div>
          )}
          <dl className="epi-fields compact">
            <div className="epi-field">
              <dt>{Y_FIELD} (as in the workbook)</dt>
              <dd>{raw || "—"}</dd>
            </div>
            <div className="epi-field">
              <dt>Primary Endpoint Timeframes</dt>
              <dd>{r.get("Primary Endpoint Timeframes") || "—"}</dd>
            </div>
            <div className="epi-field">
              <dt>Study Duration</dt>
              <dd>{r.get("Study Duration") || "—"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
