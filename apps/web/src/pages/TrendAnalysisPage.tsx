/**
 * Analytics → Dashboard → Trends Analysis (request 31; first built as the
 * Megatrends / Competitors "Trend analysis" subtabs in request 27).
 *
 * /analytics/megatrends and /analytics/competitors list the Macrotrends or
 * the competitors (competitors by tier, then signal count; each row's bar is
 * its signal count). Selecting one opens its own dashboard, like the
 * Analytics Dashboard: its Signal Timeline, its impact mix by Competitor (a
 * Macrotrend) or by Macrotrend (a competitor), then its trend analysis in a
 * large box. A Macrotrend opens on the whole Macrotrend; a dropdown narrows it
 * to one of its Subtrends. State lives in the URL (m, s / c).
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CORE, DEFAULT_COMPETITOR_TIERS, TREND_LEVEL_LABEL, can, isPlaceholderCompetitor, tierOf, type Me, type TrendLevel, type TrendSummary } from "@eradigm/shared";
import { useCompetitors, useMegatrends, useSettings } from "../api/hooks";
import { ImpactMixes, RecordFromTimeline, SignalTimeline, useAnalytics, useRecordParam } from "../components/analytics/Analytics";
import { MacroDashboard } from "../components/analytics/MacroDashboard";
import { NEUTRAL, TIER_COLOUR, impactColour, paletteOf, plural } from "../components/megatrends/model";
import { localDateTime } from "../lib/format";
import "../styles/megatrends.css";

type Kind = "macro" | "competitor";

type Counts = { n: number; high: number; medium: number; low: number };
const zero = (): Counts => ({ n: 0, high: 0, medium: 0, low: 0 });
function add(c: Counts, impact: string | null) {
  c.n++;
  const k = (impact ?? "").trim().toLowerCase();
  if (k === "high" || k === "medium" || k === "low") c[k]++;
}

export function TrendAnalysisPage({ me, kind }: { me: Me; kind: Kind }) {
  const [params, setParams] = useSearchParams();
  const mq = useMegatrends("all", null, null);
  const cq = useCompetitors();
  const settings = useSettings();
  const tiers = settings.data?.competitorTiers ?? DEFAULT_COMPETITOR_TIERS;
  const [find, setFind] = useState("");

  const set = useCallback(
    (patch: Record<string, string | null>, push = false) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null) n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: !push },
      ),
    [setParams],
  );
  const selMacro = kind === "macro" ? params.get("m") : null;
  const selSub = selMacro ? params.get("s") : null;
  const selComp = kind === "competitor" ? params.get("c") : null;
  const selected = kind === "macro" ? selMacro : selComp;

  const macros = useMemo(() => (mq.data?.macrotrends ?? []).filter((m) => m.count > 0), [mq.data]);
  const palette = useMemo(() => paletteOf(mq.data?.macrotrends ?? []), [mq.data]);
  const comps = useMemo(
    () => (cq.data?.competitors ?? []).filter((c) => !isPlaceholderCompetitor(c.name)).map((c) => ({ ...c, tier: tierOf(c.name, tiers) as 1 | 2 | 3 | 4 })),
    [cq.data, tiers],
  );
  // Each competitor's signals by impact (entries naming placeholders such as N/A left out).
  const compImpacts = useMemo(() => {
    const by = new Map<string, Counts>();
    for (const e of cq.data?.entries ?? []) for (const n of e.competitors ?? []) if (!isPlaceholderCompetitor(n)) add(by.get(n) ?? by.set(n, zero()).get(n)!, e.impact);
    return by;
  }, [cq.data]);

  const q = kind === "macro" ? mq : cq;
  const noun = kind === "macro" ? "Macrotrend" : "competitor";
  const title = kind === "macro" ? "Megatrends" : "Competitors";

  // Request 34: a Macrotrend opens its own five-row dashboard.
  if (kind === "macro" && selMacro) return <MacroDashboard me={me} macro={selMacro} onBack={() => set({ m: null, s: null, e: null, v: null, signal: null }, true)} />;

  if (selected) {
    const macro = selMacro ? (mq.data?.macrotrends ?? []).find((m) => m.name === selMacro) : undefined;
    const sub = macro && selSub ? macro.subtrends.find((s) => s.name === selSub) : undefined;
    const comp = selComp ? comps.find((c) => c.name === selComp) : undefined;
    const trend =
      kind === "macro"
        ? sub
          ? { level: "sub" as const, name: sub.name, summary: sub.summary, colour: palette.sub.get(selMacro!)?.get(sub.name) ?? NEUTRAL, note: `Subtrend of ${selMacro}` }
          : { level: "macro" as const, name: selMacro!, summary: macro?.summary ?? null, colour: palette.macro.get(selMacro!) ?? NEUTRAL, note: "Macrotrend" }
        : { level: "competitor" as const, name: selComp!, summary: comp?.summary ?? null, colour: comp ? TIER_COLOUR[comp.tier] : NEUTRAL, note: comp ? `Competitor · Tier ${comp.tier}` : "Competitor" };
    const values: Record<string, string> = kind === "macro" ? { [CORE.macrotrend]: selMacro!, ...(selSub ? { [CORE.subtrend]: selSub } : {}) } : { [CORE.competitors]: selComp! };
    return (
      <TrendDetail
        me={me}
        kind={kind}
        values={values}
        trend={trend}
        back={() => set({ m: null, s: null, c: null }, true)}
        title={title}
        subtrend={
          kind === "macro" && macro ? (
            <label className="ta-sub">
              <span>Subtrend</span>
              <select className="ta-select" value={selSub ?? ""} onChange={(e) => set({ s: e.target.value || null })} data-testid="ta-subtrend">
                <option value="">The whole Macrotrend</option>
                {macro.subtrends
                  .filter((s) => s.count > 0)
                  .map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.count})
                    </option>
                  ))}
              </select>
            </label>
          ) : null
        }
      />
    );
  }

  // Competitors (request 30): Tier 1 first, then Tier 2, 3 and 4; within a tier, most signals first (then A–Z). Each shows its signals by impact.
  const items: { name: string; count: number; colour: string; note: string; impacts?: Counts }[] =
    kind === "macro"
      ? macros.map((m) => ({ name: m.name, count: m.count, colour: palette.macro.get(m.name) ?? NEUTRAL, note: plural(m.subtrends.filter((s) => s.count > 0).length, "subtrend") }))
      : comps
          .filter((c) => !find.trim() || c.name.toLowerCase().includes(find.trim().toLowerCase()))
          .map((c) => ({ name: c.name, count: c.count, tier: c.tier, colour: TIER_COLOUR[c.tier], note: `Tier ${c.tier}`, impacts: compImpacts.get(c.name) ?? zero() }))
          .sort((a, b) => a.tier - b.tier || b.count - a.count || a.name.localeCompare(b.name));
  const maxCount = Math.max(1, ...items.map((it) => it.count));

  return (
    <div className="mg-page ta-page ad-page" data-testid={`trend-analysis-${kind}`}>
      <header className="mg-head ta-head">
        <div>
          <Link className="ad-back" to="/dashboard">
            ← Megatrends Dashboard
          </Link>
          <span className="eyebrow">Trends Analysis</span>
          <h1>{title}</h1>
        </div>
        <p className="ta-intro">
          Select a {noun} to see its signals over time, its impact mix by {kind === "macro" ? "competitor" : "Macrotrend"} and its trend analysis{kind === "macro" ? "; then narrow it to one of its Subtrends" : ""}.
        </p>
      </header>
      <div className="ta-body">
        {kind === "competitor" && (
          <>
            <label className="sr-only" htmlFor="ta-find">
              Find a competitor
            </label>
            <input id="ta-find" className="mg-find ta-find" type="search" placeholder="Find a competitor…" value={find} onChange={(e) => setFind(e.target.value)} />
          </>
        )}
        {q.isLoading && <p className="mg-hint">Loading…</p>}
        {q.isError && (
          <p className="mg-err" role="alert">
            Could not load the {title}.
          </p>
        )}
        {q.data && !items.length && <p className="mg-hint">{find ? `No competitor matches “${find}”.` : "No Tracker entries yet."}</p>}
        <ul className="ta-list" aria-label={kind === "macro" ? "Macrotrends" : "Competitors"}>
          {items.map((it) => (
            <li key={it.name}>
              <button className="ta-cell" onClick={() => set(kind === "macro" ? { m: it.name, s: null } : { c: it.name }, true)}>
                <span className="dot" style={{ background: it.colour }} aria-hidden="true" />
                <span className="nm">{it.name}</span>
                {it.impacts && (
                  <span className="ta-impacts" data-testid="ta-impacts">
                    {(["high", "medium", "low"] as const).map((k) => (
                      <span key={k} className="ta-imp" title={`${it.impacts![k]} ${k === "high" ? "High" : k === "medium" ? "Medium" : "Low"} impact`}>
                        <span className="dot sm" style={{ background: impactColour(k) }} aria-hidden="true" />
                        {it.impacts![k]}
                        <span className="sr-only"> {k === "high" ? "High" : k === "medium" ? "Medium" : "Low"} impact,</span>
                      </span>
                    ))}
                  </span>
                )}
                <span className="ta-note">{it.note}</span>
                <span className="ct" data-testid="ta-count">
                  <span className="ta-bar" style={{ width: `${(it.count / maxCount) * 100}%` }} aria-hidden="true" />
                  <b>{plural(it.count, "signal")}</b>
                </span>
                <span className="ta-chev" aria-hidden="true">
                  ▸
                </span>
              </button>
            </li>
          ))}
        </ul>
        {q.data?.truncated && <p className="mg-hint">Only the most recent entries are counted.</p>}
      </div>
    </div>
  );
}

/** One trend's dashboard: its timeline, its impact mix, and its trend analysis in a large box. */
function TrendDetail({
  me,
  kind,
  values,
  trend,
  back,
  title,
  subtrend,
}: {
  me: Me;
  kind: Kind;
  values: Record<string, string>;
  trend: { level: TrendLevel; name: string; summary: TrendSummary | null; colour: string; note: string };
  back: () => void;
  title: string;
  subtrend: React.ReactNode;
}) {
  const { schema, filters, dash } = useAnalytics(values, me);
  const rec = useRecordParam();
  const d = dash.data;
  const s = trend.summary;
  const written = s && s.source !== "default" && s.text;
  return (
    <div className="mg-page ta-page ad-page" data-testid={`trend-analysis-${kind}`}>
      <header className="mg-head ta-head ad-detail-head">
        <div>
          <button className="ad-back" onClick={back}>
            ← All {title.toLowerCase()}
          </button>
          <span className="eyebrow">
            <span className="dot" style={{ background: trend.colour }} aria-hidden="true" /> {trend.note}
          </span>
          <h1 data-testid="ta-name">{trend.name}</h1>
        </div>
        {subtrend}
      </header>
      <div className="ad-body">
        {dash.isError && (
          <p className="mg-err" role="alert">
            Could not load the signals: {(dash.error as Error).message}
          </p>
        )}
        {d && schema && filters ? (
          <>
            <SignalTimeline data={d} schema={schema} from={filters.from} to={filters.to} onOpen={rec.open} id="ta-tl-title" />
            <ImpactMixes filters={filters} schema={schema} show={kind === "macro" ? ["comp"] : ["macro"]} note={kind === "macro" ? undefined : "an entry counts for its Macrotrend"} />
          </>
        ) : (
          !dash.isError && <div className="ad-skeleton" style={{ height: 420 }} role="status" aria-label="Loading the signals" />
        )}
        <section className="ta-summary" aria-labelledby="ta-summary-title" data-testid="ta-summary">
          <div className="ta-summary-head">
            <h2 id="ta-summary-title">Trend analysis · {TREND_LEVEL_LABEL[trend.level]} {trend.name}</h2>
            {can(me.role, "item:edit") && (
              <Link className="ad-link" to="/input">
                Input a new trend analysis →
              </Link>
            )}
          </div>
          {s?.text ? (
            <>
              <p className="ta-summary-text" data-testid="ta-summary-text">
                {s.text}
              </p>
              <span className="ta-summary-meta">
                {written ? `${s.source === "ai" ? "Written by the AI writer" : `Written by ${s.updatedBy ?? "an analyst"}`}${s.updatedAt ? ` · ${localDateTime(s.updatedAt)}` : ""}` : "The default analysis (no trend analysis input yet)"}
              </span>
            </>
          ) : (
            <p className="ta-summary-empty">No trend analysis yet{can(me.role, "item:edit") ? ": add one on Input → Input Trend Analysis." : "."}</p>
          )}
        </section>
      </div>
      {schema && <RecordFromTimeline schema={schema} me={me} />}
    </div>
  );
}
