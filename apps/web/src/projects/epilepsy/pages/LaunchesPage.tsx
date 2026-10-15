/**
 * Epilepsy → Asset Launches (request 61): each asset's approval on a time
 * line (sheet “4. Platform Trials & Assets”). The FDA approval date when there
 * is one (green, filled: confirmed); else the calculated approval date
 * (orange, hollow: expected). Filters for competitor and MoA.
 */
import { useMemo, useState } from "react";
import { normaliseHeader, type Me } from "@eradigm/shared";
import { useEpilepsyData } from "../api/hooks";
import { useTip } from "../components/Charts";
import { Filters, distinct } from "../components/Filters";
import { PageHead } from "../components/PageHead";
import { looseDate, records } from "../model";

type Launch = { company: string; asset: string; moa: string; roa: string; t: number; label: string; confirmed: boolean };

const ROW = 30;
const L = 210;
const R = 36;
const TOP = 34;

export function LaunchesPage({ me }: { me: Me }) {
  const data = useEpilepsyData();
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const tip = useTip();
  const all = useMemo(() => {
    const by = new Map<string, Launch>();
    for (const r of records(data.data?.sheets.assets)) {
      const asset = r.get("Asset Name");
      if (!asset) continue;
      const fda = looseDate(r.get("FDA Approval Date"));
      const calc = fda ? null : looseDate(r.get("Approval Date (calculated)"));
      const d = fda ?? calc;
      if (!d) continue;
      const company = r.get("Company/competitor");
      const k = `${normaliseHeader(company)}|${normaliseHeader(asset)}`;
      const have = by.get(k);
      // An asset's confirmed date wins over a calculated one (its trials may be on several rows).
      if (have && (have.confirmed || !fda)) continue;
      by.set(k, { company, asset, moa: r.get("MoA"), roa: r.get("RoA") || r.get("RoA (+frequency)"), t: d.t, label: d.label, confirmed: !!fda });
    }
    return [...by.values()].sort((a, b) => a.t - b.t || a.asset.localeCompare(b.asset));
  }, [data.data]);
  const shown = all.filter((l) => (!picked.Competitor?.length || picked.Competitor.includes(l.company)) && (!picked.MoA?.length || picked.MoA.includes(l.moa)));
  const now = Date.now();
  const t0 = Math.min(now, ...shown.map((l) => l.t));
  const t1 = Math.max(now, ...shown.map((l) => l.t));
  const y0 = new Date(t0).getUTCFullYear();
  const y1 = new Date(t1).getUTCFullYear() + 1;
  const start = Date.UTC(y0, 0, 1);
  const end = Date.UTC(y1, 0, 1);
  const W = 1000;
  const H = TOP + shown.length * ROW + 16;
  const x = (t: number) => L + ((t - start) / (end - start)) * (W - L - R);
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  const confirmed = shown.filter((l) => l.confirmed).length;

  return (
    <>
      <PageHead me={me} title="Asset Launches" intro="When each epilepsy asset was approved, or is expected to be. From “4. Platform Trials & Assets”." />
      <div className="content">
        <Filters
          choices={[
            { name: "Competitor", options: distinct(all.map((l) => l.company)), value: picked.Competitor ?? [] },
            { name: "MoA", options: distinct(all.map((l) => l.moa)), value: picked.MoA ?? [] },
          ]}
          onChoice={(name, v) => setPicked((p) => ({ ...p, [name]: v }))}
          onClear={() => setPicked({})}
        />
        <section className="card" aria-labelledby="launch-title">
          <div className="card-head">
            <div>
              <h2 className="card-title" id="launch-title">
                Approval dates
              </h2>
              <span className="card-sub">
                {shown.length} {shown.length === 1 ? "asset" : "assets"} · {confirmed} confirmed (FDA approval date), {shown.length - confirmed} calculated
              </span>
            </div>
            <ul className="epi-legend" aria-label="Legend">
              <li>
                <svg width="14" height="14" aria-hidden="true">
                  <circle cx="7" cy="7" r="5.5" fill="var(--epi-confirmed)" />
                </svg>
                FDA approval date (confirmed)
              </li>
              <li>
                <svg width="14" height="14" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" fill="#fff" stroke="var(--epi-calculated)" strokeWidth="2.5" />
                </svg>
                Approval date (calculated)
              </li>
            </ul>
          </div>
          {shown.length ? (
            <div className="epi-chart epi-launches" onPointerLeave={tip.hide} data-testid="launch-plot">
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Approval dates of ${shown.length} assets`} style={{ minWidth: 720 }}>
                {years.map((yy) => (
                  <g key={yy}>
                    <line x1={x(Date.UTC(yy, 0, 1))} x2={x(Date.UTC(yy, 0, 1))} y1={TOP - 8} y2={H - 8} className="epi-grid" />
                    {yy < y1 && (
                      <text x={x(Date.UTC(yy, 6, 1))} y={TOP - 14} textAnchor="middle" className="epi-axis">
                        {yy}
                      </text>
                    )}
                  </g>
                ))}
                <line x1={x(now)} x2={x(now)} y1={TOP - 8} y2={H - 8} className="epi-today" />
                <text x={x(now) + 4} y={H - 10} className="epi-axis">
                  Today
                </text>
                {shown.map((l, i) => {
                  const cy = TOP + i * ROW + ROW / 2;
                  const cx = x(l.t);
                  const body = (
                    <>
                      <b>{l.asset}</b> · {l.company}
                      <br />
                      {l.confirmed ? "FDA approval" : "Calculated approval"}: {l.label}
                      {l.moa && (
                        <>
                          <br />
                          MoA: {l.moa}
                        </>
                      )}
                      {l.roa && (
                        <>
                          <br />
                          RoA: {l.roa}
                        </>
                      )}
                    </>
                  );
                  return (
                    <g key={`${l.company}|${l.asset}`} data-testid="launch-point" data-confirmed={l.confirmed}>
                      <text x={L - 12} y={cy + 4} textAnchor="end" className="epi-launch-name">
                        {l.asset.length > 28 ? `${l.asset.slice(0, 27)}…` : l.asset}
                      </text>
                      <line x1={L} x2={W - R} y1={cy} y2={cy} className="epi-row-rule" />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={l.confirmed ? 7 : 6}
                        className={l.confirmed ? "epi-dot confirmed" : "epi-dot calculated"}
                        role="img"
                        tabIndex={0}
                        aria-label={`${l.asset} (${l.company}): ${l.confirmed ? "FDA approval" : "calculated approval"} ${l.label}`}
                        onPointerMove={(e) => tip.show(e, body)}
                        onFocus={(e) => tip.show(e, body)}
                        onBlur={tip.hide}
                      />
                      {/* The date beside its dot (on the left near the right edge, so it is never cut off). */}
                      <text x={cx > W - R - 110 ? cx - 12 : cx + 12} y={cy + 4} textAnchor={cx > W - R - 110 ? "end" : "start"} className="epi-val">
                        {l.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {tip.view}
            </div>
          ) : (
            <div className="empty">{data.isLoading ? "Loading…" : all.length ? "No assets with these filters." : "No approval dates yet: the workbook's Trials & Assets sheet has not been read."}</div>
          )}
        </section>
      </div>
    </>
  );
}
