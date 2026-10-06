import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CORE, defaultDateRange, getColumn, todayIso, type Bar, type DashboardData, type FilterState, type Me, type TrackerSchema } from "@eradigm/shared";
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

/** Impact mixes side by side: by Macrotrend and / or by Competitor (competitors with signals only, the top ten until expanded). */
export function ImpactMixes({ data, schema, show, note }: { data: DashboardData; schema: TrackerSchema; show: ("macro" | "comp")[]; note?: string }) {
  const [open, setOpen] = useState(false);
  const opts = getColumn(schema, CORE.impact)?.options ?? [];
  const mixNote = `Counts shown ${[...opts].reverse().join(" / ")}${note ? ` · ${note}` : ""}`;
  const macro: Bar[] = data.macroBars.filter((b) => b.n > 0);
  const comp: Bar[] = data.compBars.filter((b) => b.n > 0);
  return (
    <div className={`ad-mix${show.length === 1 ? " one" : ""}`}>
      {show.includes("macro") && <BarChart title="Impact Mix by Macrotrend" sub={mixNote} bars={macro} schema={schema} mix />}
      {show.includes("comp") && (
        <BarChart
          title="Impact Mix by Competitor"
          sub={`${mixNote} · an entry naming several competitors counts for each`}
          bars={comp}
          schema={schema}
          variant="comp"
          mix
          limit={MIX_ROWS}
          expanded={open}
          onToggle={() => setOpen((o) => !o)}
        />
      )}
    </div>
  );
}

export { SignalTimeline };
