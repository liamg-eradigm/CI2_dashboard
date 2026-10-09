import { CORE, displayValue, sortedColumns, type Signal, type TrackerSchema } from "@eradigm/shared";
import { useSignal } from "../api/hooks";
import { RichText } from "./BulletText";
import { useFocusTrap } from "./RecordDrawer";

/**
 * Request 54: a Database row opens this pane from the right: every field of the
 * entry in full, one per row, long text keeping its lines and bullets.
 */
export function EntryFields({ id, row, schema, onClose, onOpenRecord }: { id: string; row?: Signal; schema: TrackerSchema; onClose: () => void; onOpenRecord: () => void }) {
  const sig = useSignal(id);
  const ref = useFocusTrap(true, onClose);
  const values = sig.data?.values ?? row?.values;
  const code = sig.data?.code ?? row?.code;
  const title = String(values?.[CORE.title] ?? code ?? "Entry");
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer entry-fields" role="dialog" aria-modal="true" aria-labelledby="ef-title" ref={ref} data-testid="entry-fields">
        <div className="drawer-head">
          <div className="ef-head">
            <span className="mono">{code ?? "…"}</span>
            <h2 id="ef-title">{title}</h2>
          </div>
          <div className="ef-actions">
            <button className="btn secondary small" onClick={onOpenRecord}>
              Open record
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close entry" data-autofocus>
              ✕
            </button>
          </div>
        </div>
        {sig.isError && !values ? (
          <div className="drawer-body">
            <p className="err-msg" role="alert">
              Could not load this entry · {(sig.error as Error).message}
            </p>
          </div>
        ) : !values ? (
          <div className="drawer-body">
            <div className="skeleton" style={{ height: 160 }} />
          </div>
        ) : (
          <dl className="ef-list">
            {sortedColumns(schema).map((c) => {
              const v = values[c.key];
              const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
              return (
                <div className="ef-row" key={c.key} data-testid={`ef-${c.key}`}>
                  <dt>{c.label}</dt>
                  <dd>{empty ? <span className="ef-none">—</span> : c.type === "long" ? <RichText className="rd-long" text={String(v)} /> : displayValue(c, v)}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </>
  );
}
