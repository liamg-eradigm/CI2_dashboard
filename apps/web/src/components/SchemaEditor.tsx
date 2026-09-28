import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { TYPE_LABEL, hasOptions, sortedColumns, type TrackerColumn } from "@eradigm/shared";
import { api } from "../api/client";
import { useInvalidate, useSchema, type SchemaWithUsage } from "../api/hooks";
import { useToast } from "../state/toast";

const enterBlur = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
};

/** Inline rename input: commits on blur or Enter. */
function RenameInput({ value, label, onCommit, className = "control" }: { value: string; label: string; onCommit: (v: string) => Promise<boolean>; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={className}
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={enterBlur}
      onBlur={async () => {
        if (v.trim() && v.trim() !== value && !(await onCommit(v.trim()))) setV(value);
        else if (!v.trim()) setV(value);
      }}
      maxLength={120}
    />
  );
}

export function SchemaEditor() {
  const schema = useSchema(true);
  const toast = useToast();
  const inv = useInvalidate();
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [newCol, setNewCol] = useState({ label: "", type: "select" });
  const [adds, setAdds] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const s = schema.data;

  const call = async (path: string, method: string, json: unknown, ok: string) => {
    try {
      await api<SchemaWithUsage>(path, { method, json });
      await inv();
      toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, false);
      return false;
    }
  };
  if (!s) return <div className="skeleton" style={{ height: 80, margin: 18 }} />;
  const usage = s.usage ?? {};

  const optRow = (c: TrackerColumn, o: string, removeLabel: string) => {
    const n = usage[c.key]?.[o] ?? 0;
    return (
      <div className="opt-row" key={o}>
        <RenameInput value={o} label={`Rename option ${o}`} onCommit={(to) => call(`/api/schema/columns/${c.key}/options`, "PATCH", { from: o, to }, `Renamed “${o}” to “${to}” across all signals`)} />
        <span className="use">{n} in use</span>
        <button
          className="x-btn"
          disabled={n > 0}
          title={n > 0 ? `In use by ${n} published signal${n > 1 ? "s" : ""} · reassign them first` : removeLabel}
          aria-label={`${removeLabel} ${o}`}
          onClick={() => call(`/api/schema/columns/${c.key}/options`, "DELETE", { value: o }, `Removed option “${o}”`)}
        >
          ✕
        </button>
      </div>
    );
  };

  return (
    <div style={{ borderTop: "1px solid var(--rule)", overflowX: "auto" }}>
      <div style={{ minWidth: 860 }}>
        <div className="schema-grid head" aria-hidden="true">
          <span>#</span>
          <span>Column name</span>
          <span>Type</span>
          <span>Dropdown options</span>
          <span>Entry</span>
          <span />
        </div>
        {sortedColumns(s).map((c, i) => {
          const isOpen = open === c.key;
          const count = c.type === "macro" ? s.taxonomy.length : c.type === "sub" ? s.taxonomy.reduce((a, g) => a + g.subtrends.length, 0) : (c.options?.length ?? 0);
          const noun = c.type === "macro" ? "macrotrends" : c.type === "sub" ? "subtrends" : count === 1 ? "option" : "options";
          const doAdd = async (key: string, parent?: string) => {
            const v = (adds[key] ?? "").trim();
            if (!v) return;
            if (await call(`/api/schema/columns/${c.key}/options`, "POST", { value: v, parent }, `Added “${v}”${parent ? ` to ${parent}` : ` to ${c.label}`}`)) setAdds((a) => ({ ...a, [key]: "" }));
          };
          return (
            <div key={c.key} style={{ borderTop: "1px solid var(--page)" }}>
              <div className="schema-grid">
                <span className="mono" style={{ fontSize: 11.5, color: "var(--muted-2)" }}>
                  {i + 1}
                </span>
                <RenameInput value={c.label} label={`Rename column ${c.label}`} onCommit={(label) => call(`/api/schema/columns/${c.key}`, "PATCH", { label }, `Renamed column “${c.label}” to “${label}”`)} />
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{TYPE_LABEL[c.type]}</span>
                <div>
                  {hasOptions(c) ? (
                    <button className="btn secondary small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.key)} style={isOpen ? { background: "var(--tint)", borderColor: "var(--focus)" } : undefined}>
                      {count} {noun} <span className={`chev ${isOpen ? "open" : ""}`} aria-hidden="true">▶</span>
                    </button>
                  ) : (
                    <span style={{ fontSize: 12.5, color: "var(--muted-3)" }}>Free entry</span>
                  )}
                </div>
                <button
                  className={`req-toggle ${c.required ? "on" : "off"}`}
                  aria-pressed={c.required}
                  title="Toggle whether approval requires this field"
                  onClick={() => call(`/api/schema/columns/${c.key}`, "PATCH", { required: !c.required }, `${c.label} is now ${c.required ? "optional" : "required"}`)}
                >
                  {c.required ? "Required" : "Optional"}
                </button>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  {c.core ? (
                    <span title="Used by the Dashboard charts, so it can be renamed but not deleted" style={{ fontSize: 12, color: "var(--muted-2)" }}>
                      Chart field · locked
                    </span>
                  ) : (
                    <button
                      className={`btn danger small ${confirm === c.key ? "confirm" : ""}`}
                      onClick={async () => {
                        if (confirm !== c.key) {
                          setConfirm(c.key);
                          if (timer.current) clearTimeout(timer.current);
                          timer.current = setTimeout(() => setConfirm(null), 4000);
                          return;
                        }
                        setConfirm(null);
                        await call(`/api/schema/columns/${c.key}`, "DELETE", undefined, `Deleted column “${c.label}”`);
                      }}
                    >
                      {confirm === c.key ? "Confirm delete" : "Delete"}
                    </button>
                  )}
                </div>
              </div>
              {isOpen && (c.type === "select" || c.type === "multi" || c.type === "macro") && (
                <div className="opt-panel">
                  {(c.type === "macro" ? s.taxonomy.map((g) => g.name) : (c.options ?? [])).map((o) => optRow(c, o, "Delete option"))}
                  <div className="opt-add">
                    <input className="control" aria-label={`New ${c.type === "macro" ? "macrotrend" : "option"}`} placeholder={c.type === "macro" ? "New macrotrend" : "New option"} value={adds[c.key] ?? ""} onChange={(e) => setAdds((a) => ({ ...a, [c.key]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && doAdd(c.key)} />
                    <button className="btn small" style={{ height: 32 }} onClick={() => doAdd(c.key)}>
                      + Add option
                    </button>
                  </div>
                </div>
              )}
              {isOpen && c.type === "sub" && (
                <div className="sub-groups">
                  {s.taxonomy.map((g) => (
                    <div className="sub-group" key={g.name}>
                      <div className="gh">{g.name}</div>
                      {g.subtrends.map((o) => optRow(c, o, "Delete subtrend"))}
                      <div className="opt-add" style={{ gridTemplateColumns: "minmax(0,1fr) 70px" }}>
                        <input className="control" aria-label={`New subtrend for ${g.name}`} placeholder="New subtrend" value={adds[`s:${g.name}`] ?? ""} onChange={(e) => setAdds((a) => ({ ...a, [`s:${g.name}`]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && doAdd(`s:${g.name}`, g.name)} />
                        <button className="btn small" style={{ height: 30 }} onClick={() => doAdd(`s:${g.name}`, g.name)}>
                          + Add
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div className="add-col">
          <span style={{ font: "700 10px var(--sans)", letterSpacing: ".12em", color: "var(--teal)", marginRight: 6 }}>ADD COLUMN</span>
          <input className="control" style={{ width: 260, height: 36 }} aria-label="New column name" placeholder="Column name" value={newCol.label} onChange={(e) => setNewCol((n) => ({ ...n, label: e.target.value }))} maxLength={60} />
          <select className="control" style={{ width: "auto", height: 36 }} aria-label="New column type" value={newCol.type} onChange={(e) => setNewCol((n) => ({ ...n, type: e.target.value }))}>
            <option value="select">Dropdown</option>
            <option value="text">Text</option>
            <option value="date">Date</option>
          </select>
          <button
            className="btn"
            onClick={async () => {
              if (!newCol.label.trim()) return toast("Name the new column first", false);
              if (await call("/api/schema/columns", "POST", { label: newCol.label.trim(), type: newCol.type }, `Added column “${newCol.label.trim()}”${newCol.type === "select" ? " · add its dropdown options" : ""}`)) {
                setNewCol((n) => ({ ...n, label: "" }));
              }
            }}
          >
            + Add column
          </button>
        </div>
      </div>
    </div>
  );
}
