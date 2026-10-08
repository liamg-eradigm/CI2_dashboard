/**
 * Competitors: the Megatrends view for competitors. Every competitor named by
 * a Tracker entry is a sphere (growing exponentially with its entries, so the
 * few most active stand out and those named once or twice stay small), spread
 * evenly around the centre with the biggest far apart; selecting one lights its
 * ties to the competitors it is named together with. Selecting one shows its
 * CI summary, its entries in orbit and on the timeline; opening an entry
 * slides its Tracker row in from the right.
 *
 * State lives in the URL (c = competitor, e = open entry).
 *
 * `focus` (request 48, reworked in request 49): only that company's globe with
 * its signals in orbit, embedded in its page (Explore Signals); no other
 * competitors, ties or timeline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DEFAULT_COMPETITOR_TIERS, competitorRadius, isPlaceholderCompetitor, tierOf, type CompetitorEntry, type Me } from "@eradigm/shared";
import { useCompetitors, useSettings } from "../api/hooks";
import { EntrySheet, useSourcesList } from "../components/megatrends/EntrySheet";
import { GraphShell } from "../components/megatrends/GraphShell";
import type { GraphSpec } from "../components/megatrends/Graph3D";
import { TIER_COLOUR, bySourceOrder, colourMap, impactColour, impactOrder, NEUTRAL, plural } from "../components/megatrends/model";
import { Timeline, type LegendItem } from "../components/megatrends/Timeline";
import { GraphToggle } from "../components/megatrends/GraphToggle";
import "../styles/megatrends.css";
import { useIsNewSignal } from "../components/megatrends/newSignals";

/**
 * Tiers (Administration → Competitor tiers) colour the spheres: Tier 1 red,
 * Tier 2 orange-yellow, Tier 3 green, Tier 4 (everyone else) grey. Every
 * competitor sits on the same orbit around the centre, with the Megatrends
 * look. Impact colours the entries inside each sphere.
 */
type Tier = 1 | 2 | 3 | 4;

const tierOfC = (c: { tier?: number }): Tier => (c.tier === 1 || c.tier === 2 || c.tier === 3 ? c.tier : 4);
const hubId = (name: string) => `c:${name}`;
const R_MIN = 1.4;
const R_TOP = 26;

