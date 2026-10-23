/**
 * Request 70: Competitor Analysis. A matrix of small scatter plots, one per
 * competitor (rows) and Macrotrend (columns): in each, a dot per signal at its
 * Event Date (across) and Growth Intensity (up), coloured by Impact (request
 * 71: every dot at full colour, a little larger the stronger its growth). On
 * the right, each competitor's
 * signals by Impact. A plot opens larger in a popup (scroll to zoom, drag to
 * move, point at a signal for its title, press it to open the record).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CompetitorEntry } from "@eradigm/shared";
import { IMPACT_COLOURS, impactColour, plural } from "../megatrends/model";
import { dayLabel, dotSize, GROWTH_LEVELS, growthLevel, impactCounts, toDay } from "./model";
import { Popup, Tip, useSize } from "./ui";
import { MacroIcon } from "./icons";

const DAY = 86_400_000;
/** A steady small offset per signal, so signals of the same day and growth do not hide one another. */
function jitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}
const yOf = (g: string | null | undefined) => {
  const lv = growthLevel(g) ?? 1;
  return lv === 3 ? 0.2 : lv === 2 ? 0.5 : 0.8;
};

function Counts({ c }: { c: ReturnType<typeof impactCounts> }) {
  return (
    <>
      <span className="nb">{plural(c.n, "signal")}</span>{" "}
      <span className="nb">
        (<b style={{ color: IMPACT_COLOURS.high }}>{c.high}H</b>, <b style={{ color: IMPACT_COLOURS.medium }}>{c.medium}M</b>, <b style={{ color: IMPACT_COLOURS.low }}>{c.low}L</b>)
      </span>
    </>
  );
}

export function ScatterMatrix({
  entries,
  competitors,
  macros,
  macroColour,
  from,
  to,
  all,
  onOpen,
}: {
  entries: CompetitorEntry[];
  /** Rows, most signals first. */
  competitors: string[];
  /** Columns, in the taxonomy's order. */
  macros: string[];
  macroColour: Map<string, { colour: string; hatch: boolean }>;
  from: string;
  to: string;
  /** Every competitor (scrolls), or the first nine (fits). */
  all: boolean;
  onOpen: (id: string) => void;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: React.ReactNode } | null>(null);
  const [cell, setCell] = useState<{ comp: string; macro: string } | null>(null);
  const t0 = toDay(from);
  const span = Math.max(DAY, toDay(to) + DAY - t0);
  const { cells, rows } = useMemo(() => {
    const cells = new Map<string, CompetitorEntry[]>();
    const rows = new Map<string, CompetitorEntry[]>();
    for (const e of entries) {
      for (const c of e.competitors) {
        rows.set(c, [...(rows.get(c) ?? []), e]);
        const k = `${c}\u0000${e.macrotrend}`;
        cells.set(k, [...(cells.get(k) ?? []), e]);
      }
    }
    return { cells, rows };
  }, [entries]);

  const shown = all ? competitors : competitors.slice(0, 9);
  const style = { "--cols": macros.length, "--rows": shown.length } as React.CSSProperties;
  const open = cell ? (cells.get(`${cell.comp}\u0000${cell.macro}`) ?? []) : [];
  return (
    <div className={`dd-matrix${all ? " all" : ""}`} style={style} role="group" aria-label="Signals by competitor and Macrotrend" data-testid="dd-matrix">
      {!shown.length || !macros.length ? (
        <p className="dd-empty">No signals naming a competitor in this time frame</p>
      ) : (
        <div className="dd-mx-body">
          {shown.map((c) => (
            <div className="dd-mx-row" key={c} data-testid="dd-mx-row">
              <span className="dd-mx-name" title={c}>
                {c}
              </span>
              {macros.map((m) => {
                const list = cells.get(`${c}\u0000${m}`) ?? [];
                const counts = impactCounts(list);
                const label = `${c} · ${m}: ${plural(counts.n, "signal")} (${counts.high} high, ${counts.medium} medium, ${counts.low} low)`;
                return list.length ? (
                  <button
                    key={m}
                    type="button"
                    className="dd-mx-cell"
                    aria-label={`${label}. Open the scatter plot`}
                    onClick={() => setCell({ comp: c, macro: m })}
                    onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: label })}
                    onPointerLeave={() => setTip(null)}
                  >
                    {list.map((e) => {
                      const size = dotSize(e.growth);
                      return (
                        <span
                          key={e.id}
                          className="dd-mx-dot"
                          data-testid="dd-mx-dot"
                          style={{
                            left: `${6 + 88 * Math.min(1, Math.max(0, (toDay(e.date) - t0) / span))}%`,
                            top: `${100 * (yOf(e.growth) + jitter(e.id) * 0.14)}%`,
                            width: size,
                            height: size,
                            margin: -size / 2,
                            background: impactColour(e.impact),
                          }}
                        />
                      );
                    })}
                  </button>
                ) : (
                  <span key={m} className="dd-mx-cell none" aria-hidden="true" />
                );
              })}
              <span className="dd-mx-count">
                <Counts c={impactCounts(rows.get(c) ?? [])} />
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="dd-mx-foot">
        <span />
        {macros.map((m) => {
          const s = macroColour.get(m) ?? { colour: "#8b9aa6", hatch: false };
          return (
            <span key={m} className="dd-mx-col" onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: m })} onPointerLeave={() => setTip(null)} data-testid="dd-mx-col">
              <MacroIcon name={m} colour={s.colour} hatch={s.hatch} />
              <span className="sr-only">{m}</span>
            </span>
          );
        })}
        <span />
      </div>
      <Tip at={tip}>{tip?.text}</Tip>
      {cell && <ScatterPopup comp={cell.comp} macro={cell.macro} entries={open} from={from} to={to} onClose={() => setCell(null)} onOpen={(id) => (setCell(null), onOpen(id))} />}
    </div>
  );
}

