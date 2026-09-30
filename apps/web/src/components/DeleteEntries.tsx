import { useEffect, useRef, useState } from "react";
import type { ItemSummary } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useInvalidate } from "../api/hooks";
import { useToast } from "../state/toast";
import { useFocusTrap } from "./RecordDrawer";

/** The table a deletion was started from (none: the Dashboard, where only a global delete is offered). */
export type DeleteTable = "tracker" | "phantoms";

export interface DeleteTarget {
  id: string;
  code: string;
  title: string;
}

const TABLE_WORD: Record<DeleteTable, string> = { tracker: "Tracker", phantoms: "Phantom" };

/**
 * Confirm deleting one or more tracker entries. From the Tracker or Phantoms
 * there are two choices: remove it from that table only (it stays in the
 * other one), or delete it globally (Tracker, Phantoms, Dashboard and exports,
 * for everyone). One request per entry (soft delete, audited).
 */
export function DeleteEntries({ entries, table, modal = false, onCancel, onDone }: { entries: DeleteTarget[]; table?: DeleteTable; modal?: boolean; onCancel: () => void; onDone: (deletedIds: string[]) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"table" | "global" | null>(null);
  const [done, setDone] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const trap = useFocusTrap(modal, busy ? () => undefined : onCancel);
  const inline = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modal) inline.current?.focus();
  }, [modal]);
  const n = entries.length;
  const one = n === 1;
  const subject = one ? (entries[0]?.code ?? "this entry") : `${n} entries`;
  const tableLabel = table ? `Delete ${TABLE_WORD[table]} ${one ? "Entry" : "Entries"}` : null;

  const run = async (scope: "table" | "global") => {
    setBusy(scope);
    setErr(null);
    const deleted: string[] = [];
    let wentGlobal = 0;
    const from = scope === "table" && table ? table : "global";
    for (const e of entries) {
      try {
        const res = await api<ItemSummary>(`/api/items/${e.id}`, { method: "DELETE", json: { from, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
        if (from !== "global" && res.status === "deleted") wentGlobal += 1;
        deleted.push(e.id);
        setDone(deleted.length);
      } catch (x) {
        setErr(`Stopped at ${e.code}: ${(x as ApiError).message}. ${deleted.length} of ${n} deleted.`);
        break;
      }
    }
    await inv();
    if (deleted.length === n) {
      const what = one ? (entries[0]?.code ?? "Entry") : `${n} entries`;
      if (from === "global") toast(`Deleted ${what} globally`);
      else if (table) {
        const other = table === "tracker" ? "Phantoms" : "the Tracker";
        const where = table === "tracker" ? "the Tracker" : "Phantoms";
        toast(`Deleted ${what} from ${where}${wentGlobal ? ` · ${wentGlobal} not in ${other} either, so deleted globally` : ` · still in ${other}`}`);
      }
    }
    setBusy(null);
    onDone(deleted);
  };

  const body = (
    <>
      <b id="del-title">Delete {subject}?</b>
      <div id="del-desc" className="del-options">
        {table === "tracker" && (
          <p>
            <b>{tableLabel}</b> removes {one ? "it" : "them"} from the Tracker, the Dashboard and Tracker exports. {one ? "It stays" : "They stay"} in Phantoms.
          </p>
        )}
        {table === "phantoms" && (
          <p>
            <b>{tableLabel}</b> removes {one ? "it" : "them"} from Phantoms only. {one ? "It stays" : "They stay"} in the Tracker and on the Dashboard.
          </p>
        )}
        <p>
          <b>Delete Globally</b> removes {one ? "it" : "them"} from the Tracker, Phantoms, the Dashboard and all exports, for everyone including clients.
        </p>
        <p className="del-small">Neither can be undone from the dashboard. History and the audit log are kept.</p>
      </div>
      {n > 1 || modal ? (
        <ul className="bulk-del-list">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="mono">{e.code}</span> {e.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="del-small">“{entries[0]?.title || subject}”</p>
      )}
      <label className="field">
        <span>Reason (optional, recorded in the audit log)</span>
        <input className="control" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Duplicate entry, published in error" data-autofocus={modal || undefined} />
      </label>
      {err && (
        <div className="err-msg" role="alert">
          ✕ {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn secondary" disabled={!!busy} onClick={onCancel}>
          Cancel
        </button>
        {table && tableLabel && (
          <button className="btn danger" disabled={!!busy} onClick={() => void run("table")}>
            {busy === "table" ? `Deleting… ${done} of ${n}` : tableLabel}
          </button>
        )}
        <button className="btn danger confirm" disabled={!!busy} onClick={() => void run("global")}>
          {busy === "global" ? `Deleting… ${done} of ${n}` : "Delete Globally"}
        </button>
      </div>
    </>
  );

  if (!modal)
    return (
      <div className="delete-confirm" role="alertdialog" aria-labelledby="del-title" aria-describedby="del-desc" tabIndex={-1} ref={inline}>
        {body}
      </div>
    );
  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div className="modal delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-desc" ref={trap}>
        {body}
      </div>
    </>
  );
}
