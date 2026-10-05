/**
 * Trend analysis (request 27): the second subtab of Megatrends and of
 * Competitors (the first is the knowledge graph). A wide list of the
 * Macrotrends or the competitors; selecting one opens, in order:
 *
 * 1. Signals over time: its Tracker entries per month in a time frame
 *    (default the last 3 months), by Impact, against the period before.
 * 2. Signals by competitor (Megatrends) or by Macrotrend (Competitors), in
 *    the same time frame.
 * 3. The analysis of the trend: the same summary as in the knowledge graph.
 *
 * A Macrotrend also has a Subtrend dropdown (closed by default) to narrow it
 * down. State lives in the URL (m, s / c, t), so views can be shared.
 */
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DEFAULT_COMPETITOR_TIERS, can, isPlaceholderCompetitor, tierOf, type Me } from "@eradigm/shared";
import { useCompetitors, useMegatrends, useSettings } from "../api/hooks";
import { NEUTRAL, TIER_COLOUR, impactColour, paletteOf, plural } from "../components/megatrends/model";
import { SummaryPanel, type PanelNode } from "../components/megatrends/SummaryPanel";
import { formatDate } from "../lib/format";
import "../styles/megatrends.css";

type Kind = "macro" | "competitor";

/** Time frames in months; 0 = all time. */
const FRAMES: [number, string][] = [
  [1, "Last month"],
  [3, "Last 3 months"],
  [6, "Last 6 months"],
  [12, "Last 12 months"],
  [0, "All time"],
];
const DEFAULT_FRAME = 3;

interface Entry {
  id: string;
  date: string;
  impact: string | null;
  macrotrend: string;
  subtrend: string | null;
}

/** Today in the browser's time zone, as YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** The same day `n` months earlier (or later), as YYYY-MM-DD (the end of a shorter month when the day does not exist). */
function shiftMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** Months from `from` to `to` (YYYY-MM), newest first. */
function months(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = to; k >= from && out.length < 600; k = shiftMonths(`${k}-01`, -1).slice(0, 7)) out.push(k);
  return out;
}

type Counts = { n: number; high: number; medium: number; low: number; other: number };
const zero = (): Counts => ({ n: 0, high: 0, medium: 0, low: 0, other: 0 });
function add(c: Counts, impact: string | null) {
  c.n++;
  const k = (impact ?? "").trim().toLowerCase();
  if (k === "high" || k === "medium" || k === "low") c[k]++;
  else c.other++;
}

