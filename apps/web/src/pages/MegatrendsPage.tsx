/**
 * Megatrends: a 3D knowledge graph of the Tracker entries (Macrotrends →
 * Subtrends → entries) in a field of stars, the summary of the trend in view,
 * and a timeline of the entries below. Opening an entry slides its Tracker
 * row in from the right.
 *
 * State lives in the URL (m = Macrotrend, s = Subtrend, e = open entry), so
 * Back steps out and views can be shared. The page shows both trackers and
 * all dates, with no filter bar, so the graph and timeline get the space.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { can, type MegatrendEntry, type Me } from "@eradigm/shared";
import { useMegatrends } from "../api/hooks";
import { EntrySheet, useSourcesList } from "../components/megatrends/EntrySheet";
import { GraphShell } from "../components/megatrends/GraphShell";
import type { GraphSpec } from "../components/megatrends/Graph3D";
import { bySourceOrder, impactColour, impactOrder, paletteOf, plural, timelineEntries, NEUTRAL, type Selection } from "../components/megatrends/model";
import { SummaryPanel, type PanelNode } from "../components/megatrends/SummaryPanel";
import { Timeline, type LegendItem } from "../components/megatrends/Timeline";
import "../styles/megatrends.css";

interface Focus {
  macro: string;
  sub: string | null;
}

const SEP = "\u001f";
const macroId = (m: string) => `m:${m}`;
const subId = (m: string, s: string) => `s:${m}${SEP}${s}`;
/** Hub sizes: Macrotrends and Subtrends by the square root of their entries. */
const macroR = (n: number) => Math.min(26, 5 + 2.6 * Math.sqrt(n));
const subR = (n: number) => Math.min(15, 3 + 1.9 * Math.sqrt(n));

