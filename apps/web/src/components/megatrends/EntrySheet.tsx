import { useEffect, useRef, useState } from "react";
import { CORE, displayValue, tableColumns, type MegatrendEntry } from "@eradigm/shared";
import { useSchema, useSignal } from "../../api/hooks";
import { formatDate } from "../../lib/format";

/**
 * The opened timeline entry's Tracker row, sliding up from the bottom of the
 * page (the timeline moves up and stays in view). Shows the values of the
 * entry's Tracker columns, in the Tracker's order. ✕ or Esc slides it down.
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
  // Keep showing the last entry while the sheet slides down.
  const [shown, setShown] = useState<MegatrendEntry | null>(entry);
  useEffect(() => {
    if (entry) setShown(entry);
  }, [entry]);
  const open = !!entry;
  const e = entry ?? shown;
  const signal = useSignal(e?.id ?? null);
  const schema = useSchema(e?.stream ?? "primary");
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

  return (
    <div className={`mg-sheet-wrap${open ? " open" : ""}`} data-testid="mg-sheet" aria-hidden={!open}>
      <section className="mg-sheet" role="region" aria-label="Tracker entry" inert={!open}>
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
      </section>
    </div>
  );
}
