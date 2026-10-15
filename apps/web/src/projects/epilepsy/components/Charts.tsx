/**
 * The Epilepsy pages' charts (request 61), drawn as SVG: a donut of market
 * caps, revenue by quarter (grouped by company), the asset launch timeline
 * and the data viewer's line. Each company keeps its colour (Admin), every
 * series has a legend, values are labelled, and every mark has a tooltip.
 */
import { useState, type ReactNode } from "react";

type Tip = { x: number; y: number; body: ReactNode } | null;

/** A tooltip that follows the pointer within its chart. */
export function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: React.PointerEvent | React.FocusEvent, body: ReactNode) => {
    const box = (e.currentTarget as Element).closest(".epi-chart")?.getBoundingClientRect();
    const r = (e as React.PointerEvent).clientX != null ? { x: (e as React.PointerEvent).clientX, y: (e as React.PointerEvent).clientY } : (() => {
      const b = (e.currentTarget as Element).getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top };
    })();
    setTip({ x: r.x - (box?.left ?? 0), y: r.y - (box?.top ?? 0), body });
  };
  const view = tip ? (
    <div className="epi-tip" role="status" style={{ left: tip.x, top: tip.y }}>
      {tip.body}
    </div>
  ) : null;
  return { show, hide: () => setTip(null), view };
}

export function Legend({ items }: { items: { name: string; colour: string; note?: string }[] }) {
  return (
    <ul className="epi-legend" aria-label="Legend">
      {items.map((i) => (
        <li key={i.name}>
          <span className="epi-swatch" style={{ background: i.colour }} aria-hidden="true" />
          {i.name}
          {i.note && <span className="epi-legend-note"> {i.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A donut: each slice a company's share (one company: the whole ring, its value in the middle). */
export function Donut({ slices, format, centre }: { slices: { name: string; value: number; colour: string }[]; format: (n: number) => string; centre: string }) {
  const tip = useTip();
  const total = slices.reduce((n, s) => n + s.value, 0);
  const R = 92;
  const r = 58;
  const C = 110;
  let a0 = -Math.PI / 2;
  const arc = (a: number, b: number) => {
    const large = b - a > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) => `${C + rad * Math.cos(ang)} ${C + rad * Math.sin(ang)}`;
    return `M ${p(a, R)} A ${R} ${R} 0 ${large} 1 ${p(b, R)} L ${p(b, r)} A ${r} ${r} 0 ${large} 0 ${p(a, r)} Z`;
  };
  return (
    <div className="epi-chart epi-donut" onPointerLeave={tip.hide}>
      <svg viewBox="0 0 220 220" role="img" aria-label={`${centre}: ${slices.map((s) => `${s.name} ${format(s.value)}`).join(", ")}`}>
        {slices.length === 1 && <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke={slices[0]!.colour} strokeWidth={R - r} />}
        {slices.length > 1 &&
          slices.map((s) => {
            const a = a0;
            const b = a0 + (s.value / total) * Math.PI * 2;
            a0 = b;
            // A 2px surface gap between slices.
            return (
              <path
                key={s.name}
                d={arc(a, b)}
                fill={s.colour}
                stroke="#fff"
                strokeWidth={2}
                tabIndex={0}
                onPointerMove={(e) => tip.show(e, <><b>{s.name}</b><br />{format(s.value)} · {Math.round((s.value / total) * 100)}%</>)}
                onFocus={(e) => tip.show(e, <><b>{s.name}</b><br />{format(s.value)} · {Math.round((s.value / total) * 100)}%</>)}
                onBlur={tip.hide}
              />
            );
          })}
        <text x={C} y={C - 4} textAnchor="middle" className="epi-donut-v">
          {format(total)}
        </text>
        <text x={C} y={C + 16} textAnchor="middle" className="epi-donut-l">
          {centre}
        </text>
      </svg>
      {tip.view}
    </div>
  );
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};

/** Bars per category (quarters), grouped by series (companies). */
export function GroupedBars({ categories, series, format, tipNote, label }: { categories: string[]; series: { name: string; colour: string; values: (number | null)[]; notes?: (string | null)[] }[]; format: (n: number) => string; tipNote?: string; label: string }) {
  const tip = useTip();
  const W = 560;
  const H = 260;
  const L = 64;
  const B = 28;
  const T = 18;
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const min = Math.min(0, ...vals);
  const max = niceMax(Math.max(0, ...vals));
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const band = (W - L - 10) / categories.length;
  const inner = band * 0.72;
  const bw = Math.max(4, inner / Math.max(1, series.length) - 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  return (
    <div className="epi-chart epi-bars" onPointerLeave={tip.hide}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 6} y1={y(t)} y2={y(t)} className="epi-grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="epi-axis">
              {format(t)}
            </text>
          </g>
        ))}
        {categories.map((c, ci) => {
          const x0 = L + band * ci + (band - inner) / 2;
          return (
            <g key={c}>
              <text x={L + band * ci + band / 2} y={H - 8} textAnchor="middle" className="epi-axis">
                {c}
              </text>
              {series.map((s, si) => {
                const v = s.values[ci];
                if (v == null) return null;
                const x = x0 + si * (bw + 2);
                const top = Math.min(y(v), y(0));
                const h = Math.max(1, Math.abs(y(v) - y(0)));
                const body = (
                  <>
                    <b>{s.name}</b> · {c}
                    <br />
                    {format(v)}
                    {s.notes?.[ci] ? (
                      <>
                        <br />
                        {tipNote}: {s.notes[ci]}
                      </>
                    ) : null}
                  </>
                );
                return (
                  <g key={s.name}>
                    {/* Rounded at the data end, square at the baseline. */}
                    <path
                      d={v >= 0 ? `M${x},${top + h} V${top + 4} q0,-4 4,-4 H${x + bw - 4} q4,0 4,4 V${top + h} Z` : `M${x},${top} V${top + h - 4} q0,4 4,4 H${x + bw - 4} q4,0 4,-4 V${top} Z`}
                      fill={s.colour}
                      tabIndex={0}
                      onPointerMove={(e) => tip.show(e, body)}
                      onFocus={(e) => tip.show(e, body)}
                      onBlur={tip.hide}
                    />
                    {series.length <= 3 && (
                      <text x={x + bw / 2} y={v >= 0 ? top - 4 : top + h + 12} textAnchor="middle" className="epi-val">
                        {format(v)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
        <line x1={L} x2={W - 6} y1={y(0)} y2={y(0)} className="epi-base" />
      </svg>
      {tip.view}
    </div>
  );
}
