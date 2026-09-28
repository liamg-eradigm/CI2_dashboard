import { useCallback } from "react";
import { ALL, CORE, getColumn, type Me } from "@eradigm/shared";
import { useDashboard, useSchema, useSettings } from "../api/hooks";
import { BarChart, SignalTimeline } from "../components/Charts";
import { FilterHeader } from "../components/FilterHeader";
import { RecordDrawer } from "../components/RecordDrawer";
import { TrendTest } from "../components/TrendTest";
import { useFilters } from "../state/filters";

export function DashboardPage({ me }: { me: Me }) {
  const schema = useSchema();
  const settings = useSettings();
  const f = useFilters(schema.data, settings.data?.timezone ?? me.timezone);
  const dash = useDashboard(f.filters, !!schema.data);
  const selected = f.params.get("signal");
  const open = useCallback(
    (id: string) =>
      f.setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set("signal", id);
          return n;
        },
        { replace: false },
      ),
    [f],
  );
  const close = useCallback(
    () =>
      f.setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.delete("signal");
          return n;
        },
        { replace: true },
      ),
    [f],
  );

  if (!schema.data) return <div className="content"><div className="skeleton" style={{ height: 200 }} /></div>;
  const s = schema.data;
  const d = dash.data;
  const iCol = getColumn(s, CORE.impact);
  const iOpts = iCol?.options ?? [];
  const pct = (n: number) => (d && d.kpis.approved ? `${Math.round((n / d.kpis.approved) * 100)}% of filtered signals` : "—");
  const macroSel = f.filters.values[CORE.macrotrend];
  const mixNote = `Counts shown ${[...iOpts].reverse().join(" / ")}`;

  const kpis = (
    <div className="kpis" aria-live="polite">
      {[
        { v: d?.kpis.approved, l: "Approved signals", n: d ? `of ${d.kpis.totalPublished} published` : "" },
        { v: d?.kpis.competitorsInvolved, l: "Competitors involved", n: d ? `of ${d.kpis.competitorsTracked} tracked` : "" },
        { v: d?.kpis.high, l: `${iOpts[iOpts.length - 1] ?? "High"} ${iCol?.label.toLowerCase() ?? "impact"}`, n: d ? pct(d.kpis.high) : "" },
        { v: d?.kpis.low, l: `${iOpts[0] ?? "Low"} ${iCol?.label.toLowerCase() ?? "impact"}`, n: d ? pct(d.kpis.low) : "" },
      ].map((k) => (
        <div className="kpi" key={k.l}>
          <div className="v">{k.v ?? "–"}</div>
          <div className="l">{k.l}</div>
          <div className="n">{k.n}</div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <FilterHeader title="Intelligence Dashboard" schema={s} f={f} kpis={kpis} viewKind="dashboard" />
      <div className="content">
        {dash.isError && (
          <div className="banner err" role="alert">
            Could not load the dashboard: {(dash.error as Error).message}
          </div>
        )}
        {d ? (
          <>
            <SignalTimeline data={d} schema={s} from={f.filters.from} to={f.filters.to} onOpen={open} />
            <div className="grid-charts">
              <BarChart title="Signals by Macrotrend" sub="Approved signal count · Macrotrend and Subtrend filters not applied" bars={d.macroBars} schema={s} onSelect={(v) => f.setValue(CORE.macrotrend, v)} />
              <BarChart title="Impact mix by Macrotrend" sub={mixNote} bars={d.macroBars} schema={s} mix />
              <BarChart
                title="Signals by Subtrend"
                sub={`${macroSel && macroSel !== ALL ? `Subtrends of ${macroSel}` : "All subtrends across all macrotrends"} · Subtrend filter not applied`}
                bars={d.subBars}
                schema={s}
                variant="sub"
                onSelect={(v) => f.setValue(CORE.subtrend, v)}
              />
              <BarChart title="Impact mix by Subtrend" sub={mixNote} bars={d.subBars} schema={s} variant="sub" mix />
              <BarChart
                title="Competitor Composition"
                sub="Ranked by approved signal count · Competitor filter not applied"
                bars={d.compBars}
                schema={s}
                variant="comp"
                full
                onSelect={(v) => f.setValue(CORE.competitors, v)}
                footer={`One item can involve several competitors, so these counts sum to ${d.compSum} across ${d.compItems} items.`}
              />
              <TrendTest schema={s} f={f} />
            </div>
          </>
        ) : (
          <div className="skeleton" style={{ height: 320 }} />
        )}
      </div>
      {selected && <RecordDrawer id={selected} schema={s} me={me} onClose={close} onOpen={open} />}
    </>
  );
}
