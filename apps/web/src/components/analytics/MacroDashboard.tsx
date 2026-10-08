/**
 * A Macrotrend's dashboard (request 34): Analytics → Megatrends Dashboard →
 * Megatrends → a Macrotrend.
 *
 * Five rows of cells on the lighter panels of the Analytics pages, two rows in
 * view at a time; the arrows (or scrolling, or Page Up / Page Down) glide to
 * the next pair: rows 1 & 2 → 2 & 3 → 3 & 4 → row 5, the full size of the four
 * cells.
 *
 * 1. What is {Macrotrend}? · Why does it matter?
 * 2. Current Landscape · Impact Mix by Subtrend (or by Competitor)
 * 3. Long-Term Landscape · Signal Timeline
 * 4. What's Next? · Impact on AbbVie
 * 5. Explore Signals: the knowledge graph of this Macrotrend only
 *
 * The text cells are the Macrotrend's analysis sections (Input → Input Trend
 * Analysis → Macrotrend, or edited in place by admins).
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CORE, MACRO_SECTIONS, can, macroSectionCell, type MacroSection, type MacroSectionKey, type Me } from "@eradigm/shared";
import { api, type ApiError } from "../../api/client";
import { useInvalidate, useMacroSections } from "../../api/hooks";
import { useToast } from "../../state/toast";
import { localDateTime } from "../../lib/format";
import { ImpactMix, RecordFromTimeline, SignalTimeline, useAnalytics, useRecordParam } from "./Analytics";
import { RichTextField } from "../RichTextField";
import { RichText } from "../BulletText";

// The knowledge graph carries three.js: loaded when row 5 is first shown.
const MegatrendsPage = lazy(() => import("../../pages/MegatrendsPage").then((m) => ({ default: m.MegatrendsPage })));

/** The four views: rows 1 & 2, 2 & 3, 3 & 4, then row 5. */
const LAST_VIEW = 3;
/** The gap between cells: the vertical gap between the Megatrends Dashboard's boxes. */
const GAP = 12;
const STEP_LOCK_MS = 750;
/** The height of the arrow bars above and below the two rows (less on short windows). */
const barHeight = () => (typeof window !== "undefined" && window.innerHeight <= 760 ? 58 : 68);

