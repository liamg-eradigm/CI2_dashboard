/**
 * Timeline of Tracker entries: one lollipop per entry at its Event Date;
 * entries of the same day are spheres stacked on one skewer. Coloured by
 * Macrotrend (or by Subtrend once a Macrotrend is selected), with a legend.
 * Hover or focus shows the title; click (or Enter) opens the entry's row.
 * Keyboard: Tab into the timeline, then ← → between days, ↑ ↓ along a skewer.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
/** The plot grows with the tallest skewer, up to this height. */
const PLOT_MAX = 128;
const PLOT_MIN = 64;
const AXIS_H = 26;
const PAD = { l: 22, r: 22, t: 12 };
const STEM = 30;
const SURFACE = "#071b29";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
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

  const order = useMemo(() => new Map(legend.map((l, i) => [l.name, i])), [legend]);
  const layout = useMemo(() => {
    if (!items.length) return null;
    const days = items.map((i) => dayNum(i.entry.date));
    let lo = Math.min(...days);
    let hi = Math.max(...days);
    if (from) lo = Math.min(lo, dayNum(from));
    if (to) hi = Math.max(hi, dayNum(to));
    lo -= 1;
    hi += 1;
    const span = Math.max(1, hi - lo);
    const innerW = width - PAD.l - PAD.r;
    const x = (d: number) => PAD.l + ((d - lo) / span) * innerW;
    const r = Math.max(4.6, Math.min(7, (innerW / span) * 0.45));
    const tallest = Math.max(...[...byDayCount(items)].map(([, n]) => n));
    const plotH = Math.max(PLOT_MIN, Math.min(PLOT_MAX, STEM + r * 2 + (tallest - 1) * (r * 2 + 1.5) + 10));
    const base = PAD.t + plotH;
    // Same-day entries share a skewer, ordered by legend then code.
    const byDay = new Map<number, TimelineItem[]>();
    for (const it of items) {
      const d = dayNum(it.entry.date);
      byDay.set(d, [...(byDay.get(d) ?? []), it]);
    }
    const room = plotH - STEM - r - 4;
    const stacks = [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([d, list]) => {
        list.sort((a, b) => (order.get(a.group) ?? 99) - (order.get(b.group) ?? 99) || a.entry.code.localeCompare(b.entry.code));
        // Compress a tall stack so it fits (the surface ring keeps spheres apart).
        const step = Math.min(r * 2 + 1.5, list.length > 1 ? room / (list.length - 1) : r * 2);
        const cx = x(d);
        const balls = list.map((it, i) => ({ it, cx, cy: base - STEM - i * step }));
        const top = balls[balls.length - 1]!.cy;
        const one = new Set(list.map((l) => l.colour)).size === 1 ? list[0]!.colour : null;
        return { d, cx, top, balls, stem: one };
      });
    // Axis ticks: months (or weeks for short spans), at least ~90 px apart.
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
      for (let d = lo + 1; d < hi; d += every) {
        const t = new Date(d * DAY);
        ticks.push({ x: x(d), label: `${t.getUTCDate()} ${MON[t.getUTCMonth()]}` });
      }
    }
    return { stacks, r, base, ticks, height: base + AXIS_H };
  }, [items, width, from, to, order]);

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
    <section className="mg-timeline" aria-labelledby="mg-tl-title" data-testid="mg-timeline">
      <div className="mg-tl-head">
        <div>
          <h2 id="mg-tl-title">{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
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
      <div className="mg-tl-plot" ref={wrap}>
        {!layout ? (
          <p className="mg-tl-empty">No entries in this period.</p>
        ) : (
          <svg width={width} height={layout.height} role="group" aria-label={`${title}: ${plural(items.length, "entry", "entries")}. Use the arrow keys to move between entries, Enter to open one.`} onKeyDown={onKey}>
            <defs>
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
                      onClick={() => onOpen(e.id)}
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
    </section>
  );
}
