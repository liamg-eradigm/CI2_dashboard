import { useMemo, useState } from "react";
import { CORE, bucket, daysBetween, getColumn, levelOf, monthLabel, type Bar, type DashboardData, type TrackerSchema } from "@eradigm/shared";
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

export function SignalTimeline({ data, schema, from, to, onOpen }: { data: DashboardData; schema: TrackerSchema; from: string; to: string; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const gCol = getColumn(schema, CORE.growth);
  const iCol = getColumn(schema, CORE.impact);
  const levels = gCol?.options ?? [];
  const gn = levels.length;
  const yOf = (i: number) => (gn > 1 ? 86 - Math.max(0, i) * (72 / (gn - 1)) : 50);
  const span = Math.max(1, daysBetween(from, to));

  const points = useMemo(
    () =>
      data.timeline
        .map((s) => {
          const n = Number.parseInt(s.code.replace(/\D/g, ""), 10) || 0;
          const gi = levelOf(gCol, s.growth);
          const ii = levelOf(iCol, s.impact);
          const cls = ii < 0 ? "none" : IMPACT_CLASS[bucket(ii, iCol?.options?.length ?? 3)];
          const xn = Math.max(1, Math.min(99, (daysBetween(from, s.date) / span) * 100));
          const yn = yOf(gi) + (((n * 37) % 17) - 8) * 0.9; // deterministic jitter
          return { ...s, gi, cls, xn, yn, size: ii };
        })
        .sort((a, b) => a.size - b.size),
    [data.timeline, from, span], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const ticks = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    const a = new Date(`${from}T00:00:00Z`);
    let y = a.getUTCFullYear();
    let m = a.getUTCMonth();
    if (a.getUTCDate() > 1) m++;
    for (let i = 0; i < 60; i++) {
      if (m > 11) {
        m = 0;
        y++;
      }
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      if (iso > to) break;
      out.push({ x: (daysBetween(from, iso) / span) * 100, label: monthLabel(m) + (m === 0 ? ` ${String(y).slice(2)}` : "") });
      m++;
    }
    return out.length > 14 ? out.filter((_, i) => i % 2 === 0) : out;
  }, [from, to, span]);

  const hp = points.find((p) => p.id === hover);
  const gLabel = gCol?.label ?? "Growth intensity";
  const iLabel = iCol?.label ?? "Impact";

  return (
    <section className="card" aria-labelledby="tl-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="tl-title">
            Signal Timeline
          </h2>
          <span className="card-sub">{gLabel} by publication date · select a point to open its record</span>
        </div>
        <ImpactLegend schema={schema} label={iLabel} />
      </div>
      <div className="timeline">
        <div className="tl-y" aria-hidden="true">
          {levels.map((l, i) => (
            <span key={l} style={{ top: `${yOf(i)}%` }}>
              {l} <b>{i}</b>
            </span>
          ))}
        </div>
        <div className="tl-plot" role="group" aria-label={`${points.length} signals plotted by date and ${gLabel.toLowerCase()}. Use Tab to move between points and Enter to open one.`}>
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
              onClick={() => onOpen(p.id)}
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
          {!points.length && <div className="empty" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>No approved signals match these filters.</div>}
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
      {data.timelineTruncated && <div className="foot-note">Showing the most recent {data.timeline.length} signals. Narrow the filters to see all points.</div>}
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
}) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  const id = title.replace(/\W+/g, "-").toLowerCase();
  const opts = getColumn(schema, CORE.impact)?.options ?? ["Low", "Medium", "High"];
  const hi = opts[opts.length - 1] ?? "High";
  const lo = opts[0] ?? "Low";
  return (
    <section className={`card ${full ? "full-row" : ""}`} aria-labelledby={id}>
      <div className="card-head">
        <div>
          <h2 className="card-title" id={id}>
            {title}
          </h2>
          <span className="card-sub">{sub}</span>
        </div>
        {mix && <MixLegend schema={schema} />}
      </div>
      <ul className={`bars ${variant ?? ""}`} aria-label={`${title}: count per category`}>
        {bars.map((b) => (
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
      {!bars.length && <div className="empty">No categories configured.</div>}
      {footer && <div className="foot-note">{footer}</div>}
    </section>
  );
}
