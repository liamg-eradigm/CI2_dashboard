import { useEffect, useState } from "react";
import { ALL, CORE, baselinePeriod, getColumn, macrotrends, subtrendsOf, type SavedView, type TrackerSchema, type TrendConfig, type TrendResult, type TrendThresholds } from "@eradigm/shared";
import { runTrend, useSettings } from "../api/hooks";
import { formatDate } from "../lib/format";
import type { useFilters } from "../state/filters";
import { SavedViews } from "./SavedViews";

type Result = TrendResult & { counts: { current: number; baseline: number } };

const THRESHOLD_FIELDS: { key: keyof TrendThresholds; label: string; step: number; unit: string }[] = [
  { key: "minSampleSize", label: "Minimum sample size", step: 1, unit: "signals" },
  { key: "signalCountChangePct", label: "Signal count change", step: 1, unit: "%" },
  { key: "distinctCompetitorsChange", label: "Distinct competitors change", step: 1, unit: "+" },
  { key: "impactScoreChangePct", label: "Impact-weighted score change", step: 1, unit: "%" },
  { key: "growthScoreChange", label: "Growth-intensity score change", step: 0.05, unit: "points" },
];

export function TrendTest({ schema, f }: { schema: TrackerSchema; f: ReturnType<typeof useFilters> }) {
  const settings = useSettings();
  const [cfg, setCfg] = useState<TrendConfig>(() => ({
    macrotrend: ALL,
    subtrend: ALL,
    competitors: [],
    growth: ALL,
    from: f.defaults.from,
    to: f.defaults.to,
    thresholds: { minSampleSize: 5, signalCountChangePct: 25, distinctCompetitorsChange: 1, impactScoreChangePct: 25, growthScoreChange: 0.2 },
  }));
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Administrator-configured defaults (visible to everyone).
  useEffect(() => {
    if (settings.data && !touched) setCfg((c) => ({ ...c, thresholds: settings.data.trendDefaults }));
  }, [settings.data, touched]);
  // Follow today's default dates until the user changes them.
  useEffect(() => {
    if (!touched) setCfg((c) => ({ ...c, from: f.defaults.from, to: f.defaults.to }));
  }, [f.defaults.from, f.defaults.to, touched]);

  const set = (patch: Partial<TrendConfig>) => {
    setTouched(true);
    setCfg((c) => ({ ...c, ...patch }));
  };
  const setT = (k: keyof TrendThresholds, v: number) => set({ thresholds: { ...cfg.thresholds, [k]: v } });
  const periods = cfg.from <= cfg.to ? baselinePeriod(cfg.from, cfg.to) : null;
  const comps = getColumn(schema, CORE.competitors)?.options ?? [];
  const growthOpts = getColumn(schema, CORE.growth)?.options ?? [];

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await runTrend(cfg));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const load = (v: SavedView) => {
    if (v.state.trend) {
      setTouched(true);
      setCfg(v.state.trend);
      setResult(null);
    }
  };

  return (
    <section className="card full-row" aria-labelledby="trend-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="trend-title">
            Trend Test
          </h2>
          <span className="card-sub">Compares the selected period with the immediately preceding period of equal length · analyst-configured indicator, not statistical proof</span>
        </div>
        <div style={{ minWidth: 260 }}>
          <SavedViews kind="trend" f={f} extra={() => ({ trend: cfg })} onLoad={load} />
        </div>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-h" style={{ marginBottom: 8 }}>
          1 · Scope and current period
        </legend>
        <div className="trend-grid">
          <label className="field">
            <span>Macrotrend</span>
            <select className="control" value={cfg.macrotrend} onChange={(e) => set({ macrotrend: e.target.value, subtrend: ALL })}>
              <option value={ALL}>All</option>
              {macrotrends(schema).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Subtrend</span>
            <select className="control" value={cfg.subtrend} onChange={(e) => set({ subtrend: e.target.value })}>
              <option value={ALL}>All</option>
              {subtrendsOf(schema, cfg.macrotrend).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Growth intensity (optional)</span>
            <select className="control" value={cfg.growth} onChange={(e) => set({ growth: e.target.value })}>
              <option value={ALL}>All</option>
              {growthOpts.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Date from</span>
            <input className="control" type="date" value={cfg.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
          </label>
          <label className="field">
            <span>Date to</span>
            <input className="control" type="date" value={cfg.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </label>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <span className="field-label" id="tt-comps">
            Competitors (none selected = all)
          </span>
          <div role="group" aria-labelledby="tt-comps" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {comps.map((c) => {
              const on = cfg.competitors.includes(c);
              return (
                <button key={c} className="chip" aria-pressed={on} style={on ? { background: "var(--tint)", borderColor: "var(--focus)", color: "var(--navy-700)" } : undefined} onClick={() => set({ competitors: on ? cfg.competitors.filter((x) => x !== c) : [...cfg.competitors, c] })}>
                  {on ? "✓ " : ""}
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        {periods && (
          <p className="card-sub">
            Current: {formatDate(periods.current.from)} – {formatDate(periods.current.to)} ({periods.current.days} days) · Baseline: {formatDate(periods.baseline.from)} – {formatDate(periods.baseline.to)}
          </p>
        )}
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-h" style={{ marginBottom: 8 }}>
          2 · Rules and thresholds {touched ? "" : "(administrator defaults)"}
        </legend>
        <div className="trend-grid">
          {THRESHOLD_FIELDS.map((t) => (
            <label className="field" key={t.key}>
              <span>
                {t.label} ({t.unit})
              </span>
              <input className="control" type="number" min={0} step={t.step} value={cfg.thresholds[t.key]} onChange={(e) => setT(t.key, Number(e.target.value))} />
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn" onClick={run} disabled={busy || !periods}>
          {busy ? "Running…" : "Run trend test"}
        </button>
        {err && (
          <span className="err-msg" role="alert">
            ✕ {err}
          </span>
        )}
      </div>

      {result && (
        <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={`verdict ${result.confirmed ? "yes" : "no"}`}>
            <span className="ic" aria-hidden="true">
              {result.confirmed ? "✓" : "○"}
            </span>
            <div>
              <b>{result.verdict}</b>
              <span>{result.explanation}</span>
              {!result.confirmed && <div style={{ marginTop: 4 }}>Unmet rules: {result.unmetRules.join("; ")}</div>}
            </div>
          </div>
          <div className="table-wrap">
            <table className="data" style={{ minWidth: 820 }}>
              <caption className="sr-only">Trend test results by metric</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Current period</th>
                  <th scope="col">Baseline period</th>
                  <th scope="col">Change</th>
                  <th scope="col">Threshold</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {result.metrics.map((m) => (
                  <tr key={m.key}>
                    <th scope="row" style={{ textAlign: "left", padding: "11px 12px 11px 20px", fontWeight: 700, color: "var(--ink)" }}>
                      {m.metric}
                    </th>
                    <td className="mono">{m.current ?? "—"}</td>
                    <td className="mono">{m.baseline ?? "—"}</td>
                    <td className="mono">{m.change}</td>
                    <td>{m.threshold}</td>
                    <td>
                      {m.progress == null ? (
                        "Not applicable"
                      ) : (
                        <>
                          <span className="progress" aria-hidden="true">
                            <i style={{ width: `${Math.max(0, Math.min(100, m.progress))}%` }} />
                          </span>
                          {m.progress}%
                        </>
                      )}
                    </td>
                    <td>
                      <span className={m.met ? "met" : "unmet"}>{m.met ? "✓ Met" : "✕ Unmet"}</span>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{m.explanation}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Formula and rules</summary>
            <ul style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
              <li>{result.sampleRule}</li>
              {result.formula.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </details>
          <p className="disclaimer">{result.disclaimer}</p>
        </div>
      )}
    </section>
  );
}