export function MacroDashboard({ me, macro, onBack }: { me: Me; macro: string; onBack: () => void }) {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get("v") ?? 0);
  const view = Number.isInteger(raw) && raw >= 0 && raw <= LAST_VIEW ? raw : 0;
  const go = useCallback(
    (v: number) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          const next = Math.max(0, Math.min(LAST_VIEW, v));
          if (next) n.set("v", String(next));
          else n.delete("v");
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  const viewRef = useRef(view);
  viewRef.current = view;

  const { schema, filters, dash } = useAnalytics({ [CORE.macrotrend]: macro }, me);
  const rec = useRecordParam();
  const sections = useMacroSections();
  const [mixKind, setMixKind] = useState<"sub" | "comp">("sub");
  // Row 5 is mounted once it is first reached (the 3D graph is heavy), and kept.
  const [graphOn, setGraphOn] = useState(view === LAST_VIEW);
  useEffect(() => {
    if (view === LAST_VIEW) setGraphOn(true);
  }, [view]);

  // The cells' height: two rows (and the gap between them) fill the window between the arrow bars.
  // Row 5 fills the whole window (request 36): its up arrow moves into the header and there is no down arrow.
  const win = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ winH: 736, bar: 68 });
  useLayoutEffect(() => {
    const el = win.current;
    if (!el) return;
    const measure = () => setSize({ winH: el.clientHeight, bar: barHeight() });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { winH, bar } = size;
  const rowH = Math.max(140, Math.floor((winH - 2 * bar - GAP) / 2));
  const offset = view === LAST_VIEW ? bar + 4 * (rowH + GAP) : view * (rowH + GAP);

  // Scrolling steps one view at a time (inner scroll areas, the timeline's zoom and the graph keep their own scrolling).
  const lock = useRef(0);
  const acc = useRef(0);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const scrollsItself = (t: HTMLElement | null, dy: number) => {
      for (let n = t; n && n !== el; n = n.parentElement) {
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
      if (viewRef.current === LAST_VIEW && t?.closest(".mg-stage, .mg-timeline, .mg-drawer")) return;
      if (scrollsItself(t, e.deltaY)) return;
      e.preventDefault();
      if (Date.now() < lock.current) return;
      acc.current += e.deltaY;
      if (Math.abs(acc.current) < 40) return;
      const dir = acc.current > 0 ? 1 : -1;
      acc.current = 0;
      const next = viewRef.current + dir;
      if (next < 0 || next > LAST_VIEW) return;
      lock.current = Date.now() + STEP_LOCK_MS;
      go(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [go]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], .mg-stage, .mg-timeline, .mg-drawer") || document.querySelector("[role=dialog][aria-modal=true]")) return;
      if (e.key === "PageDown") go(viewRef.current + 1);
      else if (e.key === "PageUp") go(viewRef.current - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const labels = [`${macro} Overview`, "Current Landscape", "Long-Term Landscape", "What's Next?", "Explore Signals"];
  // Down: the row that comes into view; up: the row at the top of the view above.
  const downLabel = view < LAST_VIEW ? labels[view === LAST_VIEW - 1 ? 4 : view + 2] : null;
  const upLabel = view > 0 ? labels[view === LAST_VIEW ? 2 : view - 1] : null;
  const sectionOf = (k: MacroSectionKey) => sections.data?.find((x) => x.macrotrend === macro && x.section === k);
  const rowStyle = { height: rowH } as CSSProperties;
  const inView = (row: number) => (view === LAST_VIEW ? row === 4 : row === view || row === view + 1);
  const last = view === LAST_VIEW;
  const upArrow = upLabel && (
    <button className="md-arrow" onClick={() => go(view - 1)} data-testid="md-up" aria-label={`Back up: ${upLabel}`}>
      <span className="md-chev" aria-hidden="true">
        ⌃
      </span>
      <span className="md-arrow-label">{upLabel}</span>
    </button>
  );

  return (
    <div className="mg-page ad-page md-page" data-testid="macro-dashboard">
      <header className="mg-head md-head">
        <div>
          <button className="ad-back" onClick={onBack}>
            ← All megatrends
          </button>
          {/* Row 5: its title where the Macrotrend's name is, the Macrotrend above it. */}
          <span className="eyebrow">{last ? macro : "Macrotrend"}</span>
          <h1 data-testid="ta-name">{last ? labels[4] : macro}</h1>
        </div>
        {last && <div className="md-head-up">{upArrow}</div>}
        <nav className="md-dots" aria-label="Dashboard rows">
          {[0, 1, 2, 3].map((v) => (
            <button key={v} aria-current={view === v ? "true" : undefined} onClick={() => go(v)} title={v === 3 ? labels[4] : `${labels[v]} · ${labels[v + 1]}`}>
              <span className="sr-only">{v === 3 ? labels[4] : `Rows ${v + 1} and ${v + 2}: ${labels[v]} and ${labels[v + 1]}`}</span>
            </button>
          ))}
        </nav>
      </header>
      <div className={`md-body${last ? " last" : ""}`} ref={body} style={{ ["--bar" as string]: `${bar}px` }}>
        <div className="md-arrow-bar up">{!last && upArrow}</div>
        <div className="md-window" ref={win} data-testid="md-window">
          <div className="md-track" style={{ transform: `translateY(${-offset}px)`, ["--gap" as string]: `${GAP}px` }} data-view={view} data-testid="md-track">
            <div className="md-row" style={rowStyle} data-row="1" aria-hidden={!inView(0)} inert={!inView(0)}>
              <SectionCell me={me} macro={macro} k="overview" s={sectionOf("overview")} />
              <SectionCell me={me} macro={macro} k="why" s={sectionOf("why")} />
            </div>
            <div className="md-row" style={rowStyle} data-row="2" aria-hidden={!inView(1)} inert={!inView(1)}>
              <SectionCell me={me} macro={macro} k="current" s={sectionOf("current")} />
              <div className="md-cell md-chart" data-testid="md-mix">
                {schema && filters ? (
                  <ImpactMix
                    key={mixKind}
                    kind={mixKind}
                    filters={filters}
                    schema={schema}
                    fit
                    noSub
                    headExtra={
                      <div className="seg md-mix-toggle" role="group" aria-label="Impact mix by">
                        {(["sub", "comp"] as const).map((k) => (
                          <button key={k} aria-pressed={mixKind === k} onClick={() => setMixKind(k)} data-testid={`md-mix-${k}`}>
                            {k === "sub" ? "Subtrend" : "Competitor"}
                          </button>
                        ))}
                      </div>
                    }
                  />
                ) : (
                  <div className="ad-skeleton md-fill" />
                )}
              </div>
            </div>
            <div className="md-row" style={rowStyle} data-row="3" aria-hidden={!inView(2)} inert={!inView(2)}>
              <SectionCell me={me} macro={macro} k="longterm" s={sectionOf("longterm")} />
              <div className="md-cell md-chart md-tl" data-testid="md-timeline">
                {dash.data && schema && filters ? (
                  <SignalTimeline data={dash.data} schema={schema} from={filters.from} to={filters.to} onOpen={rec.open} id="md-tl-title" compact />
                ) : (
                  <div className="ad-skeleton md-fill" />
                )}
              </div>
            </div>
            <div className="md-row" style={rowStyle} data-row="4" aria-hidden={!inView(3)} inert={!inView(3)}>
              <SectionCell me={me} macro={macro} k="next" s={sectionOf("next")} />
              <SectionCell me={me} macro={macro} k="abbvie" s={sectionOf("abbvie")} />
            </div>
            <div className="md-row md-row5" style={{ height: winH }} data-row="5" aria-hidden={!inView(4)} inert={!inView(4)}>
              <section className="md-cell md-graph" aria-label={`Explore Signals: the knowledge graph of ${macro}`} data-testid="md-graph">
                {graphOn ? (
                  <Suspense fallback={<div className="mg-loading">Loading the knowledge graph…</div>}>
                    <MegatrendsPage me={me} focusMacro={macro} />
                  </Suspense>
                ) : (
                  <div className="mg-loading">The knowledge graph of {macro}</div>
                )}
              </section>
            </div>
          </div>
        </div>
        <div className="md-arrow-bar down">
          {downLabel && (
            <button className="md-arrow" onClick={() => go(view + 1)} data-testid="md-down" aria-label={`Next: ${downLabel}`}>
              <span className="md-arrow-label">{downLabel}</span>
              <span className="md-chev" aria-hidden="true">
                ⌄
              </span>
            </button>
          )}
        </div>
      </div>
      {schema && <RecordFromTimeline schema={schema} me={me} />}
    </div>
  );
}

/** One of the Macrotrend's analysis sections; admins edit it in place. */
function SectionCell({ me, macro, k, s }: { me: Me; macro: string; k: MacroSectionKey; s: MacroSection | undefined }) {
  const admin = can(me.role, "settings:edit");
  const staff = can(me.role, "item:edit");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const inv = useInvalidate();
  const title = macroSectionCell(k, macro);
  const label = MACRO_SECTIONS.find((x) => x.key === k)!.label;
  const save = async () => {
    setSaving(true);
    try {
      await api("/api/macrotrends/sections", { method: "PUT", json: { macrotrend: macro, section: k, text } });
      await inv("macro-sections");
      toast(text.trim() ? `${label} saved` : `${label} cleared`);
      setEditing(false);
    } catch (e) {
      toast((e as ApiError).message, false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="md-cell md-text" aria-labelledby={`md-${k}`} data-testid={`md-section-${k}`}>
      <div className="md-text-head">
        <h2 id={`md-${k}`}>{title}</h2>
        {admin && !editing && (
          <button
            className="md-edit"
            onClick={() => {
              setText(s?.text ?? "");
              setEditing(true);
            }}
            aria-label={`Edit ${title}`}
            title="Edit (admins)"
          >
            ✎ Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="md-edit-box">
          <RichTextField id={`md-edit-${k}`} className="md-edit-text" value={text} onValueChange={setText} autoFocus rows={6} aria-label={title} />
          <div className="md-edit-foot">
            <span>{text.trim() ? `${text.length.toLocaleString("en-GB")} characters` : "Empty: saving clears this section"}</span>
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
          <div className="md-text-body" tabIndex={0}>
            <RichText text={s.text} />
          </div>
          <span className="md-text-meta">
            {s.updatedBy} · {localDateTime(s.updatedAt)}
          </span>
        </>
      ) : (
        <p className="md-text-empty">
          No analysis yet.
          {staff && (
            <>
              {" "}
              Add it on <Link to="/input">Input → Input Trend Analysis</Link>.
            </>
          )}
        </p>
      )}
    </section>
  );
}