const PM = { top: 14, right: 18, bottom: 28, left: 112 };

/** Date ticks for a span: days, weeks, months or quarters, about one per 90px. */
function dateTicks(a: number, b: number, width: number): number[] {
  const want = Math.max(2, Math.floor(width / 90));
  const days = (b - a) / DAY;
  const steps = [1, 2, 7, 14, 30, 61, 91, 182, 365];
  const step = steps.find((s) => days / s <= want) ?? 365;
  const out: number[] = [];
  if (step >= 30) {
    const d = new Date(a);
    d.setUTCDate(1);
    const months = Math.round(step / 30.4);
    d.setUTCMonth(Math.ceil(d.getUTCMonth() / months) * months);
    for (let t = d.getTime(); t <= b; ) {
      if (t >= a) out.push(t);
      const n = new Date(t);
      n.setUTCMonth(n.getUTCMonth() + months);
      t = n.getTime();
    }
    return out;
  }
  for (let t = Math.ceil(a / (step * DAY)) * step * DAY; t <= b; t += step * DAY) out.push(t);
  return out;
}

/** One scatter plot, large: zoom with the wheel or the buttons, drag to move along time. */
export function ScatterPopup({ comp, macro, entries, from, to, onClose, onOpen }: { comp: string; macro: string; entries: CompetitorEntry[]; from: string; to: string; onClose: () => void; onOpen: (id: string) => void }) {
  const full: [number, number] = [toDay(from), toDay(to) + DAY];
  const [dom, setDom] = useState<[number, number]>(full);
  const [box, size] = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; dom: [number, number] } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; e: CompetitorEntry } | null>(null);
  const w = Math.max(0, size.w - PM.left - PM.right);
  const h = Math.max(0, size.h - PM.top - PM.bottom);
  const x = (t: number) => ((t - dom[0]) / (dom[1] - dom[0])) * w;
  const clamp = (a: number, b: number): [number, number] => {
    const len = Math.min(full[1] - full[0], Math.max(2 * DAY, b - a));
    const s = Math.min(full[1] - len, Math.max(full[0], a));
    return [s, s + len];
  };
  const zoom = (k: number, at = 0.5) => setDom(([a, b]) => clamp(a + (b - a) * at * (1 - k), a + (b - a) * at * (1 - k) + (b - a) * k));
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = Math.min(1, Math.max(0, (e.clientX - r.left - PM.left) / Math.max(1, w)));
      zoom(e.deltaY < 0 ? 0.8 : 1.25, at);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  const zoomed = dom[1] - dom[0] < full[1] - full[0] - 1;
  const counts = impactCounts(entries);
  return (
    <Popup
      title={
        <>
          {comp} · {macro}
        </>
      }
      sub={
        <>
          <Counts c={counts} /> · {dayLabel(from)} to {dayLabel(to)}
        </>
      }
      onClose={onClose}
      className="dd-scatter-pop"
      testId="dd-scatter-popup"
    >
      <div className="dd-pop-tools">
        <ul className="dd-impact-legend" aria-label="Impact">
          {(["low", "medium", "high"] as const).map((k) => (
            <li key={k}>
              <span className="dd-dot" style={{ background: IMPACT_COLOURS[k] }} /> {k[0]!.toUpperCase() + k.slice(1)}
            </li>
          ))}
          <li className="dd-size-key">Larger dot: stronger growth</li>
        </ul>
        <span className="dd-zoom">
          <button type="button" className="icon-btn sm" onClick={() => zoom(0.7)} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="icon-btn sm" onClick={() => zoom(1 / 0.7)} aria-label="Zoom out" disabled={!zoomed}>
            −
          </button>
          <button type="button" className="icon-btn sm" onClick={() => setDom(([a, b]) => clamp(a - (b - a) * 0.25, b - (b - a) * 0.25))} aria-label="Earlier" disabled={!zoomed}>
            ←
          </button>
          <button type="button" className="icon-btn sm" onClick={() => setDom(([a, b]) => clamp(a + (b - a) * 0.25, b + (b - a) * 0.25))} aria-label="Later" disabled={!zoomed}>
            →
          </button>
          <button type="button" className="btn secondary small" onClick={() => setDom(full)} disabled={!zoomed}>
            Reset
          </button>
        </span>
      </div>
      <div className="dd-scatter" ref={box}>
        {size.w > 0 && (
          <svg
            ref={svg}
            width={size.w}
            height={size.h}
            className={zoomed ? "zoomed" : undefined}
            role="group"
            aria-label={`${comp} · ${macro}: signals by Event Date and Growth Intensity`}
            onPointerDown={(e) => {
              if ((e.target as Element).tagName === "circle") return;
              drag.current = { x: e.clientX, dom };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const dt = ((e.clientX - d.x) / Math.max(1, w)) * (d.dom[1] - d.dom[0]);
              setDom(clamp(d.dom[0] - dt, d.dom[1] - dt));
            }}
            onPointerUp={() => (drag.current = null)}
          >
            <defs>
              <clipPath id="dd-scatter-clip">
                <rect x={-8} y={-8} width={w + 16} height={h + 16} />
              </clipPath>
            </defs>
            <g transform={`translate(${PM.left},${PM.top})`}>
              {GROWTH_LEVELS.map((g) => (
                <g key={g} className="dd-grid">
                  <line x1={0} x2={w} y1={yOf(g) * h} y2={yOf(g) * h} />
                  <text x={-10} y={yOf(g) * h} dy="0.32em" textAnchor="end">
                    {g}
                  </text>
                </g>
              ))}
              {dateTicks(dom[0], dom[1], w).map((t) => (
                <text key={t} className="dd-xtick" x={x(t)} y={h + 20} textAnchor="middle">
                  {dayLabel(new Date(t).toISOString().slice(0, 10))}
                </text>
              ))}
              <g clipPath="url(#dd-scatter-clip)">
                {entries.map((e) => {
                  const cx = x(toDay(e.date) + DAY / 2);
                  if (cx < -10 || cx > w + 10) return null;
                  return (
                    <circle
                      key={e.id}
                      cx={cx}
                      cy={(yOf(e.growth) + jitter(e.id) * 0.12) * h}
                      r={dotSize(e.growth)}
                      fill={impactColour(e.impact)}
                      stroke="#04182a"
                      strokeWidth={2}
                      tabIndex={0}
                      role="button"
                      aria-label={`${e.title} · ${dayLabel(e.date)} · ${e.impact ?? "No"} impact · ${e.growth ?? "No growth intensity"}. Open the record`}
                      data-testid="dd-scatter-dot"
                      onPointerEnter={(ev) => setTip({ x: ev.clientX, y: ev.clientY, e })}
                      onPointerLeave={() => setTip(null)}
                      onFocus={(ev) => {
                        const r = (ev.target as Element).getBoundingClientRect();
                        setTip({ x: r.right, y: r.top + r.height / 2, e });
                      }}
                      onBlur={() => setTip(null)}
                      onClick={() => onOpen(e.id)}
                      onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), onOpen(e.id))}
                    />
                  );
                })}
              </g>
            </g>
          </svg>
        )}
      </div>
      <p className="dd-pop-hint">Scroll to zoom, drag to move along time; point at a signal for its title, press it to open the record.</p>
      <Tip at={tip}>
        {tip && (
          <>
            <b className="dd-tip-title">{tip.e.title}</b>
            <span className="dd-tip-foot">
              {dayLabel(tip.e.date)} · <span style={{ color: impactColour(tip.e.impact) }}>{tip.e.impact ?? "No"} impact</span>
              {" "}· {tip.e.growth ?? "No growth intensity"}
            </span>
          </>
        )}
      </Tip>
    </Popup>
  );
}
