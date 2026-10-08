/**
 * Analytics → Dashboard → Trends Analysis (request 31; first built as the
 * Megatrends / Competitors "Trend analysis" subtabs in request 27).
 *
 * /analytics/megatrends and /analytics/competitors list the Macrotrends or
 * the competitors (competitors by tier, then signal count; each row's bar is
 * its signal count). A Macrotrend opens its five-row dashboard (request 34);
 * a competitor opens its own page (request 48): Company Profile, Signal
 * Timeline, impact mix by Macrotrend, then Explore Signals. State lives in the
 * URL (m / c).
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DEFAULT_COMPETITOR_TIERS, isPlaceholderCompetitor, tierOf, type Me } from "@eradigm/shared";
import { useCompetitors, useMegatrends, useSettings } from "../api/hooks";
import { CompetitorDashboard } from "../components/analytics/CompetitorDashboard";
import { MacroDashboard } from "../components/analytics/MacroDashboard";
import { NEUTRAL, TIER_COLOUR, impactColour, paletteOf, plural } from "../components/megatrends/model";
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
  const selComp = kind === "competitor" ? params.get("c") : null;

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
  const title = kind === "macro" ? "Megatrends" : "Competitors";

  // Request 34: a Macrotrend opens its own five-row dashboard.
  if (kind === "macro" && selMacro) return <MacroDashboard me={me} macro={selMacro} onBack={() => set({ m: null, s: null, e: null, v: null, signal: null }, true)} />;

  // Request 48: a competitor opens its own page (Company Profile, timeline, impact mix, then Explore Signals).
  if (selComp) {
    const comp = comps.find((c) => c.name === selComp);
    return (
      <CompetitorDashboard
        key={selComp}
        me={me}
        name={selComp}
        summary={comp?.summary ?? null}
        colour={comp ? TIER_COLOUR[comp.tier] : NEUTRAL}
        note={comp ? `Competitor · Tier ${comp.tier}` : "Competitor"}
        onBack={() => set({ c: null, v: null, m: null, s: null, e: null, signal: null }, true)}
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
          {kind === "macro"
            ? "Select a Macrotrend to open its dashboard: its analysis, its signals over time, its impact mix and its knowledge graph."
            : "Select a competitor to see its Company Profile, its signals over time, its impact mix by Macrotrend and the knowledge graph of its signals."}
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
