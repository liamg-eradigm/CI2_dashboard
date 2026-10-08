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
import { RICH_HINT, RichTextField } from "../RichTextField";
import { SizedHeading } from "../TextSize";
import { api, type ApiError } from "../../api/client";
import { useInvalidate } from "../../api/hooks";
import { useToast } from "../../state/toast";
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
              <CompanyProfile me={me} name={name} summary={summary} />
              {dash.isError && (
                <p className="mg-err" role="alert">
                  Could not load the signals: {(dash.error as Error).message}
                </p>
              )}
              {d && schema && filters ? (
                <>
                  <SignalTimeline data={d} schema={schema} from={filters.from} to={filters.to} onOpen={rec.open} id="ta-tl-title" sizeKey="heading:cd-timeline" />
                  <ImpactMixes filters={filters} schema={schema} show={["macro"]} note="an entry counts for its Macrotrend" sizeKey={() => "heading:cd-mix"} />
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

/**
 * The Company Profile (request 50, as a Macrotrend dashboard's text boxes):
 * staff size its heading (A− / A+) and edit the text in place, where
 * selecting text offers bold, underline, size and title.
 */
function CompanyProfile({ me, name, summary: s }: { me: Me; name: string; summary: TrendSummary | null }) {
  const staff = can(me.role, "item:edit");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  const written = s && s.source !== "default" && s.text;
  const save = async () => {
    setSaving(true);
    try {
      await api<TrendSummary>("/api/megatrends/summaries", { method: "PUT", json: { level: "competitor", name, text } });
      await inv("competitors");
      toast(text.trim() ? `Company Profile of ${name} saved` : `Company Profile of ${name} set back to the default`);
      setEditing(false);
    } catch (e) {
      toast((e as ApiError).message, false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="ta-summary" aria-labelledby="ta-summary-title" data-testid="ta-summary">
      <div className="ta-summary-head">
        <SizedHeading id="ta-summary-title" sizeKey="heading:company-profile" label="Company Profile heading">
          Company Profile · {name}
        </SizedHeading>
        {staff && (
          <span className="ta-summary-tools">
            {!editing && (
              <button
                className="md-edit"
                onClick={() => {
                  setText(s?.text ?? "");
                  setEditing(true);
                }}
                aria-label={`Edit the Company Profile of ${name}`}
              >
                ✎ Edit
              </button>
            )}
            <Link className="ad-link" to="/input">
              Input a new Company Profile →
            </Link>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mg-edit ta-summary-edit">
          <RichTextField className="ta-summary-input" value={text} onValueChange={setText} autoFocus rows={8} aria-label={`Company Profile of ${name}`} aria-describedby="cd-profile-hint" testId="cd-profile-input" placeholder={`Write the Company Profile of ${name}…`} />
          <span className="list-hint" id="cd-profile-hint">
            {RICH_HINT}
          </span>
          <div className="md-edit-foot">
            <button className="mg-btn ghost sm" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
            <button className="mg-btn sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : s?.text ? (
        <>
          <RichText className="ta-summary-text" testId="ta-summary-text" text={s.text} />
          <span className="ta-summary-meta">
            {written ? `${s.source === "ai" ? "Written by the AI writer" : `Written by ${s.updatedBy ?? "an analyst"}`}${s.updatedAt ? ` · ${localDateTime(s.updatedAt)}` : ""}` : "The default profile (no Company Profile input yet)"}
          </span>
        </>
      ) : (
        <p className="ta-summary-empty">No Company Profile yet{staff ? ": edit it here, or add one on Input → Input Trend Analysis → Competitor." : "."}</p>
      )}
    </section>
  );
}
