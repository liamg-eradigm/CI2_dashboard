import { useLayoutEffect, useRef } from "react";

/**
 * Request 44: keep a strip stuck to the bottom of the sticky filter bar, whatever
 * its height (the Primary Tracker's AI Summary; request 53, the Database's
 * tables). Request 56: strips stack — each sits under the filter bar and the
 * stuck strips before it (the Database's Primary Tracker has both).
 */
export function useStickUnderFilters<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>(".filterbar");
    const el = ref.current;
    if (!el) return;
    const before = () => [...document.querySelectorAll<HTMLElement>("[data-sticky-under]")].filter((x) => x !== el && !!(x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    const place = () => {
      const top = (bar ? bar.getBoundingClientRect().height : 0) + before().reduce((h, x) => h + x.getBoundingClientRect().height, 0);
      el.style.top = `${Math.round(top)}px`;
    };
    place();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (bar) ro?.observe(bar);
    for (const x of before()) ro?.observe(x);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);
  return ref;
}
