import { useEffect, useRef, useState } from "react";
import { CORE, displayValue, tableColumns, type MegatrendEntry } from "@eradigm/shared";
import { useSchema, useSignal } from "../../api/hooks";
import { formatDate } from "../../lib/format";
import { useSavedPages } from "../SavedPages";

/** Open an entry's saved page in a popup window (the app's sandboxed source view). */
export function openSourcePopup(itemId: string, pageId: string | null = null) {
  const url = `/source/${itemId}${pageId ? `?page=${encodeURIComponent(pageId)}` : ""}`;
  const w = Math.min(1180, Math.round(window.screen.availWidth * 0.8));
  const h = Math.min(900, Math.round(window.screen.availHeight * 0.85));
  window.open(url, `eradigm-source-${itemId}${pageId ? `-${pageId}` : ""}`, `popup=yes,width=${w},height=${h},left=${Math.round((window.screen.availWidth - w) / 2)},top=40`);
}

/**
 * The opened entry's Tracker row, in a drawer that slides in from the right
 * (Megatrends and Competitors). Shows the values of the entry's Tracker
 * columns, in the Tracker's order, and opens its saved page(s) in a popup
 * window. ✕ or Esc slides it away.
 */
export function EntrySheet({
  entry,
  colour,
  position,
  onClose,
  onStep,
}: {
  entry: MegatrendEntry | null;
  colour: string;
  position: { index: number; total: number } | null;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
}) {
  // Keep showing the last entry while the drawer slides away.
  const [shown, setShown] = useState<MegatrendEntry | null>(entry);
  useEffect(() => {
    if (entry) setShown(entry);
  }, [entry]);
  const open = !!entry;
  const e = entry ?? shown;
  const signal = useSignal(e?.id ?? null);
  const schema = useSchema(e?.stream ?? "primary");
  const hasPage = !!signal.data?.hasSnapshot;
  const pages = useSavedPages(e?.id ?? null, hasPage && (signal.data?.pages ?? 0) > 1);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) head.current?.focus({ preventScroll: true });
  }, [open, entry?.id]);
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const cols = schema.data ? tableColumns(schema.data, "tracker").filter((c) => c.key !== CORE.title) : [];
  const values = signal.data?.values;
  const many = (pages.data?.length ?? 0) > 1;

  return (
    <aside className={`mg-drawer${open ? " open" : ""}`} data-testid="mg-sheet" aria-hidden={!open} aria-label="Tracker entry" inert={!open}>
      {e && (
        <>
          <header className="mg-sheet-head">
            <div className="mg-sheet-meta">
              <span className="dot" style={{ background: colour }} aria-hidden="true" />
              <span className="mono">{e.recordId || e.code}</span>
              <span className={`mg-stream ${e.stream}`}>{e.stream === "primary" ? "Primary" : "Secondary"}</span>
              <span>{formatDate(e.date)}</span>
              {position && (
                <span className="mg-pos">
                  {position.index + 1} of {position.total}
                </span>
              )}
            </div>
            <h2 ref={head} tabIndex={-1}>
              {e.title || e.code}
            </h2>
            <div className="mg-sheet-ctl">
              <button className="mg-icon" onClick={() => onStep(-1)} disabled={!position || position.index === 0} aria-label="Previous entry on the timeline" title="Previous entry">
                ‹
              </button>
              <button className="mg-icon" onClick={() => onStep(1)} disabled={!position || position.index >= position.total - 1} aria-label="Next entry on the timeline" title="Next entry">
                ›
              </button>
              <button className="mg-icon" onClick={onClose} aria-label="Close entry" title="Close (Esc)">
                ✕
              </button>
            </div>
          </header>
          {signal.data && (
            <div className="mg-pages">
              {!hasPage ? (
                <span className="mg-hint">No saved page attached.</span>
              ) : many ? (
                <>
                  <span className="mg-pages-label">Saved pages</span>
                  {pages.data!.map((p, i) => (
                    <button key={p.id} className="mg-btn ghost sm" onClick={() => openSourcePopup(e.id, p.first ? null : p.id)} title={`Open ${p.name} in a popup window`}>
                      ⧉ {i + 1}. {p.name}
                    </button>
                  ))}
                </>
              ) : (
                <button className="mg-btn sm" onClick={() => openSourcePopup(e.id)} data-testid="mg-open-page">
                  ⧉ Open saved page
                </button>
              )}
            </div>
          )}
          <dl className="mg-fields">
            {signal.isError && <p className="mg-err">Could not load this entry.</p>}
            {!values &&
              !signal.isError &&
              Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="mg-field skel">
                  <dt>&nbsp;</dt>
                  <dd>&nbsp;</dd>
                </div>
              ))}
            {values &&
              cols.map((c) => {
                const text = displayValue(c, values[c.key]) || "—";
                return (
                  <div key={c.key} className={`mg-field${c.type === "long" ? " long" : ""}`}>
                    <dt>{c.label}</dt>
                    <dd>{text}</dd>
                  </div>
                );
              })}
          </dl>
        </>
      )}
    </aside>
  );
}
