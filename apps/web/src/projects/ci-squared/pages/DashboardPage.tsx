import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CompetitorEntry, Me, MegatrendEntry } from "@eradigm/shared";
import { RecordFromTimeline, useRecordParam } from "../components/analytics/Analytics";
import { useCompetitorLogos, useCompetitors, useMacroSections, useMegatrends, useSchema } from "../api/hooks";
import { NEUTRAL, plural } from "../components/megatrends/model";
import {
  activityChange,
  activitySeries,
  addDays,
  bucketsOf,
  DEFAULT_RANGE,
  defaultPick,
  macroAbbr,
  macroStyles,
  quarters,
  RANGES,
  rangeDates,
  todayIso,
  topWithOthers,
  type Bucket,
  type RangeKey,
} from "../components/dashboard/model";
import { StackedArea, type Layer } from "../components/dashboard/StackedArea";
import { ScatterMatrix } from "../components/dashboard/ScatterMatrix";
import { Analysis, FocusBars, MacroAnalysisLink, ProfileCard } from "../components/dashboard/Profiles";
import { CompetitorIcon, MacroIcon } from "../components/dashboard/icons";
import { InfoTip, Popup } from "../components/dashboard/ui";
import "../styles/dashboard.css";

/**
 * The Dashboard (request 70), after the reference design of request 72: a
 * white page with a hint of blue, quiet greys and one blue for what is
 * selected. Two screens, one below the other:
 *  - The charts. Left, the Activity of each Macrotrend over time as smooth
 *    stacked areas (each point a month's Activity: signals × impact × growth
 *    intensity), the selected Macrotrend in blue (tabs above, or press a
 *    layer), a dotted line where the last 30 days start; its Subtrends and
 *    top six competitors open in a popup. Right, a scatter plot per
 *    competitor and Macrotrend (Event Date across, Growth Intensity up, Impact
 *    colour, larger dots for stronger growth), each opening larger.
 *  - Below (the arrow, or scrolling), the Macrotrend Analysis and the
 *    Competitor Analysis: the top five as icons and a search, the chosen one's
 *    change in Activity, its analysis or Company Profile, focus bars (this
 *    quarter against the one before, the selected one in blue) and a footer.
 * The Macrotrend picked on the chart and in the Macrotrend Analysis is one and
 * the same; the competitor picked is shown in blue in the Macrotrend's bars.
 */
