import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CORE, defaultDateRange, getColumn, isPlaceholderCompetitor, todayIso, type Bar, type FilterState, type Me, type TrackerSchema } from "@eradigm/shared";
import { useDashboard, useDateBounds, useSchema, useSettings } from "../../api/hooks";
import { MixLegend, SignalTimeline } from "../Charts";
import { RecordDrawer } from "../RecordDrawer";
import { SizedHeading } from "../TextSize";

/** Rows in an impact mix (the number of Macrotrends): the competitors' top nine until expanded. */
const MIX_ROWS = 9;

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
export function ImpactMixes({
  filters,
  schema,
  show,
  note,
  sizeKey,
  shared = false,
}: {
  filters: FilterState;
  schema: TrackerSchema;
  show: ("macro" | "comp")[];
  note?: string;
  sizeKey?: (k: "macro" | "comp") => string;
  /** Request 58: the time frame is the page's (in the address), shared with its Explore Signals. */
  shared?: boolean;
}) {
  return (
    <div className={`ad-mix${show.length === 1 ? " one" : ""}`}>
      {show.map((k) => (
        <ImpactMix key={k} kind={k} filters={filters} schema={schema} note={note} sizeKey={sizeKey?.(k)} shared={shared} />
      ))}
    </div>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** Months from `from` to `to` (YYYY-MM), oldest first. */
export function monthsBetween(from: string, to: string): string[] {
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
 * Request 58: a dashboard's time frame in the address (`tf=YYYY-MM~YYYY-MM`;
 * none: all dates), so its Impact Mix and its Explore Signals share it: moving
 * either slider moves the other. Indexes into `months`.
 */
export const TIME_FRAME_PARAM = "tf";
export function useTimeFrameParam(months: string[]): [[number, number], (r: [number, number]) => void] {
  const [params, setParams] = useSearchParams();
  const last = Math.max(0, months.length - 1);
  const [f = "", t = ""] = (params.get(TIME_FRAME_PARAM) ?? "").split("~");
  const ia = f ? months.indexOf(f) : -1;
  const ib = t ? months.indexOf(t) : -1;
  const a = ia < 0 ? 0 : ia;
  const b = ib < 0 ? last : Math.max(a, ib);
  const range = useMemo<[number, number]>(() => [a, b], [a, b]);
  const set = useCallback(
    (r: [number, number]) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (r[0] <= 0 && r[1] >= last) n.delete(TIME_FRAME_PARAM);
          else n.set(TIME_FRAME_PARAM, `${months[r[0]]}~${months[r[1]]}`);
          return n;
        },
        { replace: true },
      ),
    [setParams, months, last],
  );
  return [range, set];
}

/** The dates a time frame covers (null at an end that is the whole span's). */
export function timeFrameDates(months: string[], [a, b]: [number, number]): { from: string | null; to: string | null } {
  const last = Math.max(0, months.length - 1);
  return { from: a > 0 && months[a] ? `${months[a]}-01` : null, to: b < last && months[b] ? lastDay(months[b]) : null };
}

/**
 * A time frame slider (request 32; request 58: also under Explore Signals):
 * two handles on one track pick the first and last month; the choice is
 * passed on once the slider rests.
 */
