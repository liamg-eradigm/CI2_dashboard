import { useLayoutEffect, useState } from "react";

/**
 * Request 37: a table's scroll box sized so that its card (top bar, table and
 * pager) fits the window below the sticky filter bar. The table then scrolls
 * inside the box, down and across, with its horizontal scrollbar always on
 * screen once the card is scrolled into view. Returns the ref for the box.
 */
export function useFitToScreen(min = 260): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const card = el.closest<HTMLElement>(".card") ?? el.parentElement;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bar = document.querySelector<HTMLElement>(".filterbar");
        const top = bar && getComputedStyle(bar).position === "sticky" ? bar.getBoundingClientRect().height : 0;
        // Everything in the card that is not the scroll box (its top bar and pager).
        const chrome = card ? card.getBoundingClientRect().height - el.getBoundingClientRect().height : 0;
        const max = Math.max(min, Math.floor(window.innerHeight - top - chrome - 24));
        if (el.style.maxHeight !== `${max}px`) el.style.maxHeight = `${max}px`;
        // Scrolling the card into view stops just below the filter bar.
        if (card) card.style.scrollMarginTop = `${Math.ceil(top) + 12}px`;
      });
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const bar = document.querySelector<HTMLElement>(".filterbar");
    if (ro) {
      if (bar) ro.observe(bar);
      if (card) ro.observe(card);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [el, min]);
  return setEl;
}
