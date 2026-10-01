/**
 * Timeline of Tracker entries: one lollipop per entry at its Event Date;
 * entries of the same day are spheres stacked on one skewer. Coloured by
 * Macrotrend (or by Subtrend once a Macrotrend is selected), with a legend.
 * Hover or focus shows the title; click (or Enter) opens the entry's row.
 * Keyboard: Tab into the timeline, then ← → between days, ↑ ↓ along a skewer.
 *
 * Scroll (or + / −) zooms in on the dates under the pointer; drag to move
 * across them. Drag the bar at the top to make the timeline taller or
 * shorter, or minimise it. Size and minimised state are remembered per browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { MegatrendEntry } from "@eradigm/shared";
import { formatDate } from "../../lib/format";
import { plural, shade } from "./model";

export interface TimelineItem {
  entry: MegatrendEntry;
  colour: string;
  group: string;
}
export interface LegendItem {
  name: string;
  colour: string;
  count: number;
}

const DAY = 86_400_000;
/** Unless resized, the plot grows with the tallest skewer, up to this height. */
const PLOT_AUTO_MAX = 128;
const PLOT_MIN = 64;
/** The shortest span the timeline zooms in to (days). */
const MIN_SPAN = 4;
const STORE = "eradigm.megatrends.timeline";

interface Saved {
  height: number | null;
  minimised: boolean;
}
function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<Saved> | null;
    return { height: typeof v?.height === "number" ? v.height : null, minimised: !!v?.minimised };
  } catch {
    return { height: null, minimised: false };
  }
}
function save(v: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* private mode: not remembered */
  }
}
const maxPlot = () => Math.max(PLOT_MIN + 40, Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.55));
const AXIS_H = 26;
const PAD = { l: 22, r: 22, t: 12 };
const STEM = 30;
const SURFACE = "#071b29";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
function byDayCount(items: TimelineItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.entry.date, (m.get(i.entry.date) ?? 0) + 1);
  return m;
}

