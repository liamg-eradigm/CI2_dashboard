/**
 * Request 47: the Primary Tracker's and the Database page's filters can be
 * closed to give the table more room. Remembered per page in this browser
 * (a convenience only: without storage they start open).
 */
import { useCallback, useState } from "react";

const key = (page: string) => `eradigm.filters.${page}.closed`;

function read(page: string): boolean {
  try {
    return window.localStorage.getItem(key(page)) !== "1";
  } catch {
    return true;
  }
}

export function useFiltersOpen(page: "ptr" | "db"): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => read(page));
  const set = useCallback(
    (o: boolean) => {
      setOpen(o);
      try {
        if (o) window.localStorage.removeItem(key(page));
        else window.localStorage.setItem(key(page), "1");
      } catch {
        /* storage unavailable: lasts for this visit */
      }
    },
    [page],
  );
  return [open, set];
}

/** The button that closes or opens the filters (in the Active filters bar). */
export const filtersToggleLabel = (open: boolean) => (open ? "Hide filters" : "Show filters");