export function TimeFrameSlider({ id, title, months, range, onRange, busy = false }: { id: string; title: string; months: string[]; range: [number, number]; onRange: (r: [number, number]) => void; busy?: boolean }) {
  const last = Math.max(0, months.length - 1);
  const [draft, setDraft] = useState<[number, number]>(range);
  // Moved elsewhere (the other slider, or a new span): follow it.
  const [ra, rb] = range;
  useEffect(() => setDraft([ra, rb]), [ra, rb]);
  // Passed on once the slider has rested.
  useEffect(() => {
    if (draft[0] === ra && draft[1] === rb) return;
    const t = setTimeout(() => onRange(draft), 350);
    return () => clearTimeout(t);
  }, [draft, ra, rb, onRange]);
  const label = (r: [number, number]) => (months.length ? (r[0] === r[1] ? monthName(months[r[0]]!) : `${monthName(months[r[0]]!)} – ${monthName(months[r[1]]!)}`) : "");
  const all = draft[0] === 0 && draft[1] === last;
  return (
    <div className={`mix-range${busy ? " busy" : ""}`} data-testid={`mix-range-${id}`}>
      <div className="mix-range-head">
        <span className="field-label">Time frame</span>
        <b data-testid={`mix-range-label-${id}`} aria-live="polite">
          {all ? `All dates · ${label(draft)}` : label(draft)}
        </b>
        <button className="link-btn mix-range-all" onClick={() => setDraft([0, last])} disabled={all}>
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
}

/**
 * One impact mix with its own time frame (request 32): a slider under the bars
 * picks the first and last month; the bars update once the slider rests.
 */
export function ImpactMix({
  kind,
  filters,
  schema,
  note,
  fit = false,
  headExtra,
  noSub = false,
  sizeKey,
  shared = false,
}: {
  kind: "macro" | "comp" | "sub";
  filters: FilterState;
  schema: TrackerSchema;
  note?: string;
  /** Request 34: as many rows as fit the box (no Show all), e.g. in a dashboard cell. */
  fit?: boolean;
  /** Shown left of the key (e.g. a Subtrend / Competitor toggle). */
  headExtra?: ReactNode;
  /** Request 35: no line under the title. */
  noSub?: boolean;
  /** Request 50: staff change the title's size (A− / A+, for everyone) under this key. */
  sizeKey?: string;
  /** Request 58: the time frame is the page's (in the address), shared with its Explore Signals. */
  shared?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const months = useMemo(() => monthsBetween(filters.from, filters.to), [filters.from, filters.to]);
  const last = Math.max(0, months.length - 1);
  const local = useState<[number, number]>([0, last]);
  const pageFrame = useTimeFrameParam(months);
  const [range, setRange] = shared ? pageFrame : local;
  const setLocal = local[1];
  // A new date span (e.g. another trend): back to all of it.
  useEffect(() => {
    setLocal([0, last]);
  }, [last, filters.from, setLocal]);
  const [a, b] = [Math.min(range[0], last), Math.min(range[1], last)];
  const whole = a === 0 && b === last;
  const own: FilterState = whole ? filters : { ...filters, from: a === 0 ? filters.from : `${months[a]}-01`, to: b === last ? filters.to : lastDay(months[b]!) };
  const dash = useDashboard(own, true);
  const d = dash.data;
  const opts = getColumn(schema, CORE.impact)?.options ?? [];
  const mixNote = `Counts shown ${[...opts].reverse().join(" / ")}${note ? ` · ${note}` : ""}`;
  const title = kind === "macro" ? "Impact Mix by Macrotrend" : kind === "sub" ? "Impact Mix by Subtrend" : "Impact Mix by Competitor";
  // Competitors: "N/A" and the like are not competitors (request 32), so no bar for them.
  const bars: Bar[] = (kind === "macro" ? d?.macroBars : kind === "sub" ? d?.subBars : d?.compBars)?.filter((x) => x.n > 0 && (kind !== "comp" || !isPlaceholderCompetitor(x.label))) ?? [];
  const slider = <TimeFrameSlider id={kind} title={title} months={months} range={[a, b]} onRange={setRange} busy={dash.isFetching} />;
  if (!d) return <div className={`ad-skeleton mix-card${fit ? " fit" : ""}`} role="status" aria-label={`Loading ${title}`} />;
  return (
    <MixChart
      id={`mix-${kind}`}
      sizeKey={sizeKey}
      fit={fit}
      headExtra={headExtra}
      title={title}
      sub={noSub ? "" : mixNote}
      subTitle={kind === "comp" ? "An entry naming several competitors counts for each" : undefined}
      bars={bars}
      schema={schema}
      limit={kind === "comp" && !fit ? MIX_ROWS : undefined}
      expanded={open}
      onToggle={() => setOpen((o) => !o)}
      below={slider}
    />
  );
}

/** A label on one line; cut off with … when too long, and opened in full by selecting it. */
function CutLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  const [full, setFull] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured on the element on screen (a detached one reads 0 wide).
    const check = () => el.isConnected && setCut(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, full, cut]);
  if (full)
    return (
      <button className="mix-lbl full" onClick={() => setFull(false)} aria-expanded="true" title="Show on one line">
        {text}
      </button>
    );
  return cut ? (
    <button className="mix-lbl" onClick={() => setFull(true)} aria-expanded="false" title={text}>
      <span ref={ref}>{text}</span>
    </button>
  ) : (
    <span className="mix-lbl" ref={ref}>
      {text}
    </span>
  );
}

