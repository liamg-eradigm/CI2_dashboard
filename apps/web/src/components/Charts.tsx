import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CORE, bucket, getColumn, levelOf, type Bar, type DashboardData, type TrackerSchema } from "@eradigm/shared";
import { IMPACT_CLASS, IMPACT_SHAPE, formatDate } from "../lib/format";

/** Impact legend: shape + colour + text, so the chart reads without colour. */
function ImpactLegend({ schema, label }: { schema: TrackerSchema; label: string }) {
  const col = getColumn(schema, CORE.impact);
  const opts = col?.options ?? [];
  return (
    <div className="legend" aria-label={`${label} key`}>
      <span className="field-label">{label}</span>
      {opts.map((o, i) => {
        const b = bucket(i, opts.length);
        return (
          <span className="item" key={o}>
            <span className={`shape ${IMPACT_CLASS[b]}`} aria-hidden="true" />
            {o} · {IMPACT_SHAPE[b]}
          </span>
        );
      })}
    </div>
  );
}

const DAY = 86_400_000;
const dayOf = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoOfDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The shortest span the timeline zooms in to (days). */
const MIN_SPAN = 7;

/**
 * Signal Timeline: each signal by publication date and growth intensity,
 * shaped and coloured by impact. Request 31: zooms like the knowledge graph's
 * timeline: scroll (or + / −) zooms in on the dates under the pointer, drag
 * moves across them, Reset shows all dates.
 */
