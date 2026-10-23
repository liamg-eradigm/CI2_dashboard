/**
 * Request 70: a stacked area chart of Activity over time (one layer per
 * Macrotrend, Subtrend or competitor). Hovering shows the period's values
 * (crosshair and tooltip); pressing a layer, or its name in the legend,
 * calls onLayer. Colour follows the entity, with its name always beside it.
 */
import { useId, useMemo, useState } from "react";
import { smoothSegments, type Bucket } from "./model";
import { niceTicks, Tip, useSize } from "./ui";

export type Layer = { key: string; values: number[]; colour: string; hatch?: boolean };

const M = { top: 8, right: 10, bottom: 22, left: 46 };
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
  onLayer,
  label,
  testId,
  layerVerb = "Open",
}: {
  layers: Layer[];
  buckets: Bucket[];
  onLayer?: (key: string) => void;
  /** The chart's accessible name. */
  label: string;
  testId?: string;
  layerVerb?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const [box, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; key: string | null; x: number; y: number } | null>(null);
  // A legend name pointed at or focused lights up its layer.
  const [lit, setLit] = useState<string | null>(null);
  const on = hover?.key ?? lit;
  const n = buckets.length;
  const w = Math.max(0, size.w - M.left - M.right);
  const h = Math.max(0, size.h - M.top - M.bottom);

  const { stacks, max } = useMemo(() => {
    const cum = new Array<number>(n).fill(0);
    const stacks = layers.map((l) => {
      const lo = [...cum];
      l.values.forEach((v, i) => (cum[i] = (cum[i] ?? 0) + v));
      return { layer: l, lo, hi: [...cum] };
    });
    return { stacks, max: Math.max(0, ...cum) };
  }, [layers, n]);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => h - (v / top) * h;
  // Request 71: smooth lines from point to point (monotone, so never above a peak or below zero).
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

  return (
    <div className="dd-area" data-testid={testId}>
      <div className="dd-area-plot" ref={box}>
        {size.w > 0 && size.h > 0 && (
          <svg
            width={size.w}
            height={size.h}
            role="img"
            aria-label={`${label}: Activity over time${empty ? " (no signals in this time frame)" : ""}`}
            onPointerMove={pick}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover?.key && onLayer?.(hover.key)}
            style={{ cursor: hover?.key && onLayer ? "pointer" : "default" }}
          >
            <defs>
              {layers
                .filter((l) => l.hatch)
                .map((l) => (
                  <pattern key={l.key} id={`${uid}-h-${layers.indexOf(l)}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill={l.colour} />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#04182a" strokeOpacity="0.6" strokeWidth="2.5" />
                  </pattern>
                ))}
            </defs>
            <g transform={`translate(${M.left},${M.top})`}>
              {ticks.map((t) => (
                <g key={t} className="dd-grid">
                  <line x1={0} x2={w} y1={y(t)} y2={y(t)} />
                  <text x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                    {fmt(t)}
                  </text>
                </g>
              ))}
              <text className="dd-axis-title" transform={`translate(${-36},${h / 2}) rotate(-90)`} textAnchor="middle">
                Activity
              </text>
              {xt.map((t) => (
                <text key={t.i} className="dd-xtick" x={x(t.i)} y={h + 16} textAnchor={t.i === 0 && n > 1 ? "start" : "middle"}>
                  {t.label}
                </text>
              ))}
              {stacks.map(({ layer, lo, hi }, k) => (
                <path
                  key={layer.key}
                  d={area(lo, hi)}
                  fill={layer.hatch ? `url(#${uid}-h-${k})` : layer.colour}
                  fillOpacity={on && on !== layer.key ? 0.3 : 0.88}
                  data-layer={layer.key}
                  className="dd-layer"
                />
              ))}
              {/* A thin line of the surface between neighbouring layers. */}
              {stacks.map(({ layer, hi }) => (
                <path key={`e-${layer.key}`} d={edge(hi)} fill="none" stroke="#04182a" strokeOpacity="0.75" strokeWidth="1.25" pointerEvents="none" />
              ))}
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
      <ul className="dd-legend" aria-label={`${label}: legend`} tabIndex={onLayer ? undefined : 0}>
        {layers.map((l) => {
          const total = l.values.reduce((s, v) => s + v, 0);
          return (
            <li key={l.key}>
              <button
                type="button"
                className={`dd-legend-item${on === l.key ? " on" : ""}`}
                onClick={onLayer ? () => onLayer(l.key) : undefined}
                disabled={!onLayer}
                aria-label={`${l.key}: Activity ${fmt(total)}${onLayer ? `. ${layerVerb}` : ""}`}
                onPointerEnter={() => setLit(l.key)}
                onPointerLeave={() => setLit(null)}
                onFocus={() => setLit(l.key)}
                onBlur={() => setLit(null)}
              >
                <span className={`dd-swatch${l.hatch ? " hatch" : ""}`} style={{ background: l.colour }} aria-hidden="true" />
                <span className="dd-legend-name">{l.key}</span>
              </button>
            </li>
          );
        })}
      </ul>
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
                    <span className={`dd-swatch${s.layer.hatch ? " hatch" : ""}`} style={{ background: s.layer.colour }} />
                    <span>{s.layer.key}</span>
                    <b>{fmt(s.layer.values[hover.i] ?? 0)}</b>
                  </li>
                ))}
            </ul>
            <span className="dd-tip-foot">
              Total Activity {fmt(stacks[stacks.length - 1]?.hi[hover.i] ?? 0)}
              {hover.key && onLayer ? ` · press to open ${hover.key}` : ""}
            </span>
          </>
        )}
      </Tip>
      <table className="sr-only">
        <caption>{label}: Activity by period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {layers.map((l) => (
              <th key={l.key} scope="col">
                {l.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr key={b.start}>
              <th scope="row">{b.label}</th>
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
