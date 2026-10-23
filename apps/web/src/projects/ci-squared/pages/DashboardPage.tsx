import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CompetitorEntry, Me, MegatrendEntry } from "@eradigm/shared";
import { RecordFromTimeline, useRecordParam } from "../components/analytics/Analytics";
import { useCompetitorLogos, useCompetitors, useMacroSections, useMegatrends, useSchema } from "../api/hooks";
import { colourMap, NEUTRAL } from "../components/megatrends/model";
import {
  activityChange,
  activitySeries,
  bucketsOf,
  DEFAULT_RANGE,
  defaultPick,
  macroStyles,
  quarters,
  RANGES,
  rangeDates,
  seriesColours,
  todayIso,
  topWithOthers,
  type Bucket,
  type RangeKey,
} from "../components/dashboard/model";
import { StackedArea, type Layer } from "../components/dashboard/StackedArea";
import { ScatterMatrix } from "../components/dashboard/ScatterMatrix";
import { Analysis, FocusBar, MacroAnalysisLink, ProfileCard } from "../components/dashboard/Profiles";
import { plural } from "../components/megatrends/model";
import { CompetitorIcon, MacroIcon } from "../components/dashboard/icons";
import { InfoTip, Popup, Splitter, useSplit } from "../components/dashboard/ui";
import "../styles/megatrends.css";
import "../styles/dashboard.css";