export function Timeline({
  items,
  legend,
  title,
  subtitle,
  from,
  to,
  openId,
  activeLegend,
  tools,
  onOpen,
  onLegend,
}: {
  items: TimelineItem[];
  legend: LegendItem[];
  title: string;
  subtitle: string;
  from: string | null;
  to: string | null;
  openId: string | null;
  activeLegend: string | null;
  /** Extra controls at the start of the timeline's tools (e.g. what to colour by). */
  tools?: ReactNode;
  onOpen: (id: string) => void;
  onLegend: (name: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const [saved, setSaved] = useState<Saved>(loadSaved);
  const update = (v: Partial<Saved>) =>
    setSaved((cur) => {
      const next = { ...cur, ...v };
      save(next);
      return next;
    });

  const order = useMemo(() => new Map(legend.map((l, i) => [l.name, i])), [legend]);
  // The full date range, and the part in view (null = all of it).
  const extent = useMemo(() => {
    if (!items.length) return null;
    const days = items.map((i) => dayNum(i.entry.date));
    let lo = Math.min(...days);
    let hi = Math.max(...days);
    if (from) lo = Math.min(lo, dayNum(from));
    if (to) hi = Math.max(hi, dayNum(to));
    return { lo: lo - 1, hi: hi + 1 };
  }, [items, from, to]);
  const [view, setView] = useState<{ lo: number; hi: number } | null>(null);
  useEffect(() => setView(null), [extent?.lo, extent?.hi]);
  const win = view ?? extent;
  const innerW = width - PAD.l - PAD.r;
  const clampView = useCallback(
    (lo: number, hi: number) => {
      if (!extent) return null;
      const full = extent.hi - extent.lo;
      const span = Math.min(full, Math.max(MIN_SPAN, hi - lo));
      if (span >= full) return null;
      let a = lo;
      if (a < extent.lo) a = extent.lo;
      if (a + span > extent.hi) a = extent.hi - span;
      return { lo: a, hi: a + span };
    },
    [extent],
  );
  /** Zoom by `factor` (< 1 = in) keeping the date under x (px in the plot) in place. */
  const zoomAt = useCallback(
    (factor: number, x = PAD.l + innerW / 2) => {
      if (!win) return;
      const span = win.hi - win.lo;
      const t = Math.min(1, Math.max(0, (x - PAD.l) / innerW));
      const at = win.lo + t * span;
      const next = span * factor;
      setView(clampView(at - t * next, at - t * next + next));
    },
    [win, innerW, clampView],
  );

  const autoH = useMemo(() => {
    if (!items.length) return PLOT_MIN;
    const tallest = Math.max(...[...byDayCount(items)].map(([, n]) => n));
    return Math.max(PLOT_MIN, Math.min(PLOT_AUTO_MAX, STEM + 14 + (tallest - 1) * 11.5 + 10));
  }, [items]);
  const plotH = Math.min(maxPlot(), saved.height ?? autoH);

  const layout = useMemo(() => {
    if (!items.length || !win) return null;
    const { lo, hi } = win;
    const span = Math.max(1, hi - lo);
    const x = (d: number) => PAD.l + ((d - lo) / span) * innerW;
    // The lollipops grow with the timeline: a taller timeline, bigger spheres on longer stems.
    const r = Math.max(4.6, Math.min(16, plotH * 0.075, Math.max(9, (innerW / span) * 0.45)));
    const stem = Math.max(STEM, Math.round(plotH * 0.22));
    const base = PAD.t + plotH;
    // Same-day entries share a skewer, ordered by legend then code.
    const byDay = new Map<number, TimelineItem[]>();
    for (const it of items) {
      const d = dayNum(it.entry.date);
      if (d < lo - 1 || d > hi + 1) continue;
      byDay.set(d, [...(byDay.get(d) ?? []), it]);
    }
    const room = plotH - stem - r - 4;
    const stacks = [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([d, list]) => {
        list.sort((a, b) => (order.get(a.group) ?? 99) - (order.get(b.group) ?? 99) || a.entry.code.localeCompare(b.entry.code));
        // Compress a tall stack so it fits (the surface ring keeps spheres apart).
        const step = Math.min(r * 2 + 1.5, list.length > 1 ? room / (list.length - 1) : r * 2);
        const cx = x(d);
        const balls = list.map((it, i) => ({ it, cx, cy: base - stem - i * step }));
        const top = balls[balls.length - 1]!.cy;
        const one = new Set(list.map((l) => l.colour)).size === 1 ? list[0]!.colour : null;
        return { d, cx, top, balls, stem: one };
      });
    // Axis ticks: months, or days for short spans, at least ~90 px apart.
    const ticks: { x: number; label: string }[] = [];
    if (span > 75) {
      const start = new Date(lo * DAY);
      const months: Date[] = [];
      for (let y = start.getUTCFullYear(), m = start.getUTCMonth() + 1; ; m++) {
        const t = new Date(Date.UTC(y, m, 1));
        if (t.getTime() / DAY > hi) break;
        months.push(t);
      }
      const every = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(innerW / 90))));
      months.forEach((t, i) => {
        if (i % every) return;
        ticks.push({ x: x(t.getTime() / DAY), label: `${MON[t.getUTCMonth()]}${t.getUTCMonth() === 0 || i === 0 ? ` ${t.getUTCFullYear()}` : ""}` });
      });
    } else {
      const every = Math.max(1, Math.ceil(span / Math.max(1, Math.floor(innerW / 90))));
      for (let d = Math.ceil(lo) + 1; d < hi; d += every) {
        const t = new Date(d * DAY);
        ticks.push({ x: x(d), label: `${t.getUTCDate()} ${MON[t.getUTCMonth()]}${t.getUTCDate() <= every ? ` ${t.getUTCFullYear()}` : ""}` });
      }
    }
    return { stacks, r, base, ticks, height: base + AXIS_H };
  }, [items, win, innerW, plotH, order]);

  // Scroll to zoom (a native listener: React's wheel events cannot prevent the page from scrolling).
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(Math.exp(e.deltaY * 0.0016), e.clientX - r.left);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [saved.minimised]);

  // Drag to move across the dates (a click that moved is not a click on an entry).
  const drag = useRef<{ x: number; view: { lo: number; hi: number }; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [panning, setPanning] = useState(false);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !win || !view) return;
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
    const days = (dx / innerW) * (d.view.hi - d.view.lo);
    setView(clampView(d.view.lo - days, d.view.hi - days) ?? d.view);
  };
  const onPointerUp = () => {
    if (drag.current?.moved) dragged.current = true;
    drag.current = null;
    setPanning(false);
  };

  // Drag the bar at the top to resize (or use ↑ ↓ on it).
  const grip = useRef<{ y: number; h: number } | null>(null);
  const setHeight = (h: number) => update({ height: Math.round(Math.min(maxPlot(), Math.max(PLOT_MIN, h))), minimised: false });

  // Roving focus over the spheres (one tab stop for the whole timeline).
  const [cursor, setCursor] = useState<{ s: number; b: number }>({ s: -1, b: 0 });
  const [hover, setHover] = useState<{ s: number; b: number } | null>(null);
  const balls = useRef(new Map<string, SVGCircleElement>());
  useEffect(() => setCursor({ s: -1, b: 0 }), [items]);
  const stacks = layout?.stacks ?? [];
  const at = (s: number, b: number) => stacks[s]?.balls[b];
  const move = (s: number, b: number) => {
    const ball = at(s, b);
    if (!ball) return;
    setCursor({ s, b });
    setHover({ s, b });
    balls.current.get(ball.it.entry.id)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const c = cursor.s < 0 ? { s: stacks.length - 1, b: 0 } : cursor;
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(Math.min(stacks.length - 1, c.s + 1), 0),
      ArrowLeft: () => move(Math.max(0, c.s - 1), 0),
      ArrowUp: () => move(c.s, Math.min((stacks[c.s]?.balls.length ?? 1) - 1, c.b + 1)),
      ArrowDown: () => move(c.s, Math.max(0, c.b - 1)),
      Home: () => move(0, 0),
      End: () => move(stacks.length - 1, 0),
    };
    const k = keys[e.key];
    if (k) {
      e.preventDefault();
      k();
    }
  };
  const tabStop = cursor.s >= 0 ? cursor : { s: stacks.length - 1, b: 0 };
  const tip = hover ? at(hover.s, hover.b) : null;
  const gradients = useMemo(() => [...new Set(items.map((i) => i.colour))], [items]);
  const gid = (c: string) => `mg-ball-${c.slice(1)}`;

  return (
    <section className={`mg-timeline${saved.minimised ? " minimised" : ""}`} aria-labelledby="mg-tl-title" data-testid="mg-timeline">
      <div
        className="mg-tl-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the timeline"
        aria-valuemin={PLOT_MIN}
        aria-valuemax={maxPlot()}
        aria-valuenow={saved.minimised ? PLOT_MIN : plotH}
        tabIndex={0}
        title="Drag up or down to resize the timeline"
        data-testid="mg-tl-grip"
        onPointerDown={(e) => {
          grip.current = { y: e.clientY, h: saved.minimised ? PLOT_MIN : plotH };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => grip.current && setHeight(grip.current.h + (grip.current.y - e.clientY))}
        onPointerUp={() => (grip.current = null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setHeight((saved.minimised ? PLOT_MIN : plotH) + (e.key === "ArrowUp" ? 24 : -24));
          }
        }}
      >
        <span aria-hidden="true" />
      </div>
      <div className="mg-tl-head">
        <div>
          <h2 id="mg-tl-title">{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="mg-tl-tools">
          {!saved.minimised && tools}
          {!saved.minimised && layout && (
            <>
              <span className="mg-tl-range" aria-live="polite">
                {view ? `${formatDate(isoOf(Math.ceil(view.lo)))} – ${formatDate(isoOf(Math.floor(view.hi)))}` : "All dates"}
              </span>
              <button className="mg-icon sm" onClick={() => zoomAt(1 / 1.6)} aria-label="Zoom in on the timeline" title="Zoom in (or scroll)">
                +
              </button>
              <button className="mg-icon sm" onClick={() => zoomAt(1.6)} disabled={!view} aria-label="Zoom out on the timeline" title="Zoom out (or scroll)">
                −
              </button>
              <button className="mg-btn ghost sm" onClick={() => setView(null)} disabled={!view} title="Show all dates">
                Reset
              </button>
            </>
          )}
          <button className="mg-btn ghost sm" onClick={() => update({ minimised: !saved.minimised })} aria-expanded={!saved.minimised} aria-controls="mg-tl-body" data-testid="mg-tl-toggle">
            {saved.minimised ? "▴ Show timeline" : "▾ Minimise"}
          </button>
        </div>
      </div>
      <div id="mg-tl-body" hidden={saved.minimised}>
        <ul className="mg-legend" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.name}>
              <button aria-pressed={activeLegend === l.name} onClick={() => onLegend(l.name)} title={`Show only ${l.name}`}>
                <span className="dot" style={{ background: l.colour }} aria-hidden="true" />
                <span className="nm">{l.name}</span>
                <span className="ct">{l.count}</span>
              </button>
            </li>
          ))}
        </ul>
        <div
          className={`mg-tl-plot${view ? " zoomed" : ""}${panning ? " panning" : ""}`}
          ref={wrap}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid="mg-tl-plot"
        >
          {!layout ? (
            <p className="mg-tl-empty">No entries in this period.</p>
          ) : (
            <svg width={width} height={layout.height} role="group" aria-label={`${title}: ${plural(items.length, "entry", "entries")}. Use the arrow keys to move between entries, Enter to open one.`} onKeyDown={onKey}>
              <defs>
                <clipPath id="mg-tl-clip">
                  <rect x={PAD.l - 12} y={0} width={innerW + 24} height={layout.height} />
                </clipPath>
                {gradients.map((c) => (
                  <radialGradient key={c} id={gid(c)} cx="34%" cy="30%" r="70%">
                    <stop offset="0%" stopColor={shade(c, 0.62)} />
                    <stop offset="42%" stopColor={c} />
                    <stop offset="100%" stopColor={shade(c, -0.45)} />
                  </radialGradient>
                ))}
              </defs>
              <line x1={PAD.l - 8} x2={width - PAD.r + 8} y1={layout.base} y2={layout.base} className="mg-axis" />
              {layout.ticks.map((t) => (
                <g key={`${t.x}-${t.label}`} transform={`translate(${t.x},${layout.base})`} aria-hidden="true">
                  <line y2={5} className="mg-axis" />
                  <text y={19} textAnchor="middle" className="mg-tick">
                    {t.label}
                  </text>
                </g>
              ))}
              <g clipPath="url(#mg-tl-clip)">
                {layout.stacks.map((st, si) => (
                  <g key={st.d} className="mg-stack">
                    <line x1={st.cx} x2={st.cx} y1={layout.base} y2={st.top - layout.r - 3} stroke={st.stem ?? "#b5cfda"} strokeOpacity={st.stem ? 0.75 : 0.5} strokeWidth={1.4} strokeLinecap="round" />
                    <circle cx={st.cx} cy={layout.base} r={1.8} fill={st.stem ?? "#b5cfda"} aria-hidden="true" />
                    {st.balls.map((b, bi) => {
                      const e = b.it.entry;
                      const open = e.id === openId;
                      return (
                        <circle
                          key={e.id}
                          ref={(el) => {
                            if (el) balls.current.set(e.id, el);
                            else balls.current.delete(e.id);
                          }}
                          className={`mg-ball${open ? " open" : ""}`}
                          cx={b.cx}
                          cy={b.cy}
                          r={layout.r}
                          fill={`url(#${gid(b.it.colour)})`}
                          stroke={open ? "#ffffff" : SURFACE}
                          strokeWidth={open ? 2 : 1.5}
                          tabIndex={tabStop.s === si && tabStop.b === bi ? 0 : -1}
                          role="button"
                          aria-label={`${e.title || e.code}, ${formatDate(e.date)}, ${b.it.group}`}
                          aria-pressed={open}
                          data-testid="mg-ball"
                          onMouseEnter={() => setHover({ s: si, b: bi })}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => {
                            setCursor({ s: si, b: bi });
                            setHover({ s: si, b: bi });
                          }}
                          onBlur={() => setHover(null)}
                          onClick={() => {
                            if (dragged.current) return void (dragged.current = false);
                            onOpen(e.id);
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              onOpen(e.id);
                            }
                          }}
                        />
                      );
                    })}
                  </g>
                ))}
              </g>
            </svg>
          )}
          {tip && layout && (
            <div className="mg-tl-tip" role="tooltip" style={{ left: Math.min(width - 150, Math.max(150, tip.cx)), top: tip.cy - layout.r - 10 }}>
              <b>{tip.it.entry.title || tip.it.entry.code}</b>
              <span>
                <i style={{ background: tip.it.colour }} aria-hidden="true" />
                {formatDate(tip.it.entry.date)} · {tip.it.group}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
