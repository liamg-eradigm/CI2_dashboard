/**
 * Request 70: a stacked area chart of Activity over time (one layer per
 * Macrotrend, Subtrend or competitor). Request 72, after the reference design:
 * every layer a quiet grey (alternating shades, white seams between them) and
 * the selected one in blue, drawn on top; a row of name tabs above picks it
 * (so does pressing a layer); a dotted line marks where the last 30 days
 * start. Hovering shows the point's values (crosshair and tooltip).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { smoothSegments, type Bucket } from "./model";
import { niceTicks, Tip, useSize } from "./ui";

export type Layer = { key: string; values: number[] };

/** The selected layer's blue, and the greys of the others (from the reference). */
export const ACCENT = "#0a7fa5";
export const GREYS = ["#d9d6d4", "#bbb7b5", "#e9e7e5", "#cbc7c5"] as const;
export const greyOf = (i: number) => GREYS[i % GREYS.length] as string;

const M = { top: 22, right: 8, bottom: 22, left: 40 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The x labels: the first point of each month, no closer than ~56px. */
function xTicks(buckets: Bucket[], width: number): { i: number; label: string }[] {
  const months = buckets.map((b, i) => ({ i, m: b.at.slice(0, 7), first: i === 0 || buckets[i - 1]!.at.slice(0, 7) !== b.at.slice(0, 7) })).filter((x) => x.first);
  const step = Math.max(1, Math.ceil((months.length * 56) / Math.max(1, width)));
  return months
    .filter((_, k) => k % step === 0)
    .map(({ i, m }) => ({ i, label: `${MONTHS[Number(m.slice(5, 7)) - 1]}${m.endsWith("-01") || i === 0 ? ` ${m.slice(0, 4)}` : ""}` }));
}

export function StackedArea({
  layers,
  buckets,
  selected: given,
  onSelect,
  marker,
  label,
  testId,
  tools,
}: {
  /** In order; the selected one is drawn on top. */
  layers: Layer[];
  buckets: Bucket[];
  /** The highlighted layer (controlled); without it, the chart keeps its own (the largest first). */
  selected?: string | null;
  onSelect?: (key: string) => void;
  /** A dotted line at a point (the start of the last 30 days). */
  marker?: { at: string; label: string } | null;
  /** The chart's accessible name. */
  label: string;
  testId?: string;
  /** Beside the tabs (e.g. a button to break the selected layer down). */
  tools?: ReactNode;
}) {
  const uid = useId().replace(/:/g, "");
  const [box, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; key: string | null; x: number; y: number } | null>(null);
  const largest = useMemo(() => [...layers].sort((a, b) => b.values.reduce((s, v) => s + v, 0) - a.values.reduce((s, v) => s + v, 0))[0]?.key ?? null, [layers]);
  const [own, setOwn] = useState<string | null>(null);
  const selected = given !== undefined ? given : own && layers.some((l) => l.key === own) ? own : largest;
  const select = (k: string) => (onSelect ? onSelect(k) : setOwn(k));
  // The selected name's tab is always in view (the row scrolls sideways).
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = tabs.current;
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row && on) row.scrollTo({ left: Math.max(0, on.offsetLeft - row.offsetLeft - 24), behavior: "smooth" });
  }, [selected]);
  const n = buckets.length;
  const w = Math.max(0, size.w - M.left - M.right);
  const h = Math.max(0, size.h - M.top - M.bottom);

  // The others in order, the selected one last (on top), each others' grey by its place.
  const ordered = useMemo(() => {
    const rest = layers.filter((l) => l.key !== selected);
    const sel = layers.find((l) => l.key === selected);
    return [...rest.map((l, i) => ({ ...l, colour: greyOf(i) })), ...(sel ? [{ ...sel, colour: ACCENT }] : [])];
  }, [layers, selected]);
  const { stacks, max } = useMemo(() => {
    const cum = new Array<number>(n).fill(0);
    const stacks = ordered.map((l) => {
      const lo = [...cum];
      l.values.forEach((v, i) => (cum[i] = (cum[i] ?? 0) + v));
      return { layer: l, lo, hi: [...cum] };
    });
    return { stacks, max: Math.max(0, ...cum) };
  }, [ordered, n]);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => h - (v / top) * h;
  // Smooth lines from point to point (monotone, so never above a peak or below zero).
  const line = (vals: number[]) => vals.map((v, i) => [x(i), y(v)] as [number, number]);
  const area = (lo: number[], hi: number[]) => {
    if (n === 1) return `M0,${y(hi[0]!)}H${w}V${y(lo[0]!)}H0Z`;
    const up = line(hi);
    const down = line(lo).reverse();
    return `M${up[0]![0]},${up[0]![1]}${smoothSegments(up)}L${down[0]![0]},${down[0]![1]}${smoothSegments(down)}Z`;
  };
  const edge = (hi: number[]) => {
    if (n === 1) return `M0,${y(hi[0]!)}H${w}`;
    const up = line(hi);
    return `M${up[0]![0]},${up[0]![1]}${smoothSegments(up)}`;
  };

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - M.left;
    const py = e.clientY - r.top - M.top;
    const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px / Math.max(1, w)) * (n - 1))));
    const v = ((h - py) / Math.max(1, h)) * top;
    const hit = stacks.find((s) => (s.layer.values[i] ?? 0) > 0 && v >= (s.lo[i] ?? 0) && v <= (s.hi[i] ?? 0));
    setHover({ i, key: hit?.layer.key ?? null, x: e.clientX, y: e.clientY });
  };
  const empty = max === 0;
  const xt = xTicks(buckets, w);
  const mi = marker ? buckets.findIndex((b) => b.at >= marker.at) : -1;

  return (
    <div className="dd-area" data-testid={testId}>
      <div className="dd-tabs-row">
        <div className="dd-tabs" role="group" aria-label={`${label}: highlight`} ref={tabs}>
          {layers.map((l) => (
            <button key={l.key} type="button" className="dd-tab" aria-pressed={l.key === selected} onClick={() => select(l.key)} data-testid="dd-tab">
              {l.key}
            </button>
          ))}
        </div>
        {tools}
      </div>
      <div className="dd-area-plot" ref={box}>
        {size.w > 0 && size.h > 0 && (
          <svg
            width={size.w}
            height={size.h}
            role="img"
            aria-label={`${label}: Activity over time${selected ? `, ${selected} highlighted` : ""}${empty ? " (no signals in this time frame)" : ""}`}
            onPointerMove={pick}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover?.key && select(hover.key)}
            style={{ cursor: hover?.key ? "pointer" : "default" }}
          >
            <g transform={`translate(${M.left},${M.top})`}>
              {ticks.map((t) => (
                <g key={t} className="dd-grid">
                  <text x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                    {fmt(t)}
                  </text>
                </g>
              ))}
              <text className="dd-axis-title" transform={`translate(${-30},${h / 2}) rotate(-90)`} textAnchor="middle">
                Activity
              </text>
              {xt.map((t) => (
                <text key={t.i} className="dd-xtick" x={x(t.i)} y={h + 16} textAnchor={t.i === 0 && n > 1 ? "start" : "middle"}>
                  {t.label}
                </text>
              ))}
              <clipPath id={`${uid}-c`}>
                <rect x={0} y={-2} width={w} height={h + 2} />
              </clipPath>
              <g clipPath={`url(#${uid}-c)`}>
                {stacks.map(({ layer, lo, hi }) => (
                  <path key={layer.key} d={area(lo, hi)} fill={layer.colour} data-layer={layer.key} data-selected={layer.key === selected || undefined} className="dd-layer" />
                ))}
                {/* White seams between neighbouring layers. */}
                {stacks.map(({ layer, hi }) => (
                  <path key={`e-${layer.key}`} d={edge(hi)} fill="none" stroke="#fff" strokeWidth="1.25" pointerEvents="none" />
                ))}
              </g>
              {mi > 0 && (
                <g className="dd-marker" data-testid="dd-marker">
                  <line x1={x(mi)} x2={x(mi)} y1={-14} y2={h} />
                  <text x={x(mi) + 5} y={-6}>
                    {marker!.label} →
                  </text>
                </g>
              )}
              {hover && !empty && <line className="dd-cross" x1={x(hover.i)} x2={x(hover.i)} y1={0} y2={h} />}
              {empty && (
                <text x={w / 2} y={h / 2} textAnchor="middle" className="dd-empty-text">
                  No signals in this time frame
                </text>
              )}
            </g>
          </svg>
        )}
      </div>
      <Tip at={hover && !empty ? hover : null}>
        {hover && (
          <>
            <b className="dd-tip-title">{buckets[hover.i]?.label}</b>
            <ul className="dd-tip-list">
              {[...stacks]
                .reverse()
                .filter((s) => (s.layer.values[hover.i] ?? 0) > 0)
                .map((s) => (
                  <li key={s.layer.key} className={s.layer.key === hover.key ? "on" : undefined}>
                    <span className="dd-swatch" style={{ background: s.layer.colour }} />
                    <span>{s.layer.key}</span>
                    <b>{fmt(s.layer.values[hover.i] ?? 0)}</b>
                  </li>
                ))}
            </ul>
            <span className="dd-tip-foot">
              Total Activity {fmt(stacks[stacks.length - 1]?.hi[hover.i] ?? 0)}
              {hover.key && hover.key !== selected ? ` · press to highlight ${hover.key}` : ""}
            </span>
          </>
        )}
      </Tip>
      <table className="sr-only">
        <caption>{label}: Activity by month</caption>
        <thead>
          <tr>
            <th scope="col">Month to</th>
            {layers.map((l) => (
              <th key={l.key} scope="col">
                {l.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr key={b.at}>
              <th scope="row">{b.at}</th>
              {layers.map((l) => (
                <td key={l.key}>{fmt(l.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
