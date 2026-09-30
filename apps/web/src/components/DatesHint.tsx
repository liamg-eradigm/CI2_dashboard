import type { OutsideDates } from "@eradigm/shared";
import type { useFilters } from "../state/filters";
import { formatDate } from "../lib/format";

/**
 * "3 more outside these dates · Show all dates": entries that match every
 * filter except the date range. The default range is the last three months,
 * so an entry with an older (or a future) Event Date is otherwise easy to miss.
 */
export function DatesHint({ info, f }: { info: OutsideDates | undefined; f: ReturnType<typeof useFilters> }) {
  if (!info?.count || !info.from || !info.to) return null;
  const from = info.from < f.filters.from ? info.from : f.filters.from;
  const to = info.to > f.filters.to ? info.to : f.filters.to;
  const n = info.count;
  return (
    <span className="dates-hint" data-testid="dates-hint">
      <span>
        {n} more {n === 1 ? "entry is" : "entries are"} outside these dates ({formatDate(info.from)} – {formatDate(info.to)} overall)
      </span>
      <button className="link-btn" onClick={() => f.apply({ ...f.filters, from, to })}>
        Show all dates
      </button>
    </span>
  );
}
