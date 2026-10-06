import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { CORE, defaultDateRange, getColumn, isPlaceholderCompetitor, todayIso, type Bar, type FilterState, type Me, type TrackerSchema } from "@eradigm/shared";
import { useDashboard, useDateBounds, useSchema, useSettings } from "../../api/hooks";
import { BarChart, SignalTimeline } from "../Charts";
import { RecordDrawer } from "../RecordDrawer";

/** Rows shown in a long impact mix (competitors) until it is expanded. */
const MIX_ROWS = 10;

/**
 * The Analytics pages' data (request 31): the Dashboard's figures for every
 * Tracker entry over all dates (oldest entry to today), narrowed by `values`
 * (e.g. one Macrotrend, Subtrend or competitor). No filter bar: the Tracker
 * keeps its filters.
 */
export function useAnalytics(values: Record<string, string>, me: Me) {
  const schema = useSchema("all");
  const settings = useSettings();
  const bounds = useDateBounds();
  const key = JSON.stringify(values);
  const filters: FilterState | null = useMemo(() => {
    if (!bounds.data && !bounds.isError) return null;
    return { q: "", ...defaultDateRange(todayIso(new Date(), settings.data?.timezone ?? me.timezone), bounds.data), values: JSON.parse(key) as Record<string, string> };
  }, [bounds.data, bounds.isError, settings.data?.timezone, me.timezone, key]);
  const dash = useDashboard(filters ?? { q: "", from: "", to: "", values: {} }, !!filters && !!schema.data);
  return { schema: schema.data, filters, dash };
}

/** A record opened from the timeline (?signal=…), in the usual drawer. */
export function useRecordParam() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("signal");
  const open = useCallback(
    (id: string) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set("signal", id);
          return n;
        },
        { replace: false },
      ),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.delete("signal");
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { selected, open, close };
}

export function RecordFromTimeline({ schema, me }: { schema: TrackerSchema; me: Me }) {
  const r = useRecordParam();
  return r.selected ? <RecordDrawer id={r.selected} schema={schema} me={me} onClose={r.close} onOpen={r.open} /> : null;
}

/** Impact mixes side by side: by Macrotrend and / or by Competitor (competitors with signals only, no N/A, the top ten until expanded), each with its own time frame. */
export function ImpactMixes({ filters, schema, show, note }: { filters: FilterState; schema: TrackerSchema; show: ("macro" | "comp")[]; note?: string }) {
  return (
    <div className={`ad-mix${show.length === 1 ? " one" : ""}`}>
      {show.map((k) => (
        <ImpactMix key={k} kind={k} filters={filters} schema={schema} note={note} />
      ))}
    </div>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** Months from `from` to `to` (YYYY-MM), oldest first. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let i = 0; i < 1200; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (k > end) break;
    out.push(k);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * One impact mix with its own time frame (request 32): a slider under the bars
 * picks the first and last month; the bars update once the slider rests.
 */
function ImpactMix({ kind, filters, schema, note }: { kind: "macro" | "comp"; filters: FilterState; schema: TrackerSchema; note?: string }) {
  const [open, setOpen] = useState(false);
  const months = useMemo(() => monthsBetween(filters.from, filters.to), [filters.from, filters.to]);
  const last = Math.max(0, months.length - 1);
  const [draft, setDraft] = useState<[number, number]>([0, last]);
  const [range, setRange] = useState<[number, number]>([0, last]);
  // A new date span (e.g. another trend): back to all of it.
  useEffect(() => {
    setDraft([0, last]);
    setRange([0, last]);
  }, [last, filters.from]);
  // Update the bars once the slider has rested.
  useEffect(() => {
    if (draft[0] === range[0] && draft[1] === range[1]) return;
    const t = setTimeout(() => setRange(draft), 350);
    return () => clearTimeout(t);
  }, [draft, range]);
  const [a, b] = [Math.min(range[0], last), Math.min(range[1], last)];
  const whole = a === 0 && b === last;
  const own: FilterState = whole ? filters : { ...filters, from: a === 0 ? filters.from : `${months[a]}-01`, to: b === last ? filters.to : lastDay(months[b]!) };
  const dash = useDashboard(own, true);
  const d = dash.data;
  const opts = getColumn(schema, CORE.impact)?.options ?? [];
  const mixNote = `Counts shown ${[...opts].reverse().join(" / ")}${note ? ` · ${note}` : ""}`;
  const title = kind === "macro" ? "Impact Mix by Macrotrend" : "Impact Mix by Competitor";
  // Competitors: "N/A" and the like are not competitors (request 32), so no bar for them.
  const bars: Bar[] = (kind === "macro" ? d?.macroBars : d?.compBars)?.filter((x) => x.n > 0 && (kind === "macro" || !isPlaceholderCompetitor(x.label))) ?? [];
  const label = (r: [number, number]) => (months.length ? (r[0] === r[1] ? monthName(months[r[0]]!) : `${monthName(months[r[0]]!)} – ${monthName(months[r[1]]!)}`) : "");
  const slider = (
    <div className={`mix-range${dash.isFetching ? " busy" : ""}`} data-testid={`mix-range-${kind}`}>
      <div className="mix-range-head">
        <span className="field-label">Time frame</span>
        <b data-testid={`mix-range-label-${kind}`} aria-live="polite">
          {draft[0] === 0 && draft[1] === last ? `All dates · ${label(draft)}` : label(draft)}
        </b>
        <button className="link-btn mix-range-all" onClick={() => setDraft([0, last])} disabled={draft[0] === 0 && draft[1] === last}>
          All dates
        </button>
      </div>
      <div className="mix-range-track" style={{ "--a": `${last ? (draft[0] / last) * 100 : 0}%`, "--b": `${last ? (draft[1] / last) * 100 : 100}%` } as CSSProperties}>
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={draft[0]}
          disabled={!last}
          aria-label={`First month of ${title}`}
          aria-valuetext={months[draft[0]] ? monthName(months[draft[0]]!) : ""}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDraft(([, hi]) => [Math.min(v, hi), hi]);
          }}
        />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={draft[1]}
          disabled={!last}
          aria-label={`Last month of ${title}`}
          aria-valuetext={months[draft[1]] ? monthName(months[draft[1]]!) : ""}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDraft(([lo]) => [lo, Math.max(v, lo)]);
          }}
        />
      </div>
    </div>
  );
  if (!d) return <div className="ad-skeleton" style={{ height: 320 }} role="status" aria-label={`Loading ${title}`} />;
  return kind === "macro" ? (
    <BarChart title={title} sub={mixNote} bars={bars} schema={schema} mix below={slider} />
  ) : (
    <BarChart
      title={title}
      sub={`${mixNote} · an entry naming several competitors counts for each`}
      bars={bars}
      schema={schema}
      variant="comp"
      mix
      limit={MIX_ROWS}
      expanded={open}
      onToggle={() => setOpen((o) => !o)}
      below={slider}
    />
  );
}

export { SignalTimeline };