/**
 * The Dashboard (request 70), in the knowledge graph's night sky, on one page:
 * two columns, Macrotrends Analysis and Competitor Analysis.
 *  - Left, the Activity of each Macrotrend over time as stacked areas
 *    (Activity = signals × impact × growth intensity); a layer opens its
 *    Subtrends and its top six competitors the same way.
 *  - Right, a scatter plot per competitor and Macrotrend (dots: Event Date
 *    across, Growth Intensity up, Impact colour), the same size as the left
 *    chart and level with it.
 *  - Below each, its Profile: the top five as icons and a search, the chosen
 *    one's change in Activity, its analysis or Company Profile, two focus
 *    bars, and a footer (the link to the full analysis, or the tier).
 * Request 71: each point of the Activity chart is a month's total (the 30 days
 * up to it), drawn as a smooth line; a handle between the rows shares the
 * height between the charts and the Profiles; a quieter, minimal look.
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
  const [split, setSplit] = useSplit();
  const layout = useRef<HTMLDivElement>(null);
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
    const layers: Layer[] = names.filter((n) => series.has(n)).map((n) => ({ key: n, values: series.get(n)!, ...styles.get(n)! }));
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
    const by = <E extends { macrotrend: string }>(list: E[]) => {
      const m = new Map<string, E[]>();
      for (const e of list) m.set(e.macrotrend, [...(m.get(e.macrotrend) ?? []), e]);
      return m;
    };
    const byComp = new Map<string, CompetitorEntry[]>();
    for (const e of compEntries) for (const c of e.competitors) byComp.set(c, [...(byComp.get(c) ?? []), e]);
    return { from, to, buckets, macros, names, styles, layers, compIn, compAll: compEntries, rows, cols: all ? withSignals : withSignals.filter((n) => top9.has(n)), byMacro: by(entries), byMacroIn: by(entries.filter(inRange)), byComp };
  }, [mt.data, cp.data, range, today, all]);

  const label = RANGES.find((r) => r.key === range)!.label;
  const timeFrame = range === "all" ? "Since the first signal" : `Last ${label}`;
  const loading = !d && !mt.isError && !cp.isError;
  return (
    <div className="mg-page ad-page dd-page" data-testid="analytics-dashboard">
      <header className="dd-head">
        <h1>Dashboard</h1>
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
        <p className="mg-err" role="alert">
          Could not load the dashboard: {((mt.error ?? cp.error) as Error).message}
        </p>
      )}
      {loading && <div className="ad-skeleton dd-skeleton" role="status" aria-label="Loading the dashboard" />}
      {d && (
        <div className="dd-layout" ref={layout} style={{ "--top": `${split}fr`, "--bottom": `${1 - split}fr` } as React.CSSProperties}>
          <h2 className="dd-col-title left">Macrotrends Analysis</h2>
          <section className="dd-card dd-chart left" aria-labelledby="dd-activity-title">
            <header className="dd-card-head">
              <h3 id="dd-activity-title">Activity by Macrotrend</h3>
              <InfoTip label="About this chart">
                {timeFrame}. Each point is the Activity of the month up to it: its signals × impact (Low 1, Medium 2, High 3) × growth intensity (Stable 1, Slight Increase 2, Strong Increase 3). Press a layer to see its Subtrends and competitors.
              </InfoTip>
            </header>
            <StackedArea layers={d.layers} buckets={d.buckets} onLayer={setPop} label="Activity by Macrotrend" testId="dd-activity" layerVerb="Open its Subtrends and competitors" />
          </section>
          <MacroProfile d={d} sections={sections.data ?? []} timeFrame={timeFrame} value={macroSel} onChange={setMacroSel} today={today} />

          <h2 className="dd-col-title right">Competitor Analysis</h2>
          <section className="dd-card dd-chart right" aria-labelledby="dd-matrix-title">
            <header className="dd-card-head">
              <h3 id="dd-matrix-title">Signals by competitor and Macrotrend</h3>
              <InfoTip label="About this chart">
                {timeFrame}. One plot per competitor and Macrotrend: each dot a signal, across by Event Date, up by Growth Intensity (larger the stronger), coloured by Impact. Press a plot to open it.
              </InfoTip>
              {d.rows.length > 9 && (
                <button type="button" className="dd-text-btn dd-showall" aria-pressed={all} onClick={() => setAll((a) => !a)}>
                  {all ? "Show the top 9" : `Show all ${d.rows.length}`}
                </button>
              )}
            </header>
            <ScatterMatrix entries={d.compIn} competitors={d.rows} macros={d.cols} macroColour={d.styles} from={d.from} to={d.to} all={all} onOpen={rec.open} />
          </section>
          <CompetitorProfile d={d} competitors={cp.data!.competitors} logos={logos.data ?? []} value={compSel} onChange={setCompSel} today={today} me={me} />
          <Splitter
            value={split}
            onChange={setSplit}
            area={() => {
              const el = layout.current;
              const top = el?.querySelector(".dd-chart")?.getBoundingClientRect();
              const bottom = el?.querySelector(".dd-profile")?.getBoundingClientRect();
              return top && bottom ? { top: top.top, height: bottom.bottom - top.top } : null;
            }}
          />
        </div>
      )}
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
  byMacroIn: Map<string, MegatrendEntry[]>;
  byComp: Map<string, CompetitorEntry[]>;
};

const tally = (keys: string[]) => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()];
};

/** A Macrotrend's Subtrends and its top six competitors (and the rest as Others), as Activity over the same time frame. */
function MacroPopup({ name, d, timeFrame, onClose }: { name: string; d: Data; timeFrame: string; onClose: () => void }) {
  const macro = d.macros.find((m) => m.name === name);
  const list = d.byMacro.get(name) ?? [];
  const subNames = [...(macro?.subtrends.map((s) => s.name) ?? [])];
  const subColour = colourMap(subNames);
  const subs = activitySeries(list, d.buckets, (e) => [e.subtrend ?? "No Subtrend"]);
  const subLayers: Layer[] = [...subNames, "No Subtrend"].filter((s) => subs.has(s)).map((s) => ({ key: s, values: subs.get(s)!, colour: subColour.get(s) ?? NEUTRAL }));
  const comps = topWithOthers(
    activitySeries(
      d.compAll.filter((e) => e.macrotrend === name),
      d.buckets,
      (e) => e.competitors,
    ),
    6,
  );
  const compColour = seriesColours(comps.map((c) => c.key));
  const compLayers: Layer[] = comps.map((c) => ({ key: c.key, values: c.values, colour: compColour.get(c.key)! }));
  return (
    <Popup title={name} sub={`${timeFrame} · each point the Activity of the month up to it`} onClose={onClose} className="dd-macro-pop" testId="dd-macro-popup">
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

function MacroProfile({ d, sections, timeFrame, value, onChange, today }: { d: Data; sections: { macrotrend: string; section: string; text: string }[]; timeFrame: string; value: string | null; onChange: (v: string) => void; today: string }) {
  const byVolume = [...d.macros].filter((m) => m.count > 0).sort((a, b) => b.count - a.count);
  const change = (n: string) => activityChange(d.byMacro.get(n) ?? [], today);
  const name = value ?? defaultPick(byVolume.map((m) => m.name), change) ?? d.names[0] ?? "";
  const macro = d.macros.find((m) => m.name === name);
  const icon = (n: string) => <MacroIcon name={n} {...(d.styles.get(n) ?? { colour: NEUTRAL, hatch: false })} />;
  const text = sections.find((s) => s.macrotrend === name && s.section === "overview")?.text || macro?.summary?.text;
  const list = d.byMacroIn.get(name) ?? [];
  const subColour = colourMap(macro?.subtrends.map((s) => s.name) ?? []);
  const comp = tally(d.compIn.filter((e) => e.macrotrend === name).flatMap((e) => e.competitors));
  const compColour = seriesColours(comp.sort((a, b) => b[1] - a[1]).map(([c]) => c));
  if (!name) return null;
  return (
    <ProfileCard
      side="left"
      kind="Macrotrend"
      title="Macrotrend Profile"
      top={byVolume.slice(0, 5).map((m) => ({ name: m.name, icon: icon(m.name) }))}
      all={d.names}
      value={name}
      onChange={onChange}
      iconOf={icon}
      change={change(name)}
      testId="dd-macro-profile"
      textLabel="Analysis"
      text={<Analysis text={text} empty={`No analysis of ${name} yet: add one on New Entry → Input trend analysis.`} testId="dd-macro-analysis" />}
      bars={
        <>
          <FocusBar
            label="Subtrends"
            counts={tally(list.map((e) => e.subtrend ?? "No Subtrend"))}
            colourOf={(s) => ({ colour: subColour.get(s) ?? NEUTRAL })}
            empty={macro?.subtrends.length ? "No signals in this time frame" : `${name} has no Subtrends yet`}
            testId="dd-focus-subtrends"
          />
          <FocusBar label="Competitors" counts={comp} colourOf={(c) => ({ colour: compColour.get(c) ?? NEUTRAL })} empty="No signals naming a competitor in this time frame" testId="dd-focus-competitors" />
        </>
      }
      footer={
        <>
          <span className="dd-foot-note">{timeFrame}</span>
          <MacroAnalysisLink name={name} />
        </>
      }
    />
  );
}

function CompetitorProfile({
  d,
  competitors,
  logos,
  value,
  onChange,
  today,
  me,
}: {
  d: Data;
  competitors: { name: string; count: number; tier: number; summary: { text: string } | null }[];
  logos: { name: string; updatedAt: string }[];
  value: string | null;
  onChange: (v: string) => void;
  today: string;
  me: Me;
}) {
  const logo = new Map(logos.map((l) => [l.name, l.updatedAt]));
  const tier = new Map(competitors.map((c) => [c.name, c.tier]));
  const change = (n: string) => activityChange(d.byComp.get(n) ?? [], today);
  const name = value ?? defaultPick(competitors.map((c) => c.name), change) ?? "";
  if (!name)
    return (
      <section className="dd-card dd-profile right">
        <p className="dd-muted">No signals name a competitor yet.</p>
      </section>
    );
  const comp = competitors.find((c) => c.name === name);
  const icon = (n: string) => <CompetitorIcon name={n} tier={tier.get(n) ?? 4} logo={logo.get(n) ?? null} />;
  const q = quarters(today);
  const mine = d.byComp.get(name) ?? [];
  const split = (a: string, b: string) => tally(mine.filter((e) => e.date >= a && e.date < b).map((e) => e.macrotrend));
  const colourOf = (m: string) => d.styles.get(m) ?? { colour: NEUTRAL };
  const text = comp?.summary?.text;
  return (
    <ProfileCard
      side="right"
      kind="competitor"
      title="Competitor Profile"
      top={competitors.slice(0, 5).map((c) => ({ name: c.name, icon: icon(c.name) }))}
      all={competitors.map((c) => c.name)}
      value={name}
      onChange={onChange}
      iconOf={icon}
      change={change(name)}
      testId="dd-comp-profile"
      textLabel="Company profile"
      text={<Analysis text={text} empty={`No Company Profile of ${name} yet: add one on New Entry → Input trend analysis.`} testId="dd-comp-analysis" />}
      bars={
        <>
          <FocusBar label={`This quarter · ${q.current.name.slice(5)}`} counts={split(q.current.start, q.current.end)} colourOf={colourOf} empty="No signals this quarter yet" testId="dd-focus-this-quarter" />
          <FocusBar label={`Last quarter · ${q.previous.name.slice(5)}`} counts={split(q.previous.start, q.previous.end)} colourOf={colourOf} empty="No signals last quarter" testId="dd-focus-last-quarter" />
        </>
      }
      footer={
        <>
          <span className="dd-foot-note">
            <span className={`dd-tier-dot t${comp?.tier ?? 4}`} aria-hidden="true" />
            Tier {comp?.tier ?? 4} · {plural(comp?.count ?? 0, "signal")} in all · bars by Macrotrend
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