export function SignalTimeline({
  data,
  schema,
  from,
  to,
  onOpen,
  title = "Signal Timeline",
  id = "tl-title",
}: {
  data: DashboardData;
  schema: TrackerSchema;
  from: string;
  to: string;
  onOpen: (id: string) => void;
  title?: string;
  id?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const gCol = getColumn(schema, CORE.growth);
  const iCol = getColumn(schema, CORE.impact);
  const levels = gCol?.options ?? [];
  const gn = levels.length;
  const yOf = (i: number) => (gn > 1 ? 86 - Math.max(0, i) * (72 / (gn - 1)) : 50);

  // The full date range, and the part in view (null = all of it).
  const extent = useMemo(() => ({ lo: dayOf(from), hi: Math.max(dayOf(from) + 1, dayOf(to)) }), [from, to]);
  const [view, setView] = useState<{ lo: number; hi: number } | null>(null);
  useEffect(() => setView(null), [extent.lo, extent.hi]);
  const win = view ?? extent;
  const span = Math.max(1, win.hi - win.lo);
  const plot = useRef<HTMLDivElement>(null);
  const [plotW, setPlotW] = useState(800);
  useEffect(() => {
    const el = plot.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPlotW(el.clientWidth || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clampView = useCallback(
    (lo: number, hi: number) => {
      const full = extent.hi - extent.lo;
      const len = Math.min(full, Math.max(MIN_SPAN, hi - lo));
      if (len >= full) return null;
      let a = lo;
      if (a < extent.lo) a = extent.lo;
      if (a + len > extent.hi) a = extent.hi - len;
      return { lo: a, hi: a + len };
    },
    [extent],
  );
  /** Zoom by `factor` (< 1 = in) keeping the date at `t` (0–1 across the plot) in place. */
  const zoomAt = useCallback(
    (factor: number, t = 0.5) => {
      const at = win.lo + t * span;
      const next = span * factor;
      setView(clampView(at - t * next, at - t * next + next));
    },
    [win.lo, span, clampView],
  );
  // Scroll to zoom (a native listener: React's wheel events cannot stop the page from scrolling).
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(Math.exp(e.deltaY * 0.0016), Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  // Drag to move across the dates (a drag is not a click on a signal).
  const drag = useRef<{ x: number; view: { lo: number; hi: number }; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [panning, setPanning] = useState(false);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !view) return;
    drag.current = { x: e.clientX, view: win, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setPanning(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const days = (dx / Math.max(1, plotW)) * (d.view.hi - d.view.lo);
    setView(clampView(d.view.lo - days, d.view.hi - days) ?? d.view);
  };
  const onPointerUp = () => {
    if (drag.current?.moved) dragged.current = true;
    drag.current = null;
    setPanning(false);
  };

  const all = useMemo(
    () =>
      data.timeline.map((s) => {
        const n = Number.parseInt(s.code.replace(/\D/g, ""), 10) || 0;
        const gi = levelOf(gCol, s.growth);
        const ii = levelOf(iCol, s.impact);
        const cls = ii < 0 ? "none" : IMPACT_CLASS[bucket(ii, iCol?.options?.length ?? 3)];
        const yn = yOf(gi) + (((n * 37) % 17) - 8) * 0.9; // deterministic jitter
        return { ...s, gi, cls, day: dayOf(s.date), yn, size: ii };
      }),
    [data.timeline], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const points = useMemo(
    () =>
      all
        .filter((p) => p.day >= win.lo && p.day <= win.hi)
        .map((p) => ({ ...p, xn: Math.max(0.6, Math.min(99.4, ((p.day - win.lo) / span) * 100)) }))
        .sort((a, b) => a.size - b.size),
    [all, win.lo, win.hi, span],
  );

  // Axis ticks: months (with the year on January and the first), or days for short spans; at least ~80 px apart.
  const ticks = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    const room = Math.max(1, Math.floor(plotW / 80));
    if (span > 75) {
      const start = new Date(win.lo * DAY);
      const months: Date[] = [];
      for (let y = start.getUTCFullYear(), m = start.getUTCMonth() + (start.getUTCDate() > 1 ? 1 : 0); ; m++) {
        const t = new Date(Date.UTC(y, m, 1));
        if (t.getTime() / DAY > win.hi) break;
        months.push(t);
      }
      const every = Math.max(1, Math.ceil(months.length / room));
      months.forEach((t, i) => {
        if (i % every) return;
        out.push({ x: ((t.getTime() / DAY - win.lo) / span) * 100, label: `${MON[t.getUTCMonth()]}${t.getUTCMonth() === 0 || i === 0 ? ` ${String(t.getUTCFullYear()).slice(2)}` : ""}` });
      });
    } else {
      const every = Math.max(1, Math.ceil(span / room));
      for (let d = Math.ceil(win.lo); d <= win.hi; d += every) {
        const t = new Date(d * DAY);
        out.push({ x: ((d - win.lo) / span) * 100, label: `${t.getUTCDate()} ${MON[t.getUTCMonth()]}` });
      }
    }
    return out;
  }, [win.lo, win.hi, span, plotW]);

  const hp = points.find((p) => p.id === hover);
  const gLabel = gCol?.label ?? "Growth intensity";
  const iLabel = iCol?.label ?? "Impact";

  return (
    <section className="card tl-card" aria-labelledby={id}>
      <div className="card-head">
        <div>
          <h2 className="card-title" id={id}>
            {title}
          </h2>
          <span className="card-sub">{gLabel} by publication date · scroll to zoom, drag to move · select a point to open its record</span>
        </div>
        <div className="tl-tools">
          <ImpactLegend schema={schema} label={iLabel} />
          <div className="tl-zoom" role="group" aria-label="Timeline zoom">
            <span className="tl-range" aria-live="polite" data-testid="tl-range">
              {view ? `${formatDate(isoOfDay(Math.ceil(view.lo)))} – ${formatDate(isoOfDay(Math.floor(view.hi)))}` : "All dates"}
            </span>
            <button className="icon-btn sm" onClick={() => zoomAt(1 / 1.6)} aria-label="Zoom in on the timeline" title="Zoom in (or scroll)">
              +
            </button>
            <button className="icon-btn sm" onClick={() => zoomAt(1.6)} disabled={!view} aria-label="Zoom out on the timeline" title="Zoom out (or scroll)">
              −
            </button>
            <button className="btn secondary small" onClick={() => setView(null)} disabled={!view} title="Show all dates">
              Reset
            </button>
          </div>
        </div>
      </div>
      <div className="timeline">
        <div className="tl-y" aria-hidden="true">
          {levels.map((l, i) => (
            <span key={l} style={{ top: `${yOf(i)}%` }}>
              {l} <b>{i}</b>
            </span>
          ))}
        </div>
        <div
          ref={plot}
          className={`tl-plot${view ? " zoomed" : ""}${panning ? " panning" : ""}`}
          role="group"
          aria-label={`${points.length} signals plotted by date and ${gLabel.toLowerCase()}. Use Tab to move between points and Enter to open one.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid="signal-timeline"
        >
          {levels.map((l, i) => (
            <div key={l} className="tl-grid" style={{ top: `${yOf(i)}%` }} />
          ))}
          {points.map((p) => (
            <button
              key={p.id}
              className={`tl-pt ${p.cls}`}
              style={{ left: `${p.xn}%`, top: `${p.yn}%` }}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(p.id)}
              onBlur={() => setHover(null)}
              onClick={() => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                onOpen(p.id);
              }}
              aria-label={`${p.title}. ${formatDate(p.date)}. ${iLabel}: ${p.impact ?? "none"}. ${gLabel}: ${p.growth ?? "none"}. Competitors: ${p.competitors.join(", ")}`}
            />
          ))}
          {hp && (
            <div
              className="tip"
              aria-hidden="true"
              style={{
                left: `${hp.xn}%`,
                top: `${hp.yn}%`,
                transform: `${hp.xn > 62 ? "translate(calc(-100% - 14px)," : "translate(14px,"}${hp.yn > 55 ? "calc(-100% + 10px))" : "-10px)"}`,
              }}
            >
              <div className="t">{hp.title}</div>
              <dl>
                <dt>Competitors</dt>
                <dd>{hp.competitors.join(", ") || "—"}</dd>
                <dt>Published</dt>
                <dd>{formatDate(hp.date)}</dd>
                <dt>{iLabel}</dt>
                <dd>{hp.impact ?? "—"}</dd>
                <dt>{gLabel}</dt>
                <dd>
                  {hp.growth ?? "—"}
                  {hp.gi >= 0 ? ` (${hp.gi})` : ""}
                </dd>
                <dt>Source</dt>
                <dd>{hp.source ?? "—"}</dd>
              </dl>
            </div>
          )}
          {!points.length && <div className="empty tl-empty">{all.length ? "No signals in these dates. Zoom out or Reset." : "No approved signals yet."}</div>}
        </div>
        <div />
        <div className="tl-x" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.label + t.x} style={{ left: `${t.x}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {data.timelineTruncated && <div className="foot-note">Showing the most recent {data.timeline.length} signals.</div>}
    </section>
  );
}

function MixLegend({ schema }: { schema: TrackerSchema }) {
  const opts = getColumn(schema, CORE.impact)?.options ?? [];
  const byBucket = [2, 1, 0].map((b) => ({ b, label: opts.filter((_, i) => bucket(i, opts.length) === b).join(" / ") })).filter((x) => x.label);
  return (
    <div className="legend" aria-label="Impact key">
      {byBucket.map((x) => (
        <span className="item" key={x.b}>
          <span className="swatch" style={{ background: ["var(--low)", "var(--medium)", "var(--high)"][x.b] }} aria-hidden="true" />
          {x.label}
        </span>
      ))}
    </div>
  );
}

export function BarChart({
  title,
  sub,
  bars,
  variant,
  mix,
  schema,
  onSelect,
  footer,
  full,
  limit,
  expanded = false,
  onToggle,
}: {
  title: string;
  sub: string;
  bars: Bar[];
  variant?: "sub" | "comp";
  mix?: boolean;
  schema: TrackerSchema;
  onSelect?: (label: string) => void;
  footer?: string;
  full?: boolean;
  /** Show only the first `limit` rows until expanded (the rows are ranked, so these are the largest). */
  limit?: number;
  /** Expanded state, shared by the charts of one dashboard row. */
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  const id = title.replace(/\W+/g, "-").toLowerCase();
  const opts = getColumn(schema, CORE.impact)?.options ?? ["Low", "Medium", "High"];
  const hi = opts[opts.length - 1] ?? "High";
  const lo = opts[0] ?? "Low";
  const capped = !!limit && bars.length > limit;
  const shown = capped && !expanded ? bars.slice(0, limit) : bars;
  const noun = variant === "sub" ? "subtrends" : variant === "comp" ? "competitors" : "rows";
  return (
    <section className={`card ${full ? "full-row" : "paired"}`} aria-labelledby={id}>
      <div className="card-head">
        <div>
          <h2 className="card-title" id={id}>
            {title}
          </h2>
          <span className="card-sub">{sub}</span>
        </div>
        {mix && <MixLegend schema={schema} />}
      </div>
      <div className="chart-body">
        <ul className={`bars ${variant ?? ""}`} id={`${id}-bars`} aria-label={`${title}: count per category`}>
          {shown.map((b) => (
            <li
              key={b.label}
              className={`bar-row ${mix ? "mix" : ""}`}
              aria-label={mix ? `${b.label}: ${b.high} ${hi}, ${b.medium} medium, ${b.low} ${lo}` : `${b.label}: ${b.n}`}
            >
              <div className="lbl">
                {onSelect ? (
                  <button className="link-btn" style={{ padding: 0, fontWeight: 400, color: "inherit", textAlign: "left", fontSize: "inherit" }} onClick={() => onSelect(b.label)} title={`Filter by ${b.label}`}>
                    {b.label}
                  </button>
                ) : (
                  b.label
                )}
              </div>
              {mix ? (
                <div className="track" aria-hidden="true">
                  <div className="fill h" style={{ width: `${(b.high / max) * 100}%` }} />
                  <div className="fill m" style={{ width: `${(b.medium / max) * 100}%` }} />
                  <div className="fill l" style={{ width: `${(b.low / max) * 100}%` }} />
                </div>
              ) : (
                <div className="track" aria-hidden="true">
                  <div className="fill" style={{ width: `${(b.n / max) * 100}%` }} />
                </div>
              )}
              <div className="n" aria-hidden="true">
                {mix ? `${b.high} / ${b.medium} / ${b.low}` : b.n}
              </div>
            </li>
          ))}
        </ul>
        {capped && (
          <button className="expand-btn" aria-expanded={expanded} aria-controls={`${id}-bars`} onClick={onToggle} title={expanded ? `Show the top ${limit} only` : `Show all ${bars.length} ${noun}`}>
            <span className={`expand-chev ${expanded ? "up" : ""}`} aria-hidden="true">
              ▾
            </span>
            <span className="expand-txt">{expanded ? `Show top ${limit}` : `Show all ${bars.length}`}</span>
          </button>
        )}
        {!bars.length && <div className="empty">No signals yet.</div>}
        {footer && <div className="foot-note">{footer}</div>}
      </div>
    </section>
  );
}