export function TrendAnalysisPage({ me, kind }: { me: Me; kind: Kind }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mq = useMegatrends("all", null, null);
  const cq = useCompetitors();
  const settings = useSettings();
  const tiers = settings.data?.competitorTiers ?? DEFAULT_COMPETITOR_TIERS;
  const [find, setFind] = useState("");

  const set = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null) n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  const frameRaw = Number(params.get("t") ?? DEFAULT_FRAME);
  const frame = FRAMES.some(([m]) => m === frameRaw) ? frameRaw : DEFAULT_FRAME;
  const selMacro = kind === "macro" ? params.get("m") : null;
  const selSub = selMacro ? params.get("s") : null;
  const selComp = kind === "competitor" ? params.get("c") : null;

  const macros = useMemo(() => (mq.data?.macrotrends ?? []).filter((m) => m.count > 0), [mq.data]);
  const palette = useMemo(() => paletteOf(mq.data?.macrotrends ?? []), [mq.data]);
  const comps = useMemo(
    () =>
      (cq.data?.competitors ?? [])
        .filter((c) => !isPlaceholderCompetitor(c.name))
        .map((c) => ({ ...c, tier: tierOf(c.name, tiers) as 1 | 2 | 3 | 4 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [cq.data, tiers],
  );
  // Entries naming a competitor (placeholders such as N/A dropped).
  const compEntries = useMemo(
    () => (cq.data?.entries ?? []).map((e) => ({ ...e, competitors: (e.competitors ?? []).filter((n) => !isPlaceholderCompetitor(n)) })).filter((e) => e.competitors.length > 0),
    [cq.data],
  );

  // The selection's entries (all dates), and the cross-tab's entries with their other dimension.
  const base: Entry[] = useMemo(() => {
    if (kind === "macro") return selMacro ? (mq.data?.entries ?? []).filter((e) => e.macrotrend === selMacro && (!selSub || e.subtrend === selSub)) : [];
    return selComp ? compEntries.filter((e) => e.competitors.includes(selComp)) : [];
  }, [kind, selMacro, selSub, selComp, mq.data, compEntries]);
  const cross = useMemo(() => {
    if (kind === "macro") return selMacro ? compEntries.filter((e) => e.macrotrend === selMacro && (!selSub || e.subtrend === selSub)).map((e) => ({ e, keys: e.competitors })) : [];
    return base.map((e) => ({ e, keys: [e.macrotrend || "No Macrotrend"] }));
  }, [kind, selMacro, selSub, compEntries, base]);

  // The time frame: the last `frame` months up to today (or all time), and the same length before it.
  const to = today();
  const earliest = base.reduce((m, e) => (e.date && e.date < m ? e.date : m), to);
  const from = frame ? nextDay(shiftMonths(to, -frame)) : earliest;
  const prevFrom = frame ? nextDay(shiftMonths(to, -2 * frame)) : null;
  const inFrame = (d: string) => d >= from && d <= to;

  const perMonth = useMemo(() => {
    const keys = months(from.slice(0, 7), to.slice(0, 7));
    const by = new Map(keys.map((k) => [k, zero()]));
    const total = zero();
    for (const e of base) {
      if (!e.date || !inFrame(e.date)) continue;
      const c = by.get(e.date.slice(0, 7));
      if (c) add(c, e.impact);
      add(total, e.impact);
    }
    return { rows: keys.map((k) => ({ key: k, c: by.get(k)! })), total };
  }, [base, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const previous = prevFrom ? base.filter((e) => e.date >= prevFrom && e.date < from).length : null;

  const crossRows = useMemo(() => {
    const by = new Map<string, Counts>();
    for (const { e, keys } of cross) {
      if (!e.date || !inFrame(e.date)) continue;
      for (const k of keys) add(by.get(k) ?? by.set(k, zero()).get(k)!, e.impact);
    }
    return [...by.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  }, [cross, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyOther = perMonth.total.other > 0 || crossRows.some(([, c]) => c.other > 0);
  const maxMonth = Math.max(1, ...perMonth.rows.map((r) => r.c.n));
  const frameLabel = (FRAMES.find(([m]) => m === frame)?.[1] ?? "").toLowerCase();

  // The summary: the same as in the knowledge graph.
  const macro = selMacro ? macros.find((m) => m.name === selMacro) : undefined;
  const sub = macro && selSub ? macro.subtrends.find((s) => s.name === selSub) : undefined;
  const comp = selComp ? comps.find((c) => c.name === selComp) : undefined;
  const node: PanelNode | null = sub
    ? { level: "sub", name: sub.name, parent: macro!.name, count: sub.count, colour: palette.sub.get(macro!.name)?.get(sub.name) ?? NEUTRAL, summary: sub.summary, children: 0 }
    : macro
      ? { level: "macro", name: macro.name, parent: null, count: macro.count, colour: palette.macro.get(macro.name) ?? NEUTRAL, summary: macro.summary, children: macro.subtrends.filter((s) => s.count > 0).length }
      : comp
        ? { level: "competitor", name: comp.name, parent: null, count: comp.count, colour: TIER_COLOUR[comp.tier], summary: comp.summary, children: 0, note: `Tier ${comp.tier}` }
        : null;

  const q = kind === "macro" ? mq : cq;
  const noun = kind === "macro" ? "Macrotrend" : "competitor";
  const crossNoun = kind === "macro" ? "competitor" : "Macrotrend";
  const items =
    kind === "macro"
      ? macros.map((m) => ({ name: m.name, count: m.count, colour: palette.macro.get(m.name) ?? NEUTRAL, note: plural(m.subtrends.filter((s) => s.count > 0).length, "subtrend") }))
      : comps.filter((c) => !find.trim() || c.name.toLowerCase().includes(find.trim().toLowerCase())).map((c) => ({ name: c.name, count: c.count, colour: TIER_COLOUR[c.tier], note: `Tier ${c.tier}` }));
  const selected = kind === "macro" ? selMacro : selComp;
  const pick = (name: string) => (kind === "macro" ? set({ m: selected === name ? null : name, s: null }) : set({ c: selected === name ? null : name }));

  return (
    <div className="mg-page ta-page" data-testid={`trend-analysis-${kind}`}>
      <header className="mg-head ta-head">
        <div>
          <span className="eyebrow">{kind === "macro" ? "Megatrends" : "Competitors"} · Trend analysis</span>
          <h1>Trend analysis</h1>
        </div>
        <p className="ta-intro">
          Select a {noun} to see its signals over time, its signals by {crossNoun} and the analysis of the trend{kind === "macro" ? "; choose a Subtrend to narrow it down" : ""}.
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
            Could not load the {kind === "macro" ? "Megatrends" : "Competitors"}.
          </p>
        )}
        {q.data && !items.length && <p className="mg-hint">{find ? `No competitor matches “${find}”.` : "No Tracker entries yet."}</p>}
        <ul className="ta-list" aria-label={kind === "macro" ? "Macrotrends" : "Competitors"}>
          {items.map((it) => {
            const on = selected === it.name;
            const id = `ta-${kind}-${it.name.replace(/[^A-Za-z0-9]+/g, "-")}`;
            return (
              <li key={it.name} className={on ? "on" : undefined}>
                <button className="ta-cell" aria-expanded={on} aria-controls={on ? id : undefined} onClick={() => pick(it.name)}>
                  <span className="dot" style={{ background: it.colour }} aria-hidden="true" />
                  <span className="nm">{it.name}</span>
                  <span className="ta-note">{it.note}</span>
                  <span className="ct">{plural(it.count, "signal")}</span>
                  <span className="ta-chev" aria-hidden="true">
                    {on ? "▾" : "▸"}
                  </span>
                </button>
                {on && (
                  <div className="ta-detail" id={id}>
                    {kind === "macro" && macro && (
                      <label className="ta-sub">
                        <span>Subtrend</span>
                        <select className="ta-select" value={selSub ?? ""} onChange={(e) => set({ s: e.target.value || null })} data-testid="ta-subtrend">
                          <option value="">All subtrends</option>
                          {macro.subtrends
                            .filter((s) => s.count > 0)
                            .map((s) => (
                              <option key={s.name} value={s.name}>
                                {s.name} ({s.count})
                              </option>
                            ))}
                        </select>
                      </label>
                    )}

                    <section className="ta-card" aria-labelledby={`${id}-time`}>
                      <div className="ta-card-head">
                        <h2 id={`${id}-time`}>Signals over time</h2>
                        <label className="ta-frame">
                          <span>Time frame</span>
                          <select className="ta-select" value={frame} onChange={(e) => set({ t: e.target.value === String(DEFAULT_FRAME) ? null : e.target.value })} data-testid="ta-frame">
                            {FRAMES.map(([m, l]) => (
                              <option key={m} value={m}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="ta-lede" data-testid="ta-total">
                        <b>{plural(perMonth.total.n, "signal")}</b> {frame ? `in the ${frameLabel}` : "in all"} ({formatDate(from)} – {formatDate(to)})
                        {previous != null && (
                          <span className="ta-delta">
                            {" "}
                            · {perMonth.total.n === previous ? "the same as" : perMonth.total.n > previous ? `▲ ${perMonth.total.n - previous} more than` : `▼ ${previous - perMonth.total.n} fewer than`} the{" "}
                            {frame === 1 ? "month" : `${frame} months`} before ({previous})
                          </span>
                        )}
                      </p>
                      <div className="ta-scroll">
                        <table className="ta-table" data-testid="ta-time-table">
                          <caption className="sr-only">
                            Signals per month for {sub?.name ?? selected}, {frame ? frameLabel : "all time"}
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Month</th>
                              <th scope="col" className="num">
                                Signals
                              </th>
                              <ImpactHeads other={anyOther} />
                            </tr>
                          </thead>
                          <tbody>
                            {perMonth.rows.map((r, i) => (
                              <tr key={r.key}>
                                <th scope="row">
                                  {monthLabel(r.key)}
                                  {i === perMonth.rows.length - 1 && from.slice(8) !== "01" && <span className="ta-part"> from {formatDate(from)}</span>}
                                  {i === 0 && <span className="ta-part"> to date</span>}
                                </th>
                                <td className="num">
                                  <span className="ta-bar" style={{ width: `${(r.c.n / maxMonth) * 100}%` }} aria-hidden="true" />
                                  <b>{r.c.n}</b>
                                </td>
                                <ImpactCells c={r.c} other={anyOther} />
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <th scope="row">Total</th>
                              <td className="num">
                                <b>{perMonth.total.n}</b>
                              </td>
                              <ImpactCells c={perMonth.total} other={anyOther} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </section>

                    <section className="ta-card" aria-labelledby={`${id}-cross`}>
                      <div className="ta-card-head">
                        <h2 id={`${id}-cross`}>Signals by {crossNoun}</h2>
                        <span className="ta-hint">Same time frame{kind === "macro" ? " · an entry naming several competitors counts for each" : ""}</span>
                      </div>
                      {crossRows.length === 0 ? (
                        <p className="mg-hint">No signals {kind === "macro" ? "naming a competitor" : ""} in this time frame.</p>
                      ) : (
                        <div className="ta-scroll tall">
                          <table className="ta-table" data-testid="ta-cross-table">
                            <caption className="sr-only">
                              Signals by {crossNoun} for {sub?.name ?? selected}, {frame ? frameLabel : "all time"}
                            </caption>
                            <thead>
                              <tr>
                                <th scope="col">{kind === "macro" ? "Competitor" : "Macrotrend"}</th>
                                <th scope="col" className="num">
                                  Signals
                                </th>
                                <ImpactHeads other={anyOther} />
                                <th scope="col" className="num">
                                  Share
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {crossRows.map(([k, c]) => (
                                <tr key={k}>
                                  <th scope="row">
                                    <span className="dot" style={{ background: kind === "macro" ? TIER_COLOUR[tierOf(k, tiers) as 1 | 2 | 3 | 4] : (palette.macro.get(k) ?? NEUTRAL) }} aria-hidden="true" />
                                    {k}
                                  </th>
                                  <td className="num">
                                    <b>{c.n}</b>
                                  </td>
                                  <ImpactCells c={c} other={anyOther} />
                                  <td className="num">{perMonth.total.n ? `${Math.round((c.n / perMonth.total.n) * 100)}%` : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <section className="ta-card ta-analysis" aria-label="Analysis of the trend">
                      <div className="ta-card-head">
                        <h2>Analysis of the trend</h2>
                        <span className="ta-hint">The same analysis as in the knowledge graph</span>
                      </div>
                      <SummaryPanel
                        node={node}
                        intro={{ title: "", count: "", text: "" }}
                        canEdit={can(me.role, "item:edit")}
                        aiConnected={!!q.data?.aiConnected}
                        focused={false}
                        exploreLabel="Open in the knowledge graph"
                        exploreAlways
                        onExplore={() =>
                          navigate(
                            kind === "macro"
                              ? `/megatrends?${new URLSearchParams({ m: selMacro ?? "", ...(selSub ? { s: selSub } : {}) }).toString()}`
                              : `/competitors?${new URLSearchParams({ c: selComp ?? "" }).toString()}`,
                          )
                        }
                        invalidate={kind === "macro" ? "megatrends" : "competitors"}
                      />
                    </section>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {q.data?.truncated && <p className="mg-hint">Only the most recent entries are counted.</p>}
      </div>
    </div>
  );
}

function ImpactHeads({ other }: { other: boolean }) {
  return (
    <>
      {(["High", "Medium", "Low"] as const).map((l) => (
        <th key={l} scope="col" className="num">
          <span className="dot sm" style={{ background: impactColour(l) }} aria-hidden="true" /> {l}
        </th>
      ))}
      {other && (
        <th scope="col" className="num">
          No Impact
        </th>
      )}
    </>
  );
}

function ImpactCells({ c, other }: { c: Counts; other: boolean }) {
  return (
    <>
      <td className="num">{c.high}</td>
      <td className="num">{c.medium}</td>
      <td className="num">{c.low}</td>
      {other && <td className="num">{c.other}</td>}
    </>
  );
}
