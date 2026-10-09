import { DEFAULT_NEW_SIGNAL_DAYS } from "@eradigm/shared";
import { useCallback } from "react";
import { useSettings } from "../../api/hooks";

const DAY = 86_400_000;
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY;
/** Today in this browser's time zone, as a day number. */
const today = () => {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY;
};

/**
 * Request 40: a signal is new while its Event Date is less than `days` days
 * ago (Admin → Knowledge graphs · New signals; 14 by default).
 */
export function isNewSignal(date: string | null | undefined, days: number, now = today()): boolean {
  if (!date) return false;
  const d = dayOf(date);
  return Number.isFinite(d) && now - d < days;
}

/** `isNew(date)` with the workspace's cutoff. */
export function useIsNewSignal(): (date: string | null | undefined) => boolean {
  const days = useSettings().data?.newSignals?.days ?? DEFAULT_NEW_SIGNAL_DAYS;
  return useCallback((date) => isNewSignal(date, days), [days]);
}
