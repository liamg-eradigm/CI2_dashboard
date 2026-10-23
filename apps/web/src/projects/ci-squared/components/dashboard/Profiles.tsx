/**
 * Request 70: Macrotrend Profile and Competitor Profile, one beside the other
 * with the same build: the top five by signals as icons, a sixth to search for
 * any other; the name with its change in Activity over the last month; its
 * analysis; two focus bars (shares of its signals); and at the bottom the
 * Macrotrend's full analysis (a link) or the competitor's Company Profile.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Combobox } from "../../../../components/Combobox";
import { RichText } from "../../../../components/BulletText";
import { plural } from "../megatrends/model";
import { changeText, focusSplit, type Segment } from "./model";
import type { activityChange } from "./model";
import { Tip, useDismiss } from "./ui";

export type PickItem = { name: string; icon: ReactNode };

/** The five icons and the search. */
function Picker({ kind, top, all, value, onChange, iconOf }: { kind: string; top: PickItem[]; all: string[]; value: string; onChange: (v: string) => void; iconOf: (name: string) => ReactNode }) {
  const [search, setSearch] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setSearch(false), []);
  useDismiss(box, search, close);
  const inTop = top.some((t) => t.name === value);
  return (
    <div className="dd-picker" role="group" aria-label={`Choose a ${kind}`}>
      {top.map((t) => (
        <button key={t.name} type="button" className="dd-pick" aria-pressed={t.name === value} onClick={() => onChange(t.name)} title={t.name} aria-label={t.name}>
          {t.icon}
        </button>
      ))}
      <div className="dd-search" ref={box}>
        <button type="button" className="dd-pick dd-find" aria-pressed={!inTop} aria-expanded={search} onClick={() => setSearch((s) => !s)} title={`Search every ${kind}`} aria-label={`Search every ${kind}${inTop ? "" : ` (showing ${value})`}`}>
          {inTop ? (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            iconOf(value)
          )}
        </button>
        {search && (
          <div className="dd-search-pop">
            <Combobox
              options={all}
              value=""
              label={`Search for a ${kind}`}
              placeholder={`Search ${all.length} ${kind === "competitor" ? "competitors" : "Macrotrends"}…`}
              onChange={(v) => {
                if (v) onChange(v);
                setSearch(false);
              }}
              testId={`dd-search-${kind}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Change({ c }: { c: ReturnType<typeof activityChange> }) {
  const cls = c.isNew || (c.pct ?? 0) > 0 ? "up" : (c.pct ?? 0) < 0 ? "down" : "flat";
  return (
    <span className={`dd-change ${cls}`} title={`Activity over the last 30 days (${c.now}) against the 30 days before (${c.before})`} data-testid="dd-change">
      {cls === "up" ? "▲ " : cls === "down" ? "▼ " : ""}
      {changeText(c)}
      <span className="sr-only"> Activity over the last month</span>
    </span>
  );
}

/** A share of signals as one straight bar, with its key below. */
export function FocusBar({ label, counts, colourOf, empty, testId }: { label: string; counts: [string, number][]; colourOf: (name: string, i: number) => { colour: string; hatch?: boolean }; empty: string; testId?: string }) {
  const segs = focusSplit(counts);
  const [tip, setTip] = useState<{ x: number; y: number; s: Segment } | null>(null);
  const total = segs.reduce((s, x) => s + x.n, 0);
  const desc = segs.map((s) => `${s.name} ${Math.round(s.pct)}%`).join(", ");
  return (
    <div className="dd-focus" data-testid={testId}>
      <span className="dd-focus-label">
        {label}
        {total > 0 && <span className="dd-focus-n"> · {plural(total, "signal")}</span>}
      </span>
      {segs.length ? (
        <>
          <div className="dd-focus-bar" role="img" aria-label={`${label}: ${desc}`}>
            {segs.map((s, i) => {
              const c = s.name === "Other" && s.others ? { colour: "#8b9aa6" } : colourOf(s.name, i);
              return (
                <span
                  key={s.name}
                  className={`dd-seg${c.hatch ? " hatch" : ""}`}
                  style={{ flexGrow: s.pct, background: c.colour }}
                  onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, s })}
                  onPointerLeave={() => setTip(null)}
                />
              );
            })}
          </div>
          <ul className="dd-focus-key">
            {segs.map((s, i) => {
              const c = s.name === "Other" && s.others ? { colour: "#8b9aa6" } : colourOf(s.name, i);
              return (
                <li key={s.name} title={s.others ? `Other: ${s.others.join(", ")}` : s.name}>
                  <span className={`dd-swatch${c.hatch ? " hatch" : ""}`} style={{ background: c.colour }} />
                  <span className="dd-key-name">{s.name}</span> <b>{Math.round(s.pct)}%</b>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="dd-focus-empty">{empty}</p>
      )}
      <Tip at={tip}>
        {tip && (
          <>
            <b className="dd-tip-title">{tip.s.name}</b>
            <span className="dd-tip-foot">
              {plural(tip.s.n, "signal")} · {Math.round(tip.s.pct)}%
            </span>
            {tip.s.others && <span className="dd-tip-foot">{tip.s.others.join(", ")}</span>}
          </>
        )}
      </Tip>
    </div>
  );
}

export function ProfileCard({
  kind,
  title,
  top,
  all,
  value,
  onChange,
  iconOf,
  change,
  badge,
  analysis,
  bars,
  bottom,
  testId,
  side,
}: {
  side: "left" | "right";
  kind: "Macrotrend" | "competitor";
  title: string;
  top: PickItem[];
  all: string[];
  value: string;
  onChange: (v: string) => void;
  iconOf: (name: string) => ReactNode;
  change: ReturnType<typeof activityChange>;
  badge?: ReactNode;
  analysis: ReactNode;
  bars: ReactNode;
  bottom: ReactNode;
  testId: string;
}) {
  return (
    <section className={`card dd-card dd-profile ${side}`} aria-label={title} data-testid={testId}>
      <header className="dd-card-head">
        <h3>{title}</h3>
        <Picker kind={kind} top={top} all={all} value={value} onChange={onChange} iconOf={iconOf} />
      </header>
      <div className="dd-profile-name">
        <b data-testid={`${testId}-name`}>{value}</b>
        {badge}
        <Change c={change} />
      </div>
      {/* Scrolls when long: focusable, so it scrolls with the keyboard too. */}
      <div className="dd-analysis" tabIndex={0} role="region" aria-label={`Analysis of ${value}`}>
        {analysis}
      </div>
      <div className="dd-bars">{bars}</div>
      <div className="dd-bottom">{bottom}</div>
    </section>
  );
}

/** The analysis text, or a note when there is none yet. */
export function Analysis({ text, empty, clamp = false, testId }: { text: string | null | undefined; empty: string; clamp?: boolean; testId?: string }) {
  return text?.trim() ? <RichText className={`dd-analysis-text${clamp ? " clamp" : ""}`} text={text} testId={testId} /> : <p className="dd-muted">{empty}</p>;
}

export function MacroAnalysisLink({ name }: { name: string }) {
  return (
    <Link className="dd-open" to={`/analytics/megatrends?${new URLSearchParams({ m: name })}`} data-testid="dd-macro-open">
      <b>Macrotrend Analysis</b>
      <span>The full analysis of {name}: its signals over time, impact by competitor and each section of the analysis</span>
    </Link>
  );
}
