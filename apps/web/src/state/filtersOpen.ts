/**
 * Request 47: the Primary Tracker's and the Database page's filters can be
 * closed to give the table more room. Remembered per page in this browser
 * (a convenience only: without storage each page starts as it does by
 * default). Request 48: the Database page starts with them closed.
 */
import { useCallback, useState } from "react";

type Page = "ptr" | "db";
const OPEN_BY_DEFAULT: Record<Page, boolean> = { ptr: true, db: false };
const key = (page: Page) => `eradigm.filters.${page}`;
/** Before request 48 only a closed Primary Tracker was remembered. */
const legacyKey = (page: Page) => `eradigm.filters.${page}.closed`;

function read(page: Page): boolean {
  try {
    const v = window.localStorage.getItem(key(page));
    if (v === "open") return true;
    if (v === "closed") return false;
    if (page === "ptr" && window.localStorage.getItem(legacyKey(page)) === "1") return false;
  } catch {
    /* storage unavailable */
  }
  return OPEN_BY_DEFAULT[page];
}

export function useFiltersOpen(page: Page): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => read(page));
  const set = useCallback(
    (o: boolean) => {
      setOpen(o);
      try {
        window.localStorage.setItem(key(page), o ? "open" : "closed");
        window.localStorage.removeItem(legacyKey(page));
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
