/**
 * A competitor's page (request 48): Megatrends Dashboard → Competitors → a
 * company. Its Company Profile (the competitor's analysis, written on Input →
 * Input Trend Analysis) at the top, then its Signal Timeline and its impact
 * mix by Macrotrend. At the bottom, as on a Macrotrend's dashboard, an arrow
 * to Explore Signals: pressing it, scrolling on past the end or Page Down
 * glides up to the full-page knowledge graph of the company's signals (its
 * up arrow, scrolling up over its header or Page Up glide back). The graph
 * is the company's globe with its signals in orbit (request 49: no
 * Macrotrend / Subtrend breakdown).
 *
 * State lives in the URL (c = the company, v = "signals" for the graph; the
 * graph keeps e, the open signal).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CORE, can, type Me, type TrendSummary } from "@eradigm/shared";
import { ImpactMixes, RecordFromTimeline, SignalTimeline, useAnalytics, useRecordParam } from "./Analytics";
import { RichText } from "../BulletText";
import { localDateTime } from "../../lib/format";

// The knowledge graph carries three.js: loaded when Explore Signals is first opened.
const CompetitorsPage = lazy(() => import("../../pages/CompetitorsPage").then((m) => ({ default: m.CompetitorsPage })));

const STEP_LOCK_MS = 750;
const SIGNALS = "signals";

export function CompetitorDashboard({
  me,
  name,
  summary,
  colour,
  note,
  onBack,
}: {
  me: Me;
  name: string;
  summary: TrendSummary | null;
  colour: string;
  note: string;
  onBack: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const graph = params.get("v") === SIGNALS;
  const go = useCallback(
    (toGraph: boolean) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (toGraph) n.set("v", SIGNALS);
          else n.delete("v");
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  const graphRef = useRef(graph);
  graphRef.current = graph;
  // The graph is mounted once it is first opened (it is heavy), and kept.
  const [graphOn, setGraphOn] = useState(graph);
  useEffect(() => {
    if (graph) setGraphOn(true);
  }, [graph]);

  const { schema, filters, dash } = useAnalytics({ [CORE.competitors]: name }, me);
  const rec = useRecordParam();
  const d = dash.data;
  const s = summary;
  const written = s && s.source !== "default" && s.text;

  // Scrolling on past the end of the page opens the graph; scrolling up over the graph's header comes back.
  const page = useRef<HTMLDivElement>(null);
  const profile = useRef<HTMLDivElement>(null);
  const lock = useRef(0);
  const acc = useRef(0);
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    const scrollsItself = (t: HTMLElement | null, dy: number, stop: HTMLElement) => {
      for (let n = t; n && n !== stop; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) {
          if (dy > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0) return true;
        }
      }
      return false;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const t = e.target as HTMLElement | null;
      const p = profile.current;
      if (!graphRef.current) {
        // The profile scrolls as a page; only past its end does it step on.
        if (e.deltaY <= 0 || !p) return;
        if (scrollsItself(t, e.deltaY, el)) return;
        if (p.scrollTop + p.clientHeight < p.scrollHeight - 1) return;
      } else {
        // The graph keeps its own scrolling (zoom); its header steps back.
        if (e.deltaY >= 0 || t?.closest(".mg-stage, .mg-timeline, .mg-drawer, .cd-graph")) return;
      }
      e.preventDefault();
      if (Date.now() < lock.current) return;
      acc.current += e.deltaY;
      if (Math.abs(acc.current) < 40) return;
      acc.current = 0;
      lock.current = Date.now() + STEP_LOCK_MS;
      go(!graphRef.current);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [go]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], .mg-stage, .mg-timeline, .mg-drawer") || document.querySelector("[role=dialog][aria-modal=true]")) return;
      const p = profile.current;
      if (e.key === "PageDown" && !graphRef.current && p && p.scrollTop + p.clientHeight >= p.scrollHeight - 1) go(true);
      else if (e.key === "PageUp" && graphRef.current) go(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const up = (
    <button className="md-arrow" onClick={() => go(false)} data-testid="cd-up" aria-label="Back up: Company Profile">
      <span className="md-chev" aria-hidden="true">
        ⌃
      </span>
      <span className="md-arrow-label">Company Profile</span>
    </button>
  );

  return (
    <div className={`mg-page ad-page cd-page${graph ? " graph" : ""}`} ref={page} data-testid="trend-analysis-competitor">
      <header className="mg-head ta-head ad-detail-head cd-head">
        <div>
          <button className="ad-back" onClick={onBack}>
            ← All competitors
          </button>
          {/* Explore Signals: its title where the company's name is, the company above it (as on a Macrotrend's dashboard). */}
          <span className="eyebrow">
            <span className="dot" style={{ background: colour }} aria-hidden="true" /> {graph ? name : note}
          </span>
          <h1 data-testid="ta-name">{graph ? "Explore Signals" : name}</h1>
        </div>
        {graph && <div className="md-head-up">{up}</div>}
      </header>
      <div className="cd-window" data-testid="cd-window">
        <div className="cd-track" data-view={graph ? SIGNALS : "profile"}>
          <div className="cd-panel cd-profile" ref={profile} aria-hidden={graph} inert={graph} data-testid="cd-profile">
            <div className="ad-body">
              <section className="ta-summary" aria-labelledby="ta-summary-title" data-testid="ta-summary">
                <div className="ta-summary-head">
                  <h2 id="ta-summary-title">Company Profile · {name}</h2>
                  {can(me.role, "item:edit") && (
                    <Link className="ad-link" to="/input">
                      Input a new Company Profile →
                    </Link>
                  )}
                </div>
                {s?.text ? (
                  <>
                    <RichText className="ta-summary-text" testId="ta-summary-text" text={s.text} />
                    <span className="ta-summary-meta">
                      {written ? `${s.source === "ai" ? "Written by the AI writer" : `Written by ${s.updatedBy ?? "an analyst"}`}${s.updatedAt ? ` · ${localDateTime(s.updatedAt)}` : ""}` : "The default profile (no Company Profile input yet)"}
                    </span>
                  </>
                ) : (
                  <p className="ta-summary-empty">No Company Profile yet{can(me.role, "item:edit") ? ": add one on Input → Input Trend Analysis → Competitor." : "."}</p>
                )}
              </section>
              {dash.isError && (
                <p className="mg-err" role="alert">
                  Could not load the signals: {(dash.error as Error).message}
                </p>
              )}
              {d && schema && filters ? (
                <>
                  <SignalTimeline data={d} schema={schema} from={filters.from} to={filters.to} onOpen={rec.open} id="ta-tl-title" />
                  <ImpactMixes filters={filters} schema={schema} show={["macro"]} note="an entry counts for its Macrotrend" />
                </>
              ) : (
                !dash.isError && <div className="ad-skeleton" style={{ height: 420 }} role="status" aria-label="Loading the signals" />
              )}
              <div className="cd-explore">
                <button className="md-arrow" onClick={() => go(true)} data-testid="cd-down" aria-label="Next: Explore Signals">
                  <span className="md-arrow-label">Explore Signals</span>
                  <span className="md-chev" aria-hidden="true">
                    ⌄
                  </span>
                </button>
              </div>
            </div>
          </div>
          <section className="cd-panel cd-graph" aria-label={`Explore Signals: the knowledge graph of ${name}'s signals`} aria-hidden={!graph} inert={!graph} data-testid="cd-graph">
            {graphOn ? (
              <Suspense fallback={<div className="mg-loading">Loading the knowledge graph…</div>}>
                <CompetitorsPage me={me} focus={name} />
              </Suspense>
            ) : (
              <div className="mg-loading">The knowledge graph of {name}'s signals</div>
            )}
          </section>
        </div>
      </div>
      {schema && <RecordFromTimeline schema={schema} me={me} />}
    </div>
  );
}
