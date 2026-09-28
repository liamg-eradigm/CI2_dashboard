import { bucket, formatDate, formatDateTime, levelOf, type TrackerColumn } from "@eradigm/shared";

export { formatDate, formatDateTime };

export const IMPACT_CLASS = ["low", "medium", "high"] as const;
export const IMPACT_GLYPH = ["●", "■", "◆"];
export const IMPACT_SHAPE = ["small circle", "square", "large diamond"];
export const GROWTH_GLYPH = ["—", "▲", "▲▲"];

export function impactBucket(col: TrackerColumn | undefined, v: string | null | undefined): 0 | 1 | 2 | -1 {
  const i = levelOf(col, v);
  if (i < 0) return -1;
  return bucket(i, col?.options?.length ?? 3);
}

export function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Viewer-local time, e.g. "28 Sep 2026, 11:40". */
export function localDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
