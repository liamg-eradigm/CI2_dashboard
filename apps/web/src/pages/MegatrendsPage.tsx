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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { MegatrendEntry, Me } from "@eradigm/shared";
import { useMegatrends } from "../api/hooks";
import { EntrySheet, useSourcesList } from "../components/megatrends/EntrySheet";
import { GraphShell } from "../components/megatrends/GraphShell";
import type { GraphSpec } from "../components/megatrends/Graph3D";
import { bySourceOrder, impactColour, impactOrder, paletteOf, plural, timelineEntries, NEUTRAL, type Selection } from "../components/megatrends/model";
import { Timeline, type LegendItem } from "../components/megatrends/Timeline";
import { GraphToggle } from "../components/megatrends/GraphToggle";
import "../styles/megatrends.css";

const SEP = "\u001f";
const macroId = (m: string) => `m:${m}`;
const subId = (m: string, s: string) => `s:${m}${SEP}${s}`;
/** Hub sizes: Macrotrends and Subtrends by the square root of their entries. */
const macroR = (n: number) => Math.min(26, 5 + 2.6 * Math.sqrt(n));
const subR = (n: number) => Math.min(15, 3 + 1.9 * Math.sqrt(n));

/**
 * `focusMacro` (request 34): only that Macrotrend's globe, its Subtrends and
 * their signals, embedded in its dashboard (Explore Signals); `s` and `e` stay
 * in the URL, `m` is the dashboard's own.
 */
export function MegatrendsPage({ focusMacro }: { me?: Me; focusMacro?: string }) {
  const [params, setParams] = useSearchParams();
  // Both trackers, all dates (the page has no filters: the graph and timeline get the space).
  const from: string | null = null;
  const to: string | null = null;
  const q = useMegatrends("all", from, to);
  const data = q.data;
  const sel: Selection = useMemo(
    () => (focusMacro ? { macro: focusMacro, sub: params.get("s") } : { macro: params.get("m"), sub: params.get("m") ? params.get("s") : null }),
    [params, focusMacro],
  );
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
  // With a focus Macrotrend, only its Subtrend changes (the dashboard keeps its own `m`).
  const select = useCallback((s: Selection) => (focusMacro ? set({ s: s.sub }) : set({ m: s.macro, s: s.sub })), [set, focusMacro]);

  const macros = useMemo(() => data?.macrotrends ?? [], [data]);
  const palette = useMemo(() => paletteOf(macros), [macros]);
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const visible = macros.filter((m) => m.count > 0 && (!focusMacro || m.name === focusMacro));
  const total = visible.reduce((n, m) => n + m.count, 0);
  const macro = sel.macro ? macros.find((m) => m.name === sel.macro) : undefined;

  // A selection that no longer exists (other tracker or period) falls back.
  useEffect(() => {
    if (!data || !sel.macro) return;
    const m = data.macrotrends.find((x) => x.name === sel.macro);
    if (!m || m.count < 1) {
      if (!focusMacro) set({ m: null, s: null }, false);
    } else if (sel.sub && !m.subtrends.some((s) => s.name === sel.sub && s.count > 0)) set({ s: null }, false);
  }, [data, sel, set, focusMacro]);
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
      if (m.count < 1 || (focusMacro && m.name !== focusMacro)) continue;
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
      frame: !!focusMacro,
    };
  }, [macros, entries, palette, sel, total, focusMacro]);
  const onHub = useCallback(
    (id: string) => {
      if (id.startsWith("m:")) {
        const m = id.slice(2);
        if (focusMacro) return select({ macro: m, sub: null });
        return select(sel.macro === m && !sel.sub ? { macro: null, sub: null } : { macro: m, sub: null });
      }
      const [m = "", s = ""] = id.slice(2).split(SEP);
      select(sel.sub === s ? { macro: m, sub: null } : { macro: m, sub: s });
    },
    [select, sel, focusMacro],
  );

  const crumbs = (
    <nav className="mg-crumbs" aria-label="Graph level">
      {!focusMacro && <GraphToggle current="megatrends" onAll={() => select({ macro: null, sub: null })} />}
      {sel.macro && (
        <>
          {!focusMacro && <span aria-hidden="true">›</span>}
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
      storageKey={focusMacro ? "megatrends-focus" : "megatrends"}
      stageLabel={focusMacro ? `${focusMacro}: knowledge graph` : "Megatrends knowledge graph"}
      spec={spec}
      embedded={!!focusMacro}
      graph={{ onHub, onCore: () => select({ macro: focusMacro ?? null, sub: null }), onFocus: () => undefined, onEntry: (id) => set({ e: id }, false) }}
      crumbs={crumbs}
      keyNav={
        macro && sel.macro
          ? {
              label: `Subtrends of ${sel.macro}`,
              items: macro.subtrends.filter((s) => s.count > 0).map((s) => ({ name: s.name, count: s.count, current: sel.sub === s.name, onSelect: () => select({ macro: sel.macro, sub: s.name }) })),
            }
          : { label: "Macrotrends", items: visible.map((m) => ({ name: m.name, count: m.count, current: false, onSelect: () => select({ macro: m.name, sub: null }) })) }
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