export function DashboardPage({ me }: { me: Me }) {
  const mt = useMegatrends("all", null, null);
  const cp = useCompetitors();
  const sections = useMacroSections();
  const logos = useCompetitorLogos();
  const schema = useSchema("all");
  const rec = useRecordParam();
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const [all, setAll] = useState(false);
  const [pop, setPop] = useState<string | null>(null);
  const [macroSel, setMacroSel] = useState<string | null>(null);
  const [compSel, setCompSel] = useState<string | null>(null);
  const analysis = useRef<HTMLElement>(null);
  const charts = useRef<HTMLElement>(null);
  const today = todayIso();

  const d = useMemo(() => {
    if (!mt.data || !cp.data) return null;
    const entries = mt.data.entries;
    const compEntries = cp.data.entries;
    const { from, to } = rangeDates(range, entries, today);
    const buckets = bucketsOf(from, to);
    const inRange = <E extends { date: string }>(e: E) => e.date >= from && e.date <= to;
    const macros = mt.data.macrotrends;
    const names = macros.map((m) => m.name);
    const styles = macroStyles(names);
    // Each point sums the month up to it, so it reads entries from a month before the first point too.
    const series = activitySeries(entries, buckets, (e) => [e.macrotrend]);
    const layers: Layer[] = names.filter((n) => series.has(n)).map((n) => ({ key: n, values: series.get(n)! }));
    const compIn = compEntries.filter(inRange);
    const compCount = new Map<string, number>();
    const macroCount = new Map<string, number>();
    for (const e of compIn) {
      macroCount.set(e.macrotrend, (macroCount.get(e.macrotrend) ?? 0) + 1);
      for (const c of e.competitors) compCount.set(c, (compCount.get(c) ?? 0) + 1);
    }
    const rows = [...compCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
    const withSignals = names.filter((n) => macroCount.has(n));
    const top9 = new Set([...withSignals].sort((a, b) => macroCount.get(b)! - macroCount.get(a)!).slice(0, 9));
    const byMacro = new Map<string, MegatrendEntry[]>();
    for (const e of entries) byMacro.set(e.macrotrend, [...(byMacro.get(e.macrotrend) ?? []), e]);
    const byComp = new Map<string, CompetitorEntry[]>();
    for (const e of compEntries) for (const c of e.competitors) byComp.set(c, [...(byComp.get(c) ?? []), e]);
    return { from, to, buckets, macros, names, styles, layers, compIn, compAll: compEntries, rows, cols: all ? withSignals : withSignals.filter((n) => top9.has(n)), byMacro, byComp };
  }, [mt.data, cp.data, range, today, all]);

  // The Macrotrend and the competitor shown: picked, or by default the one of the top three by signals whose Activity grew most last month.
  const macroName = useMemo(() => {
    if (!d) return null;
    const byVolume = [...d.macros].filter((m) => m.count > 0).sort((a, b) => b.count - a.count);
    return macroSel ?? defaultPick(byVolume.map((m) => m.name), (n) => activityChange(d.byMacro.get(n) ?? [], today)) ?? d.names[0] ?? null;
  }, [d, macroSel, today]);
  const compName = useMemo(() => {
    if (!d || !cp.data) return null;
    return compSel ?? defaultPick(cp.data.competitors.map((c) => c.name), (n) => activityChange(d.byComp.get(n) ?? [], today));
  }, [d, cp.data, compSel, today]);

  const label = RANGES.find((r) => r.key === range)!.label;
  const timeFrame = range === "all" ? "Since the first signal" : `Last ${label}`;
  const loading = !d && !mt.isError && !cp.isError;
  const go = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="dd-page" data-testid="analytics-dashboard">
      <section className="dd-screen dd-charts-screen" ref={charts} aria-labelledby="dd-title">
        <header className="dd-head">
          <h1 id="dd-title">Dashboard</h1>
          <div className="dd-range" role="group" aria-label="Time frame">
            <span className="dd-range-label">Time frame</span>
            {RANGES.map((r) => (
              <button key={r.key} type="button" aria-pressed={r.key === range} onClick={() => setRange(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
        </header>
        {(mt.isError || cp.isError) && (
          <p className="dd-err" role="alert">
            Could not load the dashboard: {((mt.error ?? cp.error) as Error).message}
          </p>
        )}
        {loading && <div className="dd-skeleton" role="status" aria-label="Loading the dashboard" />}
        {d && (
          <div className="dd-two dd-charts">
            <section className="dd-panel dd-chart left" aria-labelledby="dd-activity-title">
              <header className="dd-panel-head">
                <h2 id="dd-activity-title">Macrotrend activity</h2>
                <InfoTip label="About this chart">
                  {timeFrame}. Each point is the Activity of the month up to it: its signals × impact (Low 1, Medium 1.1, High 1.2) × growth intensity (Stable 1, Slight Increase 1.1, Strong Increase 1.2). The selected Macrotrend is in blue; press a layer or a name to select another.
                </InfoTip>
                {macroName && (
                  <button type="button" className="dd-text-btn dd-showall" onClick={() => setPop(macroName)} data-testid="dd-breakdown">
                    Subtrends and competitors →
                  </button>
                )}
              </header>
              <StackedArea
                layers={d.layers}
                buckets={d.buckets}
                selected={macroName}
                onSelect={setMacroSel}
                marker={{ at: addDays(today, -29), label: "Last 30 days" }}
                label="Activity by Macrotrend"
                testId="dd-activity"
              />
            </section>
            <section className="dd-panel dd-chart right" aria-labelledby="dd-matrix-title">
              <header className="dd-panel-head">
                <h2 id="dd-matrix-title">Competitor signals by Macrotrend</h2>
                <InfoTip label="About this chart">
                  {timeFrame}. One plot per competitor and Macrotrend: each dot a signal, across by Event Date, up by Growth Intensity (larger the stronger), coloured by Impact. Press a plot to open it.
                </InfoTip>
                {d.rows.length > 9 && (
                  <button type="button" className="dd-text-btn dd-showall" aria-pressed={all} onClick={() => setAll((a) => !a)}>
                    {all ? "Show the top 9" : `Show all ${d.rows.length}`}
                  </button>
                )}
              </header>
              <ScatterMatrix entries={d.compIn} competitors={d.rows} macros={d.cols} from={d.from} to={d.to} all={all} onOpen={rec.open} />
            </section>
          </div>
        )}
        <button type="button" className="dd-down" onClick={() => go(analysis.current)} data-testid="dd-down">
          <span>Macrotrend and Competitor Analysis</span>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </section>

      <section className="dd-screen dd-analysis-screen" ref={analysis} id="dd-analysis" aria-label="Macrotrend and Competitor Analysis">
        <button type="button" className="dd-up" onClick={() => go(charts.current)} data-testid="dd-up">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to the charts
        </button>
        {d && (
          <div className="dd-two">
            <div className="dd-col">
              <h2 className="dd-big-title">Macrotrend Analysis</h2>
              {macroName && <MacroProfile d={d} sections={sections.data ?? []} name={macroName} onChange={setMacroSel} competitor={compName} today={today} />}
            </div>
            <div className="dd-col">
              <h2 className="dd-big-title">Competitor Analysis</h2>
              <CompetitorProfile d={d} competitors={cp.data!.competitors} logos={logos.data ?? []} name={compName} onChange={setCompSel} macro={macroName} today={today} me={me} />
            </div>
          </div>
        )}
      </section>
      {d && pop && <MacroPopup name={pop} d={d} timeFrame={timeFrame} onClose={() => setPop(null)} />}
      {schema.data && <RecordFromTimeline schema={schema.data} me={me} />}
    </div>
  );
}

type Data = {
  from: string;
  to: string;
  buckets: Bucket[];
  macros: { name: string; count: number; subtrends: { name: string }[]; summary: { text: string } | null }[];
  names: string[];
  styles: Map<string, { colour: string; hatch: boolean }>;
  compIn: CompetitorEntry[];
  compAll: CompetitorEntry[];
  byMacro: Map<string, MegatrendEntry[]>;
  byComp: Map<string, CompetitorEntry[]>;
};

const tally = (keys: string[]) => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()];
};
const largest = (counts: [string, number][]) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

/** A Macrotrend's Subtrends and its top six competitors (and the rest as Others), as Activity over the same time frame. */
function MacroPopup({ name, d, timeFrame, onClose }: { name: string; d: Data; timeFrame: string; onClose: () => void }) {
  const macro = d.macros.find((m) => m.name === name);
  const list = d.byMacro.get(name) ?? [];
  const subNames = [...(macro?.subtrends.map((s) => s.name) ?? [])];
  const subs = activitySeries(list, d.buckets, (e) => [e.subtrend ?? "No Subtrend"]);
  const subLayers: Layer[] = [...subNames, "No Subtrend"].filter((s) => subs.has(s)).map((s) => ({ key: s, values: subs.get(s)! }));
  const comps = topWithOthers(
    activitySeries(
      d.compAll.filter((e) => e.macrotrend === name),
      d.buckets,
      (e) => e.competitors,
    ),
    6,
  );
  const compLayers: Layer[] = comps.map((c) => ({ key: c.key, values: c.values }));
  return (
    <Popup title={name} sub={`${timeFrame} · each point the Activity of the month up to it · press a layer or a name to highlight it`} onClose={onClose} className="dd-macro-pop" testId="dd-macro-popup">
      <div className="dd-pop-charts">
        <section aria-labelledby="dd-pop-subs">
          <h3 id="dd-pop-subs">Subtrends</h3>
          {subNames.length === 0 && <p className="dd-muted">{name} has no Subtrends yet.</p>}
          <StackedArea layers={subLayers} buckets={d.buckets} label={`${name}: Activity by Subtrend`} testId="dd-pop-subtrends" />
        </section>
        <section aria-labelledby="dd-pop-comps">
          <h3 id="dd-pop-comps">Competitors (top 6)</h3>
          <StackedArea layers={compLayers} buckets={d.buckets} label={`${name}: Activity by competitor`} testId="dd-pop-competitors" />
        </section>
      </div>
    </Popup>
  );
}

function MacroProfile({
  d,
  sections,
  name,
  onChange,
  competitor,
  today,
}: {
  d: Data;
  sections: { macrotrend: string; section: string; text: string }[];
  name: string;
  onChange: (v: string) => void;
  competitor: string | null;
  today: string;
}) {
  const byVolume = [...d.macros].filter((m) => m.count > 0).sort((a, b) => b.count - a.count);
  const macro = d.macros.find((m) => m.name === name);
  const icon = (n: string) => <MacroIcon name={n} {...(d.styles.get(n) ?? { colour: NEUTRAL, hatch: false })} />;
  const text = sections.find((s) => s.macrotrend === name && s.section === "overview")?.text || macro?.summary?.text;
  const q = quarters(today);
  const mine = d.byMacro.get(name) ?? [];
  const inQ = <E extends { date: string }>(list: E[], qq: { start: string; end: string }) => list.filter((e) => e.date >= qq.start && e.date < qq.end);
  const subNow = tally(inQ(mine, q.current).map((e) => e.subtrend ?? "No Subtrend"));
  const subPrior = tally(inQ(mine, q.previous).map((e) => e.subtrend ?? "No Subtrend"));
  const comps = d.compAll.filter((e) => e.macrotrend === name);
  const compNow = tally(inQ(comps, q.current).flatMap((e) => e.competitors));
  const compPrior = tally(inQ(comps, q.previous).flatMap((e) => e.competitors));
  return (
    <ProfileCard
      side="left"
      kind="Macrotrend"
      title="Macrotrend profile"
      top={byVolume.slice(0, 5).map((m) => ({ name: m.name, icon: icon(m.name) }))}
      all={d.names}
      value={name}
      onChange={onChange}
      iconOf={icon}
      change={activityChange(mine, today)}
      testId="dd-macro-profile"
      textLabel="Analysis"
      text={<Analysis text={text} empty={`No analysis of ${name} yet: add one on New Entry → Input trend analysis.`} testId="dd-macro-analysis" />}
      bars={
        <>
          <FocusGroup title="Subtrends" q={q}>
            <FocusBars
              rows={[
                { label: "Prior", counts: subPrior, testId: "dd-focus-sub-prior" },
                { label: "Now", counts: subNow, testId: "dd-focus-sub-now" },
              ]}
              highlight={largest(subNow) ?? largest(subPrior)}
              empty={macro?.subtrends.length ? "No signals" : `${name} has no Subtrends yet`}
              testId="dd-focus-subtrends"
            />
          </FocusGroup>
          <FocusGroup title="Competitors" q={q} note={competitor ? `${competitor} in blue` : undefined}>
            <FocusBars
              rows={[
                { label: "Prior", counts: compPrior, testId: "dd-focus-comp-prior" },
                { label: "Now", counts: compNow, testId: "dd-focus-comp-now" },
              ]}
              highlight={competitor}
              empty="No signals naming a competitor"
              testId="dd-focus-competitors"
            />
          </FocusGroup>
        </>
      }
      footer={<MacroAnalysisLink name={name} />}
    />
  );
}

/** A pair of focus bars with its heading: what they split, and the two quarters. */
function FocusGroup({ title, q, note, children }: { title: string; q: ReturnType<typeof quarters>; note?: string; children: React.ReactNode }) {
  return (
    <div className="dd-fgroup">
      <span className="dd-fgroup-title">
        <b>{title}</b> · prior {q.previous.name}, now {q.current.name}
        {note && <span className="dd-fgroup-note"> · {note}</span>}
      </span>
      {children}
    </div>
  );
}

function CompetitorProfile({
  d,
  competitors,
  logos,
  name,
  onChange,
  macro,
  today,
  me,
}: {
  d: Data;
  competitors: { name: string; count: number; tier: number; summary: { text: string } | null }[];
  logos: { name: string; updatedAt: string }[];
  name: string | null;
  onChange: (v: string) => void;
  macro: string | null;
  today: string;
  me: Me;
}) {
  if (!name)
    return (
      <section className="dd-card dd-profile right">
        <p className="dd-muted">No signals name a competitor yet.</p>
      </section>
    );
  const logo = new Map(logos.map((l) => [l.name, l.updatedAt]));
  const tier = new Map(competitors.map((c) => [c.name, c.tier]));
  const comp = competitors.find((c) => c.name === name);
  const icon = (n: string) => <CompetitorIcon name={n} tier={tier.get(n) ?? 4} logo={logo.get(n) ?? null} />;
  const q = quarters(today);
  const mine = d.byComp.get(name) ?? [];
  const split = (a: string, b: string) => tally(mine.filter((e) => e.date >= a && e.date < b).map((e) => e.macrotrend));
  return (
    <ProfileCard
      side="right"
      kind="competitor"
      title="Competitor profile"
      top={competitors.slice(0, 5).map((c) => ({ name: c.name, icon: icon(c.name) }))}
      all={competitors.map((c) => c.name)}
      value={name}
      onChange={onChange}
      iconOf={icon}
      change={activityChange(mine, today)}
      testId="dd-comp-profile"
      textLabel="Company profile"
      text={<Analysis text={comp?.summary?.text} empty={`No Company Profile of ${name} yet: add one on New Entry → Input trend analysis.`} testId="dd-comp-analysis" />}
      bars={
        <FocusGroup title="Macrotrends" q={q} note={macro ? `${macro} in blue` : undefined}>
          <FocusBars
            rows={[
              { label: "Prior", counts: split(q.previous.start, q.previous.end), testId: "dd-focus-last-quarter" },
              { label: "Now", counts: split(q.current.start, q.current.end), testId: "dd-focus-this-quarter" },
            ]}
            highlight={macro}
            short={macroAbbr}
            empty="No signals"
            testId="dd-focus-macrotrends"
          />
        </FocusGroup>
      }
      footer={
        <>
          <span className="dd-foot-note">
            <span className={`dd-tier-dot t${comp?.tier ?? 4}`} aria-hidden="true" />
            Tier {comp?.tier ?? 4} · {plural(comp?.count ?? 0, "signal")} in all
          </span>
          {me.role === "admin" && !logo.has(name) && (
            <Link className="dd-open" to="/admin#competitor-logos">
              Add a logo <span aria-hidden="true">→</span>
            </Link>
          )}
        </>
      }
    />
  );
}
