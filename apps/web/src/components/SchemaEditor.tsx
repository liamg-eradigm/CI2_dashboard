import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
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
  // Column order while dragging (keys); null = the saved order.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const dropped = useRef(false);
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
  const saved = sortedColumns(s);
  const byKey = new Map(saved.map((c) => [c.key, c]));
  const cols = dragOrder ? dragOrder.map((k) => byKey.get(k)).filter((c): c is TrackerColumn => !!c) : saved;

  /** Save a new column order (applies to drafts, the Tracker, filters and exports). */
  const saveOrder = async (keys: string[], ok: string) => {
    if (keys.join("\u0001") === saved.map((c) => c.key).join("\u0001")) return;
    await call("/api/schema/columns/order", "PUT", { keys }, ok);
  };
  const sortBy = (dir: 1 | -1) =>
    saveOrder(
      [...saved].sort((a, b) => dir * a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true })).map((c) => c.key),
      `Columns sorted ${dir === 1 ? "A → Z" : "Z → A"}`,
    );
  const move = (key: string, by: number) => {
    const keys = saved.map((c) => c.key);
    const i = keys.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= keys.length) return;
    keys.splice(j, 0, ...keys.splice(i, 1));
    void saveOrder(keys, `Moved “${byKey.get(key)?.label}” to position ${j + 1}`);
  };
  const drag = {
    start: (e: DragEvent<HTMLElement>, key: string) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
      // The handle is what is dragged; show the whole row under the pointer.
      const row = e.currentTarget.closest(".schema-row");
      if (row) e.dataTransfer.setDragImage(row, 24, 20);
      dropped.current = false;
      setDragKey(key);
      setDragOrder(saved.map((c) => c.key));
    },
    over: (e: DragEvent, overKey: string) => {
      if (!dragKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overKey === dragKey) return;
      setDragOrder((o) => {
        const keys = [...(o ?? saved.map((c) => c.key))];
        const from = keys.indexOf(dragKey);
        const to = keys.indexOf(overKey);
        if (from < 0 || to < 0) return o;
        keys.splice(to, 0, ...keys.splice(from, 1));
        return keys;
      });
    },
    drop: (e: DragEvent) => {
      if (!dragKey) return;
      e.preventDefault();
      dropped.current = true;
      const keys = dragOrder;
      const label = byKey.get(dragKey)?.label;
      const pos = (keys?.indexOf(dragKey) ?? 0) + 1;
      setDragKey(null);
      if (keys) void saveOrder(keys, `Moved “${label}” to position ${pos}`).finally(() => setDragOrder(null));
    },
    end: () => {
      setDragKey(null);
      if (!dropped.current) setDragOrder(null);
    },
  };

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
      <div style={{ minWidth: 940 }}>
        <div className="order-bar">
          <span className="field-label">Column order</span>
          <button className="btn secondary small" onClick={() => void sortBy(1)} title="Sort all columns alphabetically by name, A to Z">
            Sort A → Z
          </button>
          <button className="btn secondary small" onClick={() => void sortBy(-1)} title="Sort all columns alphabetically by name, Z to A">
            Sort Z → A
          </button>
          <span className="order-hint">
            or drag <span aria-hidden="true">⠿</span> to reorder (keyboard: the ↑ ↓ buttons). The order applies to drafts, the Tracker, filters and exports.
          </span>
        </div>
        <div className="schema-grid head" aria-hidden="true">
          <span>Order</span>
          <span>Column name</span>
          <span>Type</span>
          <span>Dropdown options</span>
          <span>Entry</span>
          <span />
        </div>
        {cols.map((c, i) => {
          const isOpen = open === c.key;
          const count = c.type === "macro" ? s.taxonomy.length : c.type === "sub" ? s.taxonomy.reduce((a, g) => a + g.subtrends.length, 0) : (c.options?.length ?? 0);
          const noun = c.type === "macro" ? "macrotrends" : c.type === "sub" ? "subtrends" : count === 1 ? "option" : "options";
          const doAdd = async (key: string, parent?: string) => {
            const v = (adds[key] ?? "").trim();
            if (!v) return;
            if (await call(`/api/schema/columns/${c.key}/options`, "POST", { value: v, parent }, `Added “${v}”${parent ? ` to ${parent}` : ` to ${c.label}`}`)) setAdds((a) => ({ ...a, [key]: "" }));
          };
          return (
            <div
              key={c.key}
              className={`schema-row ${dragKey === c.key ? "dragging" : ""}`}
              onDragOver={(e) => drag.over(e, c.key)}
              onDrop={drag.drop}
              data-testid={`col-row-${c.key}`}
            >
              <div className="schema-grid">
                <span className="order-cell">
                  <span
                    className="drag-handle"
                    title={`Drag to move “${c.label}”`}
                    aria-hidden="true"
                    draggable
                    onDragStart={(e) => drag.start(e, c.key)}
                    onDragEnd={drag.end}
                    data-testid={`drag-${c.key}`}
                  >
                    ⠿
                  </span>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--muted-2)", minWidth: 16 }}>
                    {i + 1}
                  </span>
                  <button className="move-btn" aria-label={`Move ${c.label} up`} disabled={i === 0 || !!dragKey} onClick={() => move(c.key, -1)}>
                    ↑
                  </button>
                  <button className="move-btn" aria-label={`Move ${c.label} down`} disabled={i === cols.length - 1 || !!dragKey} onClick={() => move(c.key, 1)}>
                    ↓
                  </button>
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
