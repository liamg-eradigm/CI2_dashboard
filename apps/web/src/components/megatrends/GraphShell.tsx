/**
 * The frame of the Megatrends and Competitors tabs: the knowledge graph, with
 * a column over its left edge holding the breadcrumbs, the summary in view and
 * the list (a bar between them drags to share the column's height), the
 * timeline below, and the entry drawer that opens from the right.
 */
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { GraphSpec } from "./Graph3D";

const Graph3D = lazy(() => import("./Graph3D").then((m) => ({ default: m.Graph3D })));

export function useReducedMotion() {
  const q = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [r, setR] = useState(!!q?.matches);
  useEffect(() => {
    if (!q) return;
    const f = () => setR(q.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [q]);
  return r;
}

/** A value kept in this browser (falls back to memory when storage is unavailable). */
export function useStored<T extends string | number | boolean>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      if (s == null) return initial;
      return (typeof initial === "number" ? Number(s) : typeof initial === "boolean" ? s === "1" : s) as T;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, typeof next === "boolean" ? (next ? "1" : "0") : String(next));
      } catch {
        /* not remembered */
      }
    },
  ];
}

/** The summary's share of the column (the list gets the rest), as the user left it. */
const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.85;
const clampSplit = (v: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Number.isFinite(v) ? v : 0.72));

export function GraphShell({
  storageKey,
  stageLabel,
  spec,
  graph,
  crumbs,
  panel,
  railTitle,
  railNoun,
  rail,
  timeline,
  drawer,
  drawerOpen,
}: {
  /** "megatrends" / "competitors": the browser remembers the list and the split per tab. */
  storageKey: string;
  stageLabel: string;
  spec: GraphSpec;
  graph: { onHub: (id: string) => void; onCore: () => void; onFocus: (id: string | null) => void; onEntry: (id: string) => void };
  crumbs: ReactNode;
  panel: ReactNode;
  railTitle: string;
  /** "Macrotrend list", "competitor list" (for the minimise buttons). */
  railNoun: string;
  rail: ReactNode;
  timeline: ReactNode;
  drawer: ReactNode;
  drawerOpen: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [noGl, setNoGl] = useState(false);
  const [railOpen, setRailOpen] = useStored<boolean>(`eradigm.${storageKey}.rail`, true);
  const [split, setSplit] = useStored<number>(`eradigm.${storageKey}.split`, 0.72);
  const ratio = clampSplit(split);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = (clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.height < 40) return;
    setSplit(clampSplit((clientY - r.top) / r.height));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) move(e.clientY);
  };
  const onUp = () => {
    dragging.current = false;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.04;
    const next = e.key === "ArrowUp" ? ratio - step : e.key === "ArrowDown" ? ratio + step : e.key === "Home" ? SPLIT_MIN : e.key === "End" ? SPLIT_MAX : null;
    if (next == null) return;
    e.preventDefault();
    setSplit(clampSplit(next));
  };

  return (
    <div className={`mg-page${drawerOpen ? " drawer-open" : ""}`} data-testid={storageKey}>
      <section className="mg-stage" aria-label={stageLabel}>
        {!noGl && (
          <Suspense fallback={<div className="mg-loading">Loading the knowledge graph…</div>}>
            <Graph3D spec={spec} reducedMotion={reducedMotion} {...graph} onUnavailable={() => setNoGl(true)} />
          </Suspense>
        )}
        {noGl && <p className="mg-nogl">The 3D view needs WebGL, which is switched off in this browser. The list, summaries and timeline still work.</p>}
        <div className="mg-side">
          {crumbs}
          <div className="mg-split" ref={box}>
            <div className="mg-split-a" style={{ flex: railOpen ? `${ratio} 1 0` : "1 1 0" }}>
              {panel}
            </div>
            {railOpen && (
              <div
                className="mg-splitter"
                role="separator"
                aria-orientation="horizontal"
                aria-label={`Resize the summary and the ${railNoun}`}
                aria-valuemin={Math.round(SPLIT_MIN * 100)}
                aria-valuemax={Math.round(SPLIT_MAX * 100)}
                aria-valuenow={Math.round(ratio * 100)}
                tabIndex={0}
                title="Drag to share the space between the summary and the list"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onKeyDown={onKey}
                data-testid="mg-splitter"
              >
                <span />
              </div>
            )}
            {railOpen ? (
              <div className="mg-rail" id={`${storageKey}-rail`} style={{ flex: `${1 - ratio} 1 0` }}>
                <div className="mg-rail-head">
                  <h2 className="mg-rail-title" id={`${storageKey}-rail-title`}>
                    {railTitle}
                  </h2>
                  <button className="mg-icon sm" onClick={() => setRailOpen(false)} aria-label={`Minimise the ${railNoun}`} aria-expanded={true} aria-controls={`${storageKey}-rail`} title="Minimise">
                    ‹
                  </button>
                </div>
                {rail}
              </div>
            ) : (
              <button className="mg-rail-open" onClick={() => setRailOpen(true)} aria-expanded={false} aria-controls={`${storageKey}-rail`} data-testid="mg-rail-open">
                ☰ {railTitle}
              </button>
            )}
          </div>
        </div>
      </section>
      {timeline}
      {drawer}
    </div>
  );
}
