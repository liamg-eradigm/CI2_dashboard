/**
 * Epilepsy → Competitor Profiles (request 61): one button per company (pick
 * several to compare); the companies' names with HQ and headcount; market
 * cap (a donut, their shares when several) and 2026 epilepsy revenue by
 * quarter (grouped bars); their epilepsy assets (details from Trials &
 * Assets); and the assets on the market (Current Phase “Approved”).
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { EPI_QUARTERS, epiLabel, type Me } from "@eradigm/shared";
import { useEpilepsyData } from "../api/hooks";
import { Donut, GroupedBars, Legend } from "../components/Charts";
import { PageHead } from "../components/PageHead";
import { colourMap, money } from "../model";
import { assetsOf, isApproved, profileCompanies, profileOf } from "../profiles";

function BuildingIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M4 17V4.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V17M12 8h3a1 1 0 0 1 1 1v8M2.5 17h15M6.5 6.5h3M6.5 9.5h3M6.5 12.5h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="7.5" cy="7" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13.6" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 16c.5-2.7 2.4-4.2 4.7-4.2s4.2 1.5 4.7 4.2M12.4 12.2c2.2-.3 4.1.9 4.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Request 65: money in US dollars (“(USD)” after the name, the amount abbreviated: “1 bn”).
const FIGURES = ["Market Cap", "2025 Total Revenue", "2025 epilepsy revenue", "Total Indication revenue", "Number of Pipeline Assets", "Pod (FFA/STAP)"];

export function ProfilesPage({ me }: { me: Me }) {
  const data = useEpilepsyData();
  const [params, setParams] = useSearchParams();
  const all = useMemo(() => profileCompanies(data.data), [data.data]);
  const colour = useMemo(() => colourMap(data.data), [data.data]);
  const chosen = params.get("c");
  const picked = (chosen == null ? all.slice(0, 1) : chosen.split("|").filter((c) => all.includes(c))).filter(Boolean);
  const toggle = (c: string) => {
    const next = picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c];
    const p = new URLSearchParams(params);
    p.set("c", next.join("|"));
    setParams(p, { replace: true });
  };
  const profiles = picked.map((c) => profileOf(data.data, c));
  const assets = picked.flatMap((c) => assetsOf(data.data, c));
  const onMarket = assets.filter((a) => isApproved(a.phase));
  const caps = profiles.filter((p) => p.marketCap != null && p.marketCap > 0);
  const anyRevenue = profiles.some((p) => p.revenue.some((v) => v != null));

  return (
    <>
      <PageHead me={me} title="Competitor Profiles" intro="Pick one company, or several to compare them side by side. From “3. Platform Competitor Profiles” and “4. Platform Trials & Assets”." />
      <div className="content">
        <div className="epi-companies" role="group" aria-label="Companies (pick one or more)">
          {all.map((c) => {
            const on = picked.includes(c);
            return (
              <button key={c} className={`epi-company${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(c)} style={{ ["--c" as string]: colour(c) }}>
                <span className="epi-swatch" aria-hidden="true" />
                {c}
              </button>
            );
          })}
          {!all.length && <div className="empty">{data.isLoading ? "Loading…" : "No companies yet: the workbook's Competitor Profiles sheet has not been read."}</div>}
        </div>

        {profiles.length > 0 && (
          <>
            <section className="epi-profile-heads" aria-label="Selected companies">
              {profiles.map((p) => (
                <article key={p.name} className="card epi-profile-head" style={{ ["--c" as string]: colour(p.name) }} data-testid="profile-head">
                  <h2 className="epi-company-name">{p.name}</h2>
                  {p.field("Epilepsy Focus") && <div className="epi-focus">{p.field("Epilepsy Focus")}</div>}
                  <div className="epi-facts">
                    <div className="epi-fact">
                      <BuildingIcon />
                      <div>
                        <span className="epi-fact-k">HQ</span>
                        <span className="epi-fact-v">{p.field("HQ") || "—"}</span>
                      </div>
                    </div>
                    <div className="epi-fact">
                      <PeopleIcon />
                      <div>
                        <span className="epi-fact-k">Headcount</span>
                        <span className="epi-fact-v">{p.field("Size") || "—"}</span>
                      </div>
                    </div>
                  </div>
                  <dl className="epi-figures">
                    {FIGURES.map((f) => (
                      <div key={f}>
                        <dt>{epiLabel(f)}</dt>
                        <dd>{p.figure(f) || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  {p.field("Recent Relevant Updates") && (
                    <div className="epi-updates">
                      <span className="epi-fact-k">Recent relevant updates</span>
                      <p>{p.field("Recent Relevant Updates")}</p>
                    </div>
                  )}
                </article>
              ))}
            </section>

            <div className="epi-plots">
              <section className="card" aria-labelledby="cap-title">
                <div>
                  <h2 className="card-title" id="cap-title">
                    Market cap (USD)
                  </h2>
                  <span className="card-sub">{caps.length > 1 ? "Their market caps relative to each other" : "As given in the workbook"}</span>
                </div>
                {caps.length ? (
                  <>
                    <Donut slices={caps.map((p) => ({ name: p.name, value: p.marketCap!, colour: colour(p.name) }))} format={money} centre={caps.length > 1 ? "combined" : "market cap"} />
                    <Legend items={caps.map((p) => ({ name: p.name, colour: colour(p.name), note: money(p.marketCap!) }))} />
                  </>
                ) : (
                  <div className="empty">No market cap given for {picked.length > 1 ? "these companies" : "this company"}.</div>
                )}
                {caps.length > 0 && caps.length < profiles.length && <span className="card-sub">No market cap given for {profiles.filter((p) => !caps.includes(p)).map((p) => p.name).join(", ")}.</span>}
              </section>
              <section className="card" aria-labelledby="rev-title">
                <div>
                  <h2 className="card-title" id="rev-title">
                    Epilepsy revenue by quarter, 2026 (USD)
                  </h2>
                  <span className="card-sub">{profiles.length > 1 ? "Grouped by company" : "Q1 to Q4"} · hover a bar for the quarter's marketed asset growth</span>
                </div>
                {anyRevenue ? (
                  <>
                    <GroupedBars
                      label={`Epilepsy revenue (USD) by quarter in 2026 for ${picked.join(", ")}`}
                      categories={EPI_QUARTERS.map((q) => `${q} 2026`)}
                      series={profiles.map((p) => ({ name: p.name, colour: colour(p.name), values: p.revenue, notes: p.growth }))}
                      format={money}
                      tipNote="Marketed epilepsy asset growth"
                    />
                    {profiles.length > 1 && <Legend items={profiles.map((p) => ({ name: p.name, colour: colour(p.name) }))} />}
                  </>
                ) : (
                  <div className="empty">No 2026 quarterly epilepsy revenue given.</div>
                )}
              </section>
            </div>

            <section className="card flush" aria-labelledby="assets-title">
              <div className="table-top">
                <div className="ptr-head">
                  <h2 className="card-title" id="assets-title">
                    Assets
                  </h2>
                  <span className="card-sub info">
                    {assets.length} epilepsy {assets.length === 1 ? "asset" : "assets"} · MoA, RoA and phase from “4. Platform Trials & Assets”
                  </span>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data epi-table" data-testid="profile-assets">
                  <caption className="sr-only">Epilepsy assets of the selected companies</caption>
                  <thead>
                    <tr>
                      <th scope="col">Competitor</th>
                      <th scope="col">Asset name</th>
                      <th scope="col">MoA</th>
                      <th scope="col">RoA (+ frequency)</th>
                      <th scope="col">Current Phase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={`${a.company}|${a.name}`}>
                        <td>
                          <span className="epi-swatch" style={{ background: colour(a.company) }} aria-hidden="true" /> {a.company}
                        </td>
                        <td className="title">{a.name}</td>
                        <td>{a.moa || "—"}</td>
                        <td>{a.roa || "—"}</td>
                        <td>{a.phase ? <span className={`tag ${isApproved(a.phase) ? "ok" : "info"}`}>{a.phase}</span> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!assets.length && <div className="empty">No epilepsy assets listed.</div>}
              </div>
            </section>

            <section className="card" aria-labelledby="market-title" data-testid="on-market">
              <h2 className="card-title" id="market-title">
                On market
              </h2>
              <p className="epi-on-market">{onMarket.length ? onMarket.map((a) => a.name).join(", ") : "None of these assets is approved yet."}</p>
            </section>
          </>
        )}
        {all.length > 0 && !profiles.length && <div className="empty">Pick a company above.</div>}
      </div>
    </>
  );
}