/**
 * An impact mix on the Analytics pages (request 33): nine rows high whatever
 * it shows (the competitors' top nine, all of them scrolling inside the same
 * box once expanded), one line per row, so two mixes side by side are the
 * same size with their rows level.
 */
function MixChart({
  id,
  sizeKey,
  title,
  sub,
  subTitle,
  bars,
  schema,
  limit,
  expanded,
  onToggle,
  below,
  fit = false,
  headExtra,
}: {
  fit?: boolean;
  headExtra?: ReactNode;
  id: string;
  sizeKey?: string;
  title: string;
  sub: string;
  subTitle?: string;
  bars: Bar[];
  schema: TrackerSchema;
  limit?: number;
  expanded: boolean;
  onToggle: () => void;
  below: ReactNode;
}) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  const opts = getColumn(schema, CORE.impact)?.options ?? ["Low", "Medium", "High"];
  const hi = opts[opts.length - 1] ?? "High";
  const lo = opts[0] ?? "Low";
  // Fit: as many whole rows as the list's height holds.
  const list = useRef<HTMLUListElement>(null);
  const [room, setRoom] = useState(MIX_ROWS);
  useLayoutEffect(() => {
    const el = list.current;
    if (!fit || !el) return;
    const measure = () => {
      const row = el.querySelector<HTMLElement>(".bar-row")?.getBoundingClientRect().height || 22;
      setRoom(Math.max(1, Math.floor((el.clientHeight + 0.5) / row)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, bars.length]);
  const capped = !!limit && bars.length > limit;
  const shown = fit ? bars.slice(0, room) : capped && !expanded ? bars.slice(0, limit) : bars;
  return (
    <section className={`card mix-card${fit ? " fit" : ""}`} aria-labelledby={id} data-testid={id}>
      <div className="mix-head">
        <div>
          {sizeKey ? (
            <SizedHeading className="card-title" id={id} sizeKey={sizeKey} label={`${title} heading`}>
              {title}
            </SizedHeading>
          ) : (
            <h2 className="card-title" id={id}>
              {title}
            </h2>
          )}
          {sub && (
            <span className="card-sub" title={subTitle}>
              {fit && bars.length > shown.length ? `${sub} · top ${shown.length} of ${bars.length}` : sub}
            </span>
          )}
        </div>
        <div className="mix-head-r">
          <div className="mix-key-row">
            {headExtra}
            <MixLegend schema={schema} />
          </div>
          {limit != null && (
            <button className="link-btn mix-more" aria-expanded={expanded} aria-controls={`${id}-bars`} onClick={onToggle} disabled={!capped && !expanded}>
              {expanded ? `Show top ${limit}` : capped ? `Show all ${bars.length}` : `All ${bars.length} shown`}
            </button>
          )}
        </div>
      </div>
      <ul ref={list} className={`bars mix-list${expanded ? " open" : ""}`} id={`${id}-bars`} aria-label={`${title}: count per category`} tabIndex={expanded ? 0 : undefined}>
        {shown.map((b) => (
          <li key={b.label} className="bar-row mix" aria-label={`${b.label}: ${b.high} ${hi}, ${b.medium} medium, ${b.low} ${lo}`}>
            <div className="lbl">
              <CutLabel text={b.label} />
            </div>
            <div className="track" aria-hidden="true">
              <div className="fill h" style={{ width: `${(b.high / max) * 100}%` }} />
              <div className="fill m" style={{ width: `${(b.medium / max) * 100}%` }} />
              <div className="fill l" style={{ width: `${(b.low / max) * 100}%` }} />
            </div>
            <div className="n" aria-hidden="true">{`${b.high} / ${b.medium} / ${b.low}`}</div>
          </li>
        ))}
        {!bars.length && <li className="empty mix-empty">No signals in this time frame.</li>}

      </ul>
      <div className="mix-foot">{below}</div>
    </section>
  );
}

export { SignalTimeline };
