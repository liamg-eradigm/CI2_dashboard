/** A row's fields in a half-screen panel on the right (request 61: RCA, News), one field per line, scrolling. */
import { useEffect, useRef, type ReactNode } from "react";

export function SidePanel({ title, sub, onClose, children, testId }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <aside ref={ref} className="drawer epi-panel" role="dialog" aria-label={title} tabIndex={-1} data-testid={testId}>
      <div className="drawer-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title epi-panel-title">{title}</h2>
          {sub && <div className="drawer-meta">{sub}</div>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="epi-panel-body">{children}</div>
    </aside>
  );
}

/** Field name over its value (an empty value shows a dash). */
export function FieldList({ fields }: { fields: { name: string; value: ReactNode }[] }) {
  return (
    <dl className="epi-fields">
      {fields.map((f) => (
        <div key={f.name} className="epi-field">
          <dt>{f.name}</dt>
          <dd>{f.value === "" || f.value == null ? <span className="epi-none">—</span> : f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
