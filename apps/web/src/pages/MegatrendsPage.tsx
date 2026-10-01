/**
 * Megatrends: a 3D knowledge graph of the Tracker entries (Macrotrends →
 * Subtrends → entries) in a field of stars, the summary of the trend in view,
 * and a timeline of the entries below. Opening a timeline entry slides its
 * Tracker row up from the bottom; the timeline stays in view above it.
 *
 * State lives in the URL (t = tracker, p = period, m = Macrotrend,
 * s = Subtrend, e = open entry), so Back steps out and views can be shared.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { can, minusMonths, todayIso, type Me, type Stream } from "@eradigm/shared";
import { useMegatrends, useSettings } from "../api/hooks";
import { EntrySheet } from "../components/megatrends/EntrySheet";
import { paletteOf, plural, timelineEntries, NEUTRAL, type Selection } from "../components/megatrends/model";
import { SummaryPanel, type PanelNode } from "../components/megatrends/SummaryPanel";
import { Timeline, type LegendItem } from "../components/megatrends/Timeline";
import type { Focus } from "../components/megatrends/Graph3D";
import "../styles/megatrends.css";

const Graph3D = lazy(() => import("../components/megatrends/Graph3D").then((m) => ({ default: m.Graph3D })));

const PERIODS = [
  ["3m", "3M", 3],
  ["6m", "6M", 6],
  ["12m", "12M", 12],
  ["all", "All time", 0],
] as const;
type Period = (typeof PERIODS)[number][0];
const TRACKERS = [
  ["all", "All"],
  ["primary", "Primary"],
  ["secondary", "Secondary"],
] as const;

function useReducedMotion() {
  const q = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [r, setR] = useState(!!q?.matches);
  useEffect(() => {
    if (!q) return;
    const f = () => setR(q.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [q]);
  return r;
}

export function MegatrendsPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const stream = ((["primary", "secondary"] as string[]).includes(params.get("t") ?? "") ? params.get("t") : "all") as Stream | "all";
  const period = (PERIODS.find(([k]) => k === params.get("p"))?.[0] ?? "all") as Period;
  const months = PERIODS.find(([k]) => k === period)![2];
  const today = useMemo(() => {
    try {
      return todayIso(new Date(), settings.data?.timezone);
    } catch {
      return todayIso();
    }
  }, [settings.data?.timezone]);
  const from = months ? minusMonths(today, months) : null;
  const to = months ? today : null;
  const q = useMegatrends(stream, from, to);
  const data = q.data;
  const sel: Selection = useMemo(() => ({ macro: params.get("m"), sub: params.get("m") ? params.get("s") : null }), [params]);
  const openId = params.get("e");
  const reducedMotion = useReducedMotion();
  const [noGl, setNoGl] = useState(false);

  const set = useCallback(
    (patch: Record<string, string | null>, push = true) =>
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
  // Ignore zoom focus while the camera flies to a new selection.
  const [focus, setFocus] = useState<Focus | null>(null);
  const flying = useRef(0);
  const select = useCallback(
    (s: Selection) => {
      flying.current = Date.now();
      setFocus(null);
      set({ m: s.macro, s: s.sub });
    },
    [set],
  );
  const onFocus = useCallback((f: Focus | null) => {
    if (Date.now() - flying.current < 1700) return;
    setFocus(f);
  }, []);

  const macros = useMemo(() => data?.macrotrends ?? [], [data]);
  const palette = useMemo(() => paletteOf(macros), [macros]);
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const visible = macros.filter((m) => m.count > 0);
  const total = visible.reduce((n, m) => n + m.count, 0);
  const macro = sel.macro ? macros.find((m) => m.name === sel.macro) : undefined;

  // A selection that no longer exists (other tracker or period) falls back.
  useEffect(() => {
    if (!data || !sel.macro) return;
    const m = data.macrotrends.find((x) => x.name === sel.macro);
    if (!m || m.count < 1) set({ m: null, s: null }, false);
    else if (sel.sub && !m.subtrends.some((s) => s.name === sel.sub && s.count > 0)) set({ s: null }, false);
  }, [data, sel, set]);

  // Panel: what the view zoomed in on, else the selection.
  const panel: PanelNode | null = useMemo(() => {
    const pick = focus && (focus.macro !== sel.macro || focus.sub !== sel.sub) && (!sel.macro || focus.macro === sel.macro) ? focus : sel.macro ? { macro: sel.macro, sub: sel.sub } : null;
    if (!pick) return null;
    const m = macros.find((x) => x.name === pick.macro);
    if (!m) return null;
    if (pick.sub) {
      const s = m.subtrends.find((x) => x.name === pick.sub);
      if (!s) return null;
      return { level: "sub", name: s.name, parent: m.name, count: s.count, colour: palette.sub.get(m.name)?.get(s.name) ?? NEUTRAL, summary: s.summary, children: 0 };
    }
    return { level: "macro", name: m.name, parent: null, count: m.count, colour: palette.macro.get(m.name) ?? NEUTRAL, summary: m.summary, children: m.subtrends.filter((s) => s.count > 0).length };
  }, [focus, sel, macros, palette]);
  const panelFocused = !!panel && (panel.level === "macro" ? panel.name !== sel.macro || !!sel.sub : panel.name !== sel.sub);

  // Timeline: the selection's entries; the legend is the level above it.
  const items = useMemo(() => timelineEntries(entries, sel, palette), [entries, sel, palette]);
  const legend: LegendItem[] = useMemo(() => {
    const base = timelineEntries(entries, { macro: sel.macro, sub: null }, palette);
    const n = new Map<string, number>();
    for (const i of base) n.set(i.group, (n.get(i.group) ?? 0) + 1);
    if (!sel.macro) return visible.filter((m) => n.get(m.name)).map((m) => ({ name: m.name, colour: palette.macro.get(m.name) ?? NEUTRAL, count: n.get(m.name) ?? 0 }));
    const own = macro?.subtrends.filter((s) => n.get(s.name)).map((s) => ({ name: s.name, colour: palette.sub.get(macro.name)?.get(s.name) ?? NEUTRAL, count: n.get(s.name) ?? 0 })) ?? [];
    const none = n.get("No Subtrend");
    return none ? [...own, { name: "No Subtrend", colour: NEUTRAL, count: none }] : own;
  }, [entries, sel.macro, palette, visible, macro]);

  const openIndex = openId ? items.findIndex((i) => i.entry.id === openId) : -1;
  const openItem = openIndex >= 0 ? items[openIndex] : openId ? timelineEntries(entries, { macro: null, sub: null }, palette).find((i) => i.entry.id === openId) : undefined;
  const closeSheet = useCallback(() => set({ e: null }, false), [set]);
  const step = (dir: -1 | 1) => {
    const next = items[openIndex + dir];
    if (next) set({ e: next.entry.id }, false);
  };

  const crumbs = (
    <nav className="mg-crumbs" aria-label="Graph level">
      <button onClick={() => select({ macro: null, sub: null })} aria-current={!sel.macro ? "page" : undefined}>
        All macrotrends
      </button>
      {sel.macro && (
        <>
          <span aria-hidden="true">›</span>
          <button onClick={() => select({ macro: sel.macro, sub: null })} aria-current={!sel.sub ? "page" : undefined}>
            {sel.macro}
          </button>
        </>
      )}
      {sel.sub && (
        <>
          <span aria-hidden="true">›</span>
          <span className="here" aria-current="page">
            {sel.sub}
          </span>
        </>
      )}
    </nav>
  );

  return (
    <div className={`mg-page${openItem ? " sheet-open" : ""}`} data-testid="megatrends">
      <header className="mg-head">
        <div>
          <div className="eyebrow">Competitive intelligence</div>
          <h1>Megatrends</h1>
        </div>
        <div className="mg-controls">
          <div className="mg-seg" role="group" aria-label="Tracker">
            {TRACKERS.map(([k, label]) => (
              <button key={k} aria-pressed={stream === k} onClick={() => set({ t: k === "all" ? null : k, e: null }, false)}>
                {label}
              </button>
            ))}
          </div>
          <div className="mg-seg" role="group" aria-label="Event Date period">
            {PERIODS.map(([k, label]) => (
              <button key={k} aria-pressed={period === k} onClick={() => set({ p: k === "all" ? null : k, e: null }, false)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="mg-stage" aria-label="Megatrends knowledge graph">
        {!noGl && (
          <Suspense fallback={<div className="mg-loading">Loading the knowledge graph…</div>}>
            <Graph3D
              macros={macros}
              entries={entries}
              palette={palette}
              sel={sel}
              total={total}
              reducedMotion={reducedMotion}
              onSelect={select}
              onFocus={onFocus}
              onEntry={(id) => set({ e: id }, false)}
              onUnavailable={() => setNoGl(true)}
            />
          </Suspense>
        )}
        {noGl && <p className="mg-nogl">The 3D view needs WebGL, which is switched off in this browser. The list, summaries and timeline below still work.</p>}
        {crumbs}
        <div className="mg-rail">
          <h2 className="mg-rail-title" id="mg-rail-title">
            Macrotrends
          </h2>
          {q.isLoading && <p className="mg-hint">Loading…</p>}
          {q.isError && (
            <p className="mg-err" role="alert">
              Could not load the Megatrends.
            </p>
          )}
          {data && !visible.length && <p className="mg-hint">No Tracker entries in this period.</p>}
          <ul aria-labelledby="mg-rail-title" data-testid="mg-macros">
            {visible.map((m) => {
              const on = sel.macro === m.name;
              return (
                <li key={m.name}>
                  <button className={on ? "on" : undefined} aria-expanded={on} onClick={() => select(on && !sel.sub ? { macro: null, sub: null } : { macro: m.name, sub: null })}>
                    <span className="dot" style={{ background: palette.macro.get(m.name) }} aria-hidden="true" />
                    <span className="nm">{m.name}</span>
                    <span className="ct">{m.count}</span>
                  </button>
                  {on && (
                    <ul className="mg-subs" aria-label={`Subtrends of ${m.name}`}>
                      {m.subtrends
                        .filter((s) => s.count > 0)
                        .map((s) => (
                          <li key={s.name}>
                            <button className={sel.sub === s.name ? "on" : undefined} aria-pressed={sel.sub === s.name} onClick={() => select({ macro: m.name, sub: sel.sub === s.name ? null : s.name })}>
                              <span className="dot" style={{ background: palette.sub.get(m.name)?.get(s.name) }} aria-hidden="true" />
                              <span className="nm">{s.name}</span>
                              <span className="ct">{s.count}</span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <SummaryPanel
          node={panel}
          total={total}
          macros={visible.length}
          canEdit={can(me.role, "item:edit")}
          aiConnected={!!data?.aiConnected}
          focused={panelFocused}
          onExplore={() => panel && select({ macro: panel.parent ?? panel.name, sub: panel.level === "sub" ? panel.name : null })}
        />
      </section>

      <Timeline
        items={items}
        legend={legend}
        title="Timeline"
        subtitle={`${plural(items.length, "entry", "entries")}${sel.sub ? ` in ${sel.sub}` : sel.macro ? ` in ${sel.macro} · coloured by Subtrend` : " · coloured by Macrotrend"}${data?.truncated ? " · most recent shown" : ""}`}
        from={from}
        to={to}
        openId={openItem ? openId : null}
        activeLegend={sel.macro ? sel.sub : null}
        onOpen={(id) => set({ e: openId === id ? null : id }, false)}
        onLegend={(name) => (sel.macro ? (name === "No Subtrend" ? undefined : select({ macro: sel.macro, sub: sel.sub === name ? null : name })) : select({ macro: name, sub: null }))}
      />

      <EntrySheet entry={openItem?.entry ?? null} colour={openItem?.colour ?? NEUTRAL} position={openIndex >= 0 ? { index: openIndex, total: items.length } : null} onClose={closeSheet} onStep={step} />
    </div>
  );
}
