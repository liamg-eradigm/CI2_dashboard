/** Request 70: small pieces shared by the Dashboard's charts (size, popups, tooltips). */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../RecordDrawer";

/** An element's size, kept up to date. */
export function useSize<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** A popup over the Dashboard (Escape or the scrim closes it; focus stays inside). */
export function Popup({ title, sub, onClose, children, className = "", testId }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; className?: string; testId?: string }) {
  const ref = useFocusTrap(true, onClose);
  return createPortal(
    <div className="dd-popup-root">
      <div className="scrim dd-scrim" onClick={onClose} aria-hidden="true" />
      <div className={`dd-popup ${className}`} role="dialog" aria-modal="true" aria-labelledby="dd-popup-title" ref={ref} data-testid={testId}>
        <header className="dd-popup-head">
          <div>
            <h2 id="dd-popup-title">{title}</h2>
            {sub && <p className="dd-popup-sub">{sub}</p>}
          </div>
          <button type="button" className="icon-btn dd-close" onClick={onClose} aria-label="Close" data-autofocus>
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.querySelector(".mg-page") ?? document.body,
  );
}

/** A tooltip that follows the pointer, kept inside the window. */
export function Tip({ at, children }: { at: { x: number; y: number } | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!at || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    const left = at.x + 14 + r.width > window.innerWidth - 8 ? at.x - 14 - r.width : at.x + 14;
    const top = Math.min(Math.max(8, at.y - r.height / 2), window.innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top });
  }, [at, children]);
  if (!at) return null;
  return createPortal(
    <div ref={ref} className="dd-tip" role="tooltip" style={{ left: pos?.left ?? at.x + 14, top: pos?.top ?? at.y, visibility: pos ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}

/** "Nice" axis ticks from 0 to at least max. */
export function niceTicks(max: number, n = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Closes when clicking outside `ref` or pressing Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, open, close]);
}
