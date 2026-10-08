import { useLayoutEffect, useState } from "react";

/**
 * Request 37: a table's scroll box sized so that its card (top bar, table and
 * pager) fits the window below the sticky filter bar (and anything stuck
 * under it, `[data-sticky-under]`: the Primary Tracker's AI Summary). The
 * table then scrolls inside the box, down and across, with its horizontal
 * scrollbar always on screen once the card is scrolled into view. `ratio`
 * (request 44): the share of that space the card takes. With `fill`
 * (request 45, Analytics → Primary Tracker) the box is sized instead so its
 * card runs exactly to the bottom of the window from where it sits (the page
 * then needs no scrolling). Returns the ref for the box.
 */
export function useFitToScreen(min = 260, ratio = 1, fill = false): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const card = el.closest<HTMLElement>(".card") ?? el.parentElement;
    let frame = 0;
    // From the box's place on the page (not the screen), to the bottom of the window, less what follows it in the card.
    const fillNow = () => {
      const box = el.getBoundingClientRect();
      const after = card ? card.getBoundingClientRect().bottom - box.bottom : 0;
      const h = Math.max(min, Math.floor(window.innerHeight - (box.top + window.scrollY) - after));
      if (el.style.height !== `${h}px`) {
        el.style.height = `${h}px`;
        el.style.maxHeight = `${h}px`;
      }
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      // Request 46: filling the window is measured at once (in the same frame as the resize that moved the box,
      // before it is painted), so the page never overflows for a frame and no scrollbar flickers in and out.
      if (fill) return fillNow();
      frame = requestAnimationFrame(() => {
        const bar = document.querySelector<HTMLElement>(".filterbar");
        const stuck = [...document.querySelectorAll<HTMLElement>("[data-sticky-under]")].reduce((h, x) => h + x.getBoundingClientRect().height, 0);
        const top = (bar && getComputedStyle(bar).position === "sticky" ? bar.getBoundingClientRect().height : 0) + stuck;
        // Everything in the card that is not the scroll box (its top bar and pager).
        const chrome = card ? card.getBoundingClientRect().height - el.getBoundingClientRect().height : 0;
        const max = Math.max(min, Math.floor((window.innerHeight - top - 24) * ratio - chrome));
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
      for (const x of document.querySelectorAll<HTMLElement>("[data-sticky-under]")) ro.observe(x);
      if (card) ro.observe(card);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [el, min, ratio, fill]);
  return setEl;
}