export function CompetitorsPage({ focus }: { me?: Me; focus?: string }) {
  const [params, setParams] = useSearchParams();
  const q = useCompetitors();
  const data = q.data;
  const selected = focus ?? params.get("c");
  const openId = params.get("e");
  const [colourBy, setColourBy] = useState<"impact" | "macro">("impact");
  const [only, setOnly] = useState<string | null>(null);

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
  const select = useCallback(
    (name: string | null) => {
      // A company's own graph always shows that company.
      if (focus) return;
      setOnly(null);
      set({ c: name });
    },
    [set, focus],
  );

  // Tiers from the admin setting (computed here too, so an API from before tiers still colours them).
  const settings = useSettings();
  const isNew = useIsNewSignal();
  const tiers = settings.data?.competitorTiers ?? DEFAULT_COMPETITOR_TIERS;
  // "N/A" and the like are never competitors, whatever the API sends.
  const comps = useMemo(() => (data?.competitors ?? []).filter((c) => !isPlaceholderCompetitor(c.name)).map((c) => ({ ...c, tier: tierOf(c.name, tiers) })), [data, tiers]);
  const entries = useMemo(
    () =>
      (data?.entries ?? [])
        .map((e) => ({ ...e, competitors: (e.competitors ?? []).filter((n) => !isPlaceholderCompetitor(n)) }))
        .filter((e) => e.competitors.length > 0),
    [data],
  );
  const total = entries.length;
  const max = comps.reduce((m, c) => Math.max(m, c.count), 0);
  const byName = useMemo(() => new Map(comps.map((c) => [c.name, c])), [comps]);

  // A competitor no longer named by any entry falls back to all.
  useEffect(() => {
    if (!focus && data && selected && !byName.has(selected)) set({ c: null }, false);
  }, [data, selected, byName, set, focus]);

  const named = useCallback((e: CompetitorEntry, name: string) => e.competitors.includes(name), []);
  const ofComp = useMemo(() => {
    const m = new Map<string, CompetitorEntry[]>();
    for (const e of entries) for (const c of e.competitors) (m.get(c) ?? m.set(c, []).get(c)!).push(e);
    return m;
  }, [entries]);

  // The graph: every competitor, sized exponentially, holding its entries as dots by Impact.
  const spec: GraphSpec = useMemo(
    () => ({
      layout: "competitors",
      total,
      hubs: comps.filter((c) => !focus || c.name === focus).map((c) => {
        const r = competitorRadius(c.count, max, R_MIN, R_TOP);
        const tier = tierOfC(c);
        return {
          id: hubId(c.name),
          level: 1,
          name: c.name,
          count: c.count,
          r,
          colour: TIER_COLOUR[tier],
          dots: (ofComp.get(c.name) ?? []).map((e) => impactColour(e.impact)),
          // Named once or twice: too small to label (the name shows on hover).
          labelScale: r < 2.2 ? 0 : 0.45 + (0.5 * (r - R_MIN)) / (R_TOP - R_MIN),
        };
      }),
      ties: focus ? [] : (data?.pairs ?? []).filter((p) => !isPlaceholderCompetitor(p.a) && !isPlaceholderCompetitor(p.b)).map((p) => ({ a: hubId(p.a), b: hubId(p.b), weight: p.count })),
      open: selected ? hubId(selected) : null,
      selected: selected ? hubId(selected) : null,
      orbit: selected ? { hub: hubId(selected), entries: (ofComp.get(selected) ?? []).map((e) => ({ id: e.id, title: e.title, date: e.date, colour: impactColour(e.impact), fresh: isNew(e.date) })) } : null,
      noCore: !!focus,
    }),
    [comps, max, ofComp, data, selected, total, isNew, focus],
  );

  // Timeline: the selected competitor's entries (or every entry naming one), by Impact or by Macrotrend.
  const shownEntries = useMemo(() => (selected ? entries.filter((e) => named(e, selected)) : entries), [entries, selected, named]);
  const macroColour = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of entries) if (e.macrotrend) n.set(e.macrotrend, (n.get(e.macrotrend) ?? 0) + 1);
    return colourMap([...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k));
  }, [entries]);
  const groupOf = useCallback((e: CompetitorEntry) => (colourBy === "impact" ? (e.impact ?? "No Impact") : e.macrotrend || "No Macrotrend"), [colourBy]);
  const colourOf = useCallback((e: CompetitorEntry) => (colourBy === "impact" ? impactColour(e.impact) : (macroColour.get(e.macrotrend) ?? NEUTRAL)), [colourBy, macroColour]);
  const items = useMemo(
    () => shownEntries.filter((e) => !only || groupOf(e) === only).map((e) => ({ entry: e, colour: colourOf(e), group: groupOf(e) })),
    [shownEntries, only, groupOf, colourOf],
  );
  const legend: LegendItem[] = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of shownEntries) n.set(groupOf(e), (n.get(groupOf(e)) ?? 0) + 1);
    const names = colourBy === "impact" ? impactOrder(shownEntries.map((e) => e.impact)) : [...macroColour.keys()].filter((k) => n.has(k)).concat(n.has("No Macrotrend") ? ["No Macrotrend"] : []);
    return names.map((name) => ({ name, colour: colourBy === "impact" ? impactColour(name === "No Impact" ? null : name) : (macroColour.get(name) ?? NEUTRAL), count: n.get(name) ?? 0 }));
  }, [shownEntries, colourBy, groupOf, macroColour]);

  // A selected competitor lists its sources on the right (High Impact first); ‹ › then step through that list.
  const sourcesList = useSourcesList(selected);
  const sources = useMemo(() => (selected ? bySourceOrder(ofComp.get(selected) ?? []) : []), [selected, ofComp]);
  const inList = openId && selected ? sources.findIndex((e) => e.id === openId) : -1;
  const openIndex = openId ? items.findIndex((i) => i.entry.id === openId) : -1;
  // An entry opened from the graph or the list may be outside the timeline's legend filter.
  const elsewhere = openId && openIndex < 0 ? entries.find((x) => x.id === openId) : undefined;
  const openEntry = openIndex >= 0 ? items[openIndex] : elsewhere ? { entry: elsewhere, colour: colourOf(elsewhere) } : undefined;
  const closeSheet = useCallback(() => {
    set({ e: null }, false);
    sourcesList.hide();
  }, [set, sourcesList]);
  const step = (dir: -1 | 1) => {
    const next = inList >= 0 ? sources[inList + dir]?.id : items[openIndex + dir]?.entry.id;
    if (next) set({ e: next }, false);
  };

  const crumbs = (
    <nav className="mg-crumbs" aria-label="Graph level">
      {!focus && <GraphToggle current="competitors" onAll={() => select(null)} />}
      {selected && (
        <>
          {!focus && <span aria-hidden="true">›</span>}
          <span className="here" aria-current="page">
            {selected}
          </span>
          {byName.has(selected) && (
            <span className="mg-tier-tag" data-testid="mg-tier" style={{ ["--tier" as string]: TIER_COLOUR[tierOfC(byName.get(selected)!)] }}>
              Tier {tierOfC(byName.get(selected)!)}
            </span>
          )}
        </>
      )}
    </nav>
  );

  return (
    <GraphShell
      storageKey={focus ? "competitor-focus" : "competitors"}
      stageLabel={focus ? `${focus}: knowledge graph of its signals` : "Competitors knowledge graph"}
      spec={spec}
      embedded={!!focus}
      graph={{ onHub: (id) => select(id.slice(2) === selected ? null : id.slice(2)), onCore: () => select(null), onFocus: () => undefined, onEntry: (id) => set({ e: id }, false) }}
      crumbs={crumbs}
      keyNav={{ label: "Competitors", items: comps.filter((c) => c.count > 0).map((c) => ({ name: c.name, count: c.count, current: selected === c.name, onSelect: () => select(c.name) })) }}
      drawerOpen={!!openEntry || (sourcesList.shown && !!sources.length)}
      drawer={
        <EntrySheet
          entry={openEntry?.entry ?? null}
          colour={openEntry?.colour ?? NEUTRAL}
          position={inList >= 0 ? { index: inList, total: sources.length } : openIndex >= 0 ? { index: openIndex, total: items.length } : null}
          stepIn={inList >= 0 ? "in the signals list" : "on the timeline"}
          onClose={closeSheet}
          onStep={step}
          sources={selected ? { title: selected, entries: sources, shown: sourcesList.shown, onShow: sourcesList.show, onHide: sourcesList.hide } : null}
          onOpen={(id) => set({ e: id }, false)}
          onBack={() => {
            set({ e: null }, false);
            sourcesList.show();
          }}
        />
      }
      timeline={
        focus ? undefined : (
        <Timeline
          items={items}
          legend={legend}
          title="Timeline"
          subtitle={`${plural(items.length, "entry", "entries")}${selected ? ` naming ${selected}` : " naming a competitor"} · coloured by ${colourBy === "impact" ? "Impact" : "Macrotrend"}${only ? ` · ${only} only` : ""}${data?.truncated ? " · most recent shown" : ""}`}
          tools={
            <div className="mg-seg sm" role="group" aria-label="Colour the timeline by">
              {(["impact", "macro"] as const).map((k) => (
                <button
                  key={k}
                  aria-pressed={colourBy === k}
                  onClick={() => {
                    setColourBy(k);
                    setOnly(null);
                  }}
                >
                  {k === "impact" ? "Impact" : "Macrotrend"}
                </button>
              ))}
            </div>
          }
          from={null}
          to={null}
          openId={openEntry ? openId : null}
          activeLegend={only}
          onOpen={(id) => set({ e: openId === id ? null : id }, false)}
          onLegend={(name) => setOnly((cur) => (cur === name ? null : name))}
        />
        )
      }
    />
  );
}