export function MegatrendsPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  // Both trackers, all dates (the page has no filters: the graph and timeline get the space).
  const from: string | null = null;
  const to: string | null = null;
  const q = useMegatrends("all", from, to);
  const data = q.data;
  const sel: Selection = useMemo(() => ({ macro: params.get("m"), sub: params.get("m") ? params.get("s") : null }), [params]);
  const openId = params.get("e");
  // Timeline colours: by Macrotrend / Subtrend, or by Impact (with an Impact filter from its legend).
  const [colourBy, setColourBy] = useState<"trend" | "impact">("trend");
  const [impactOnly, setImpactOnly] = useState<string | null>(null);

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
  const onFocusHub = useCallback((id: string | null) => {
    if (Date.now() - flying.current < 1700) return;
    if (!id) return setFocus(null);
    if (id.startsWith("m:")) return setFocus({ macro: id.slice(2), sub: null });
    const [m = "", s = ""] = id.slice(2).split(SEP);
    setFocus({ macro: m, sub: s });
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
  const trendItems = useMemo(() => timelineEntries(entries, sel, palette), [entries, sel, palette]);
  const impacts = useMemo(() => impactOrder(trendItems.map((i) => i.entry.impact)), [trendItems]);
  const items = useMemo(
    () =>
      colourBy === "trend"
        ? trendItems
        : trendItems
            .filter((i) => !impactOnly || (i.entry.impact ?? "No Impact") === impactOnly)
            .map((i) => ({ ...i, colour: impactColour(i.entry.impact), group: i.entry.impact ?? "No Impact" })),
    [trendItems, colourBy, impactOnly],
  );
  const trendLegend: LegendItem[] = useMemo(() => {
    const base = timelineEntries(entries, { macro: sel.macro, sub: null }, palette);
    const n = new Map<string, number>();
    for (const i of base) n.set(i.group, (n.get(i.group) ?? 0) + 1);
    if (!sel.macro) return visible.filter((m) => n.get(m.name)).map((m) => ({ name: m.name, colour: palette.macro.get(m.name) ?? NEUTRAL, count: n.get(m.name) ?? 0 }));
    const own = macro?.subtrends.filter((s) => n.get(s.name)).map((s) => ({ name: s.name, colour: palette.sub.get(macro.name)?.get(s.name) ?? NEUTRAL, count: n.get(s.name) ?? 0 })) ?? [];
    const none = n.get("No Subtrend");
    return none ? [...own, { name: "No Subtrend", colour: NEUTRAL, count: none }] : own;
  }, [entries, sel.macro, palette, visible, macro]);
  const legend: LegendItem[] = useMemo(
    () =>
      colourBy === "trend"
        ? trendLegend
        : impacts.map((name) => ({ name, colour: impactColour(name === "No Impact" ? null : name), count: trendItems.filter((i) => (i.entry.impact ?? "No Impact") === name).length })),
    [colourBy, trendLegend, impacts, trendItems],
  );

  // A selected Subtrend lists its sources on the right (High Impact first); ‹ › then step through that list.
  const listKey = sel.macro && sel.sub ? subId(sel.macro, sel.sub) : null;
  const sourcesList = useSourcesList(listKey);
  const sources = useMemo(() => (listKey ? bySourceOrder(entries.filter((e) => e.macrotrend === sel.macro && e.subtrend === sel.sub)) : []), [listKey, entries, sel]);
  const inList = openId && listKey ? sources.findIndex((e) => e.id === openId) : -1;
  const openIndex = openId ? items.findIndex((i) => i.entry.id === openId) : -1;
  const openItem = openIndex >= 0 ? items[openIndex] : openId ? timelineEntries(entries, { macro: null, sub: null }, palette).find((i) => i.entry.id === openId) : undefined;
  const closeSheet = useCallback(() => {
    set({ e: null }, false);
    sourcesList.hide();
  }, [set, sourcesList]);
  const step = (dir: -1 | 1) => {
    const next = inList >= 0 ? sources[inList + dir]?.id : items[openIndex + dir]?.entry.id;
    if (next) set({ e: next }, false);
  };

  // The graph: Macrotrends (and the open one's Subtrends), each holding its entries as dots by Impact.
  const spec: GraphSpec = useMemo(() => {
    const dotsOf = (list: MegatrendEntry[]) => list.map((e) => impactColour(e.impact));
    const hubs: GraphSpec["hubs"] = [];
    for (const m of macros) {
      if (m.count < 1) continue;
      const own = entries.filter((e) => e.macrotrend === m.name);
      hubs.push({ id: macroId(m.name), level: 1, name: m.name, count: m.count, r: macroR(m.count), colour: palette.macro.get(m.name) ?? NEUTRAL, dots: dotsOf(own), labelScale: 0.9 });
      if (sel.macro !== m.name) continue;
      for (const s of m.subtrends) {
        if (s.count < 1) continue;
        hubs.push({
          id: subId(m.name, s.name),
          level: 2,
          parent: macroId(m.name),
          name: s.name,
          count: s.count,
          r: subR(s.count),
          colour: palette.sub.get(m.name)?.get(s.name) ?? NEUTRAL,
          dots: dotsOf(own.filter((e) => e.subtrend === s.name)),
          labelScale: 0.62,
        });
      }
    }
    const orbit =
      sel.macro && sel.sub
        ? {
            hub: subId(sel.macro, sel.sub),
            entries: entries.filter((e) => e.macrotrend === sel.macro && e.subtrend === sel.sub).map((e) => ({ id: e.id, title: e.title, date: e.date, colour: impactColour(e.impact) })),
          }
        : null;
    return {
      layout: "trends",
      total,
      hubs,
      ties: [],
      open: sel.macro ? macroId(sel.macro) : null,
      selected: sel.macro ? (sel.sub ? subId(sel.macro, sel.sub) : macroId(sel.macro)) : null,
      orbit,
    };
  }, [macros, entries, palette, sel, total]);
  const onHub = useCallback(
    (id: string) => {
      if (id.startsWith("m:")) {
        const m = id.slice(2);
        return select(sel.macro === m && !sel.sub ? { macro: null, sub: null } : { macro: m, sub: null });
      }
      const [m = "", s = ""] = id.slice(2).split(SEP);
      select(sel.sub === s ? { macro: m, sub: null } : { macro: m, sub: s });
    },
    [select, sel],
  );

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
    <GraphShell
      storageKey="megatrends"
      stageLabel="Megatrends knowledge graph"
      spec={spec}
      graph={{ onHub, onCore: () => select({ macro: null, sub: null }), onFocus: onFocusHub, onEntry: (id) => set({ e: id }, false) }}
      crumbs={crumbs}
      panel={
        <SummaryPanel
          node={panel}
          intro={{
            title: "Megatrends",
            count: `${plural(total, "Tracker entry", "Tracker entries")} · ${plural(visible.length, "macrotrend")}`,
            text: "Each sphere is a Macrotrend, sized by its number of Tracker entries, with its entries inside coloured by Impact. Select one to read what is happening in that space, and to reveal its Subtrends.",
          }}
          canEdit={can(me.role, "item:edit")}
          aiConnected={!!data?.aiConnected}
          focused={panelFocused}
          exploreLabel={panel?.level === "macro" ? "Explore subtrends" : null}
          onExplore={() => panel && select({ macro: panel.parent ?? panel.name, sub: panel.level === "sub" ? panel.name : null })}
        />
      }
      railTitle="Macrotrends"
      railNoun="Macrotrend list"
      rail={
        <>
          {q.isLoading && <p className="mg-hint">Loading…</p>}
          {q.isError && (
            <p className="mg-err" role="alert">
              Could not load the Megatrends.
            </p>
          )}
          {data && !visible.length && <p className="mg-hint">No Tracker entries yet.</p>}
          <ul aria-labelledby="megatrends-rail-title" data-testid="mg-macros">
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
        </>
      }
      drawerOpen={!!openItem || (sourcesList.shown && !!sources.length)}
      drawer={
        <EntrySheet
          entry={openItem?.entry ?? null}
          colour={openItem?.colour ?? NEUTRAL}
          position={inList >= 0 ? { index: inList, total: sources.length } : openIndex >= 0 ? { index: openIndex, total: items.length } : null}
          stepIn={inList >= 0 ? "in the sources list" : "on the timeline"}
          onClose={closeSheet}
          onStep={step}
          sources={listKey && sel.sub ? { title: sel.sub, entries: sources, shown: sourcesList.shown, onShow: sourcesList.show, onHide: sourcesList.hide } : null}
          onOpen={(id) => set({ e: id }, false)}
          onBack={() => {
            set({ e: null }, false);
            sourcesList.show();
          }}
        />
      }
      timeline={
        <Timeline
          items={items}
          legend={legend}
          title="Timeline"
          subtitle={`${plural(items.length, "entry", "entries")}${sel.sub ? ` in ${sel.sub}` : sel.macro ? ` in ${sel.macro}` : ""} · coloured by ${colourBy === "impact" ? "Impact" : sel.macro ? "Subtrend" : "Macrotrend"}${impactOnly && colourBy === "impact" ? ` · ${impactOnly} only` : ""}${data?.truncated ? " · most recent shown" : ""}`}
          tools={
            <div className="mg-seg sm" role="group" aria-label="Colour the timeline by">
              {(["trend", "impact"] as const).map((k) => (
                <button
                  key={k}
                  aria-pressed={colourBy === k}
                  onClick={() => {
                    setColourBy(k);
                    setImpactOnly(null);
                  }}
                >
                  {k === "trend" ? (sel.macro ? "Subtrend" : "Macrotrend") : "Impact"}
                </button>
              ))}
            </div>
          }
          from={from}
          to={to}
          openId={openItem ? openId : null}
          activeLegend={colourBy === "impact" ? impactOnly : sel.macro ? sel.sub : null}
          onOpen={(id) => set({ e: openId === id ? null : id }, false)}
          onLegend={(name) =>
            colourBy === "impact"
              ? setImpactOnly((cur) => (cur === name ? null : name))
              : sel.macro
                ? name === "No Subtrend"
                  ? undefined
                  : select({ macro: sel.macro, sub: sel.sub === name ? null : name })
                : select({ macro: name, sub: null })
          }
        />
      }
    />
  );
}
