/**
 * Epilepsy → NSO Comparator (request 68; NSO: non-seizure outcomes). One
 * button per company (as Competitor Profiles); each one picked opens its NSO
 * card: NSO Focus, NSO Activity, Core Messaging, Channels Used, Imagery and
 * Marketing, and a chart of its data metric. Several picked sit side by side,
 * each chart on its own axis (the metrics differ by design). Each row of a
 * card has its own colour: the icon strong, the row a light shade of it.
 */
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { abbreviate, type Me } from "@eradigm/shared";
import { useEpilepsyData } from "../api/hooks";
import { MetricBars } from "../components/Charts";
import { PageHead } from "../components/PageHead";
import { colourMap } from "../model";
import { nsoOf, type NsoProfile } from "../nso";
import { profileCompanies } from "../profiles";

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

/** Each row: its field, its colour, and its icon. */
const ROWS = [
  {
    field: "NSO Focus",
    colour: "#2a78d6",
    icon: icon(
      <>
        <circle cx="10" cy="10" r="7" />
        <circle cx="10" cy="10" r="3.6" />
        <circle cx="10" cy="10" r="0.8" fill="currentColor" />
      </>,
    ),
  },
  { field: "NSO Activity", colour: "#14996b", icon: icon(<path d="M2.5 10.5h3l2-5 3.5 9 2-4.5h4.5" />) },
  { field: "Core Messaging", colour: "#e0602a", icon: icon(<path d="M3.5 4.5h13v8.5h-7l-4 3v-3h-2Z M6.5 8h7 M6.5 10.5h4.5" />) },
  { field: "Channels Used", colour: "#5b4bc4", icon: icon(<path d="M3.5 8v4h2.5l6 3.5v-11L6 8Z M14.5 7.5a3.5 3.5 0 0 1 0 5 M16.5 5.5a6.5 6.5 0 0 1 0 9" />) },
  {
    field: "Imagery and Marketing",
    colour: "#cc3f86",
    icon: icon(
      <>
        <rect x="3" y="4" width="14" height="12" rx="2" />
        <circle cx="7.5" cy="8.5" r="1.5" />
        <path d="m4 15 4.5-4.5 3 3 2-2 3.5 3.5" />
      </>,
    ),
  },
] as const;
const CHART = { colour: "#b57b00", icon: icon(<path d="M3.5 16.5h13 M5.5 16.5v-5 M9 16.5v-9 M12.5 16.5v-6.5 M16 16.5V5" />) };

/** The metric's ticks: as a percentage when its values are written so, else abbreviated (“1 bn”). */
const formatOf = (p: NsoProfile) => (p.bars.length && p.bars.every((b) => /%\s*$/.test(b.raw)) ? (n: number) => `${abbreviate(n)}%` : abbreviate);

function NsoRow({ colour, icon, label, children }: { colour: string; icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="nso-row" style={{ ["--row" as string]: colour }}>
      <span className="nso-icon">{icon}</span>
      <div className="nso-row-body">
        <span className="nso-label">{label}</span>
        {children}
      </div>
    </div>
  );
}

function NsoCard({ company, colour, profiles, onClose }: { company: string; colour: string; profiles: NsoProfile[]; onClose: () => void }) {
  const [at, setAt] = useState(0);
  const p = profiles[Math.min(at, profiles.length - 1)];
  const titleId = `nso-${company.replace(/\W+/g, "-")}`;
  return (
    <article className="card nso-card" style={{ ["--c" as string]: colour }} aria-labelledby={titleId} data-testid="nso-card">
      <header className="nso-card-head">
        <div>
          <span className="eyebrow">Non-seizure outcomes</span>
          <h2 className="epi-company-name" id={titleId}>
            {company}
          </h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={`Close ${company}`} title="Close">
          ✕
        </button>
      </header>
      {profiles.length > 1 && (
        <div className="seg nso-assets" role="group" aria-label={`${company}: asset`}>
          {profiles.map((x, i) => (
            <button key={i} aria-pressed={i === at} onClick={() => setAt(i)}>
              {x.assets.join(", ") || company}
            </button>
          ))}
        </div>
      )}
      {profiles.length === 1 && p!.assets.length > 0 && <div className="nso-asset-note">{p!.assets.join(", ")}</div>}
      {!p ? (
        <div className="empty">No NSO data for {company} in “3. Platform Competitor Profiles” yet.</div>
      ) : (
        <div className="nso-rows">
          {ROWS.map((r) => (
            <NsoRow key={r.field} colour={r.colour} icon={r.icon} label={r.field}>
              <p className={`nso-text${p.text[r.field] ? "" : " none"}`}>{p.text[r.field] || "Not given"}</p>
            </NsoRow>
          ))}
          <NsoRow colour={CHART.colour} icon={CHART.icon} label={p.metric || "Data metric"}>
            {p.bars.length ? (
              <MetricBars bars={p.bars} metric={p.metric} colour={CHART.colour} label={`${company}: ${p.metric || "data metric"}`} format={formatOf(p)} />
            ) : (
              <p className="nso-text none">No values given (x1 to x6).</p>
            )}
          </NsoRow>
        </div>
      )}
    </article>
  );
}

export function NsoPage({ me }: { me: Me }) {
  const data = useEpilepsyData();
  const [params, setParams] = useSearchParams();
  const all = profileCompanies(data.data);
  const colour = colourMap(data.data);
  const picked = (params.get("c") ?? "").split("|").filter((c) => all.includes(c));
  const set = (next: string[]) => {
    const p = new URLSearchParams(params);
    if (next.length) p.set("c", next.join("|"));
    else p.delete("c");
    setParams(p, { replace: true });
  };
  const toggle = (c: string) => set(picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c]);

  return (
    <>
      <PageHead me={me} title="NSO Comparator" intro="Non-seizure outcomes: pick a company, or several to see them side by side. From “3. Platform Competitor Profiles”." />
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
        {picked.length > 0 ? (
          <div className="nso-cards" data-testid="nso-cards">
            {picked.map((c) => (
              <NsoCard key={c} company={c} colour={colour(c)} profiles={nsoOf(data.data, c)} onClose={() => set(picked.filter((x) => x !== c))} />
            ))}
          </div>
        ) : (
          all.length > 0 && <div className="empty nso-hint">Pick a company above to see its non-seizure outcomes.</div>
        )}
      </div>
    </>
  );
}
