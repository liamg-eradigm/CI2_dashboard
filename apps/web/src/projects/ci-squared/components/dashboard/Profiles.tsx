/**
 * Request 70: Macrotrend Profile and Competitor Profile, one beside the other
 * with the same build: the top five by signals as icons, a sixth to search for
 * any other; the name with its change in Activity over the last month; its
 * text (the Macrotrend's analysis, or the competitor's Company Profile); two
 * focus bars (shares of its signals); and a footer (the link to the full
 * Macrotrend analysis, or the competitor's tier and signals). Request 71: a
 * quiet layout, the text taking whatever room the row has.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Combobox } from "../../../../components/Combobox";
import { RichText } from "../../../../components/BulletText";
import { plural } from "../megatrends/model";
import { changeText, focusSplit, type Segment } from "./model";
import type { activityChange } from "./model";
import { Tip, useDismiss } from "./ui";
import { ACCENT, greyOf } from "./StackedArea";

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
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

/**
 * Request 72: focus bars after the reference design: a row per share (Prior /
 * Now, Subtrends / Competitors), each a straight bar of grey parts with white
 * gaps and their short names inside, the highlighted one in blue. A part
 * keeps its grey in every row, so rows compare at a glance. Parts under 5%
 * are put together as Other when there are several (focusSplit).
 */
export function FocusBars({
  rows,
  highlight,
  short = (n) => n,
  empty,
  testId,
}: {
  rows: { label: string; counts: [string, number][]; testId?: string }[];
  /** The part in blue (the selected Macrotrend or competitor), when it is there. */
  highlight: string | null;
  /** A part's short name (inside the bar); the full name shows on hover. */
  short?: (name: string) => string;
  empty: string;
  testId?: string;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; s: Segment; row: string } | null>(null);
  const split = rows.map((r) => ({ ...r, segs: focusSplit(r.counts) }));
  // Each part's grey, by its first appearance, the same in every row.
  const order: string[] = [];
  for (const r of split) for (const sg of r.segs) if (sg.name !== highlight && !order.includes(sg.name)) order.push(sg.name);
  const fill = (name: string) => (name === highlight ? ACCENT : greyOf(order.indexOf(name)));
  return (
    <div className="dd-fbars" data-testid={testId}>
      {split.map((r) => (
        <div key={r.label} className="dd-fbar-row" data-testid={r.testId}>
          <span className="dd-fbar-label">{r.label}</span>
          {r.segs.length ? (
            <div className="dd-fbar" role="img" aria-label={`${r.label}: ${r.segs.map((sg) => `${sg.name} ${Math.round(sg.pct)}%`).join(", ")}`}>
              {r.segs.map((sg) => (
                <span
                  key={sg.name}
                  className={`dd-fseg${sg.name === highlight ? " on" : ""}`}
                  style={{ flexGrow: sg.pct, background: fill(sg.name) }}
                  onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, s: sg, row: r.label })}
                  onPointerLeave={() => setTip(null)}
                >
                  {sg.pct >= 7 ? (sg.others ? "Other" : short(sg.name)) : ""}
                </span>
              ))}
            </div>
          ) : (
            <p className="dd-focus-empty">{empty}</p>
          )}
        </div>
      ))}
      <Tip at={tip}>
        {tip && (
          <>
            <b className="dd-tip-title">{tip.s.name}</b>
            <span className="dd-tip-foot">
              {tip.row}: {plural(tip.s.n, "signal")} · {Math.round(tip.s.pct)}%
            </span>
            {tip.s.others && <span className="dd-tip-foot">{tip.s.others.join(", ")}</span>}
          </>
        )}
      </Tip>
    </div>
  );
}

export function ProfileCard({
  side,
  kind,
  title,
  top,
  all,
  value,
  onChange,
  iconOf,
  change,
  textLabel,
  text,
  bars,
  footer,
  testId,
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
  textLabel: string;
  text: ReactNode;
  bars: ReactNode;
  footer: ReactNode;
  testId: string;
}) {
  return (
    <section className={`dd-card dd-profile ${side}`} aria-label={title} data-testid={testId}>
      <header className="dd-card-head">
        <h3>{title}</h3>
        <Picker kind={kind} top={top} all={all} value={value} onChange={onChange} iconOf={iconOf} />
      </header>
      <div className="dd-profile-name">
        <b data-testid={`${testId}-name`}>{value}</b>
        <Change c={change} />
      </div>
      {/* Scrolls when long: focusable, so it scrolls with the keyboard too. */}
      <div className="dd-text" tabIndex={0} role="region" aria-label={`${textLabel} of ${value}`} data-testid={`${testId}-text`}>
        <span className="dd-text-label">{textLabel}</span>
        {text}
      </div>
      <div className="dd-bars">{bars}</div>
      <footer className="dd-foot">{footer}</footer>
    </section>
  );
}

/** The text, or a note when there is none yet. */
export function Analysis({ text, empty, testId }: { text: string | null | undefined; empty: string; testId?: string }) {
  return text?.trim() ? <RichText className="dd-analysis-text" text={text} testId={testId} /> : <p className="dd-muted">{empty}</p>;
}

export function MacroAnalysisLink({ name }: { name: string }) {
  return (
    <Link className="dd-open" to={`/analytics/megatrends?${new URLSearchParams({ m: name })}`} data-testid="dd-macro-open">
      Open the full Macrotrend analysis <span aria-hidden="true">→</span>
    </Link>
  );
}
