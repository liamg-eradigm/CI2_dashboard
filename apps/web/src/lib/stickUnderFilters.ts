import { useLayoutEffect, useRef } from "react";

/**
 * Request 44: keep a strip stuck to the bottom of the sticky filter bar, whatever
 * its height (the Primary Tracker's AI Summary; request 53, the Database's tables).
 */
export function useStickUnderFilters<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>(".filterbar");
    const el = ref.current;
    if (!bar || !el) return;
    const place = () => {
      el.style.top = `${Math.round(bar.getBoundingClientRect().height)}px`;
    };
    place();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    ro?.observe(bar);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);
  return ref;
}
