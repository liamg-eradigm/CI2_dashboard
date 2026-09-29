import { useEffect, useRef, useState } from "react";
import { CORE, can, displayValue, normaliseValues, optionsOf, sortedColumns, splitMulti, subtrendsOf, type Me, type TrackerSchema } from "@eradigm/shared";
import { api, ApiError } from "../api/client";
import { useInvalidate, useSignal } from "../api/hooks";
import { useToast } from "../state/toast";
import { formatDate, localDateTime, pct } from "../lib/format";
import { Combobox } from "./Combobox";
import { SnapshotFrame } from "./SnapshotFrame";

const PROV: Record<string, string> = { source: "From source", ai: "AI suggested", analyst: "Analyst" };

function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab" || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute("disabled"));
      if (!f.length) return;
      const first = f[0] as HTMLElement;
      const last = f[f.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

export function RecordDrawer({ id, schema, me, onClose, onOpen }: { id: string; schema: TrackerSchema; me: Me; onClose: () => void; onOpen: (id: string) => void }) {
  const sig = useSignal(id);
  const ref = useFocusTrap(true, onClose);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const s = sig.data;
  const cols = sortedColumns(schema);
  const canRevise = can(me.role, "item:edit");
  // Admins and analysts only (the API enforces the same rule).
  const canDelete = can(me.role, "item:delete");
  const published = s?.revisions.filter((r) => r.kind === "published") ?? [];

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={ref}>
        <div className="drawer-head">
          <div className="drawer-meta">
            <span className="mono" style={{ color: "var(--ink)" }}>
              {s?.code ?? "…"}
            </span>
            {s && (
              <>
                <span>·</span>
                <span>Published rev {s.rev}</span>
                <span>·</span>
                <span>Filters kept</span>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canRevise && s && !editing && !deleting && (
              <button className="btn secondary small" onClick={() => setEditing(true)}>
                Revise
              </button>
            )}
            {canDelete && s && !editing && !deleting && (
              <button className="btn danger small" onClick={() => setDeleting(true)}>
                Delete
              </button>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="Close record" data-autofocus>
              ✕
            </button>
          </div>
        </div>
        {sig.isLoading && <div className="drawer-body"><div className="skeleton" style={{ height: 120 }} /></div>}
        {sig.isError && (
          <div className="drawer-body">
            <p className="err-msg" role="alert">
              {(sig.error as Error).message}
            </p>
          </div>
        )}
        {s && (
          <div className="drawer-body">
            {deleting && <DeleteConfirm id={s.id} code={s.code} title={String(s.values[CORE.title] ?? "")} onCancel={() => setDeleting(false)} onDeleted={onClose} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 id="drawer-title" style={{ font: "700 20px/1.3 var(--sans)", textWrap: "pretty" }}>
                {String(s.values[CORE.title] ?? "")}
              </h2>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)", whiteSpace: "pre-line" }}>{s.text}</div>
            </div>

            {editing ? (
              <ReviseForm id={id} schema={schema} values={s.values} onDone={() => setEditing(false)} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="section-h">Classifications</div>
                <div className="cls-grid">
                  {cols
                    .filter((c) => c.key !== CORE.title && c.key !== CORE.competitors)
                    .map((c) => {
                      const ev = s.evidence?.[c.key];
                      return (
                        <div key={c.key}>
                          <span className="k">{c.label}</span>
                          <span className="v">{displayValue(c, s.values[c.key]) || "—"}</span>
                          <span className="prov-tag">
                            {PROV[s.provenance[c.key] ?? ""] ?? ""}
                            {ev?.confidence != null && s.provenance[c.key] === "ai" ? ` · ${pct(ev.confidence)}` : ""}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="section-h">Company associations</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {((s.values[CORE.competitors] as string[]) ?? []).map((c) => (
                  <span className="chip-navy" key={c}>
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="section-h">Source and snapshot</div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", overflowWrap: "anywhere" }}>
                {String(s.values.source ?? "Source")} ·{" "}
                {s.url ? (
                  <a className="mono" style={{ fontSize: 12 }} href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                    {s.url}
                  </a>
                ) : (
                  "—"
                )}
              </div>
              {s.snapshot && s.snapshot.retentionStatus === "active" ? (
                <SnapshotFrame itemId={s.id} title={`Stored source snapshot for ${s.code}`} />
              ) : (
                <div className="snapshot-none">{s.snapshot ? `Snapshot ${s.snapshot.retentionStatus} under the retention policy` : "No stored snapshot for this signal"}</div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="section-h">Provenance</div>
              <dl className="kv">
                {can(me.role, "inbox:read") && (
                  <>
                    <dt>Inbox item</dt>
                    <dd className="mono">{s.inboxCode}</dd>
                  </>
                )}
                <dt>Received</dt>
                <dd>{localDateTime(s.receivedAt)}</dd>
                <dt>Submitted URL</dt>
                <dd className="mono" style={{ fontSize: 12 }}>{s.submittedUrl ?? "Uploaded HTML file"}</dd>
                <dt>Final URL</dt>
                <dd className="mono" style={{ fontSize: 12 }}>{s.snapshot?.finalUrl ?? s.url ?? "—"}</dd>
                <dt>Snapshot</dt>
                <dd className="mono" style={{ fontSize: 12 }}>
                  {s.snapshot ? `${s.snapshot.captureMethod} · ${Math.round(s.snapshot.bytes / 1024)} KB · sha256 ${s.snapshot.sha256.slice(0, 12)}…` : "—"}
                </dd>
                <dt>Extraction</dt>
                <dd>{s.extraction.extractionVersion ?? "—"}</dd>
                <dt>Prompt / schema</dt>
                <dd>
                  {s.extraction.promptVersion ?? "—"} · {s.extraction.schemaVersion ?? "—"}
                </dd>
                <dt>Draft pre-fill</dt>
                <dd>{s.extraction.model ? `AI model ${s.extraction.model}` : "Manual entry by analyst"}</dd>
                <dt>Validation</dt>
                <dd>Passed (server-side)</dd>
                <dt>Approved by</dt>
                <dd>
                  {s.approvedBy} · {localDateTime(s.approvedAt)}
                </dd>
              </dl>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="section-h">Analyst revision history</div>
              <ol className="revs">
                {s.revisions.map((r) => (
                  <li key={r.seq} className={r.kind === "published" ? "" : "draft"}>
                    <b>
                      {r.kind === "published" ? `rev ${r.rev}` : r.kind === "llm_draft" ? "AI draft" : "Analyst edit"} · {r.note ?? ""}
                    </b>
                    <span>
                      {r.by} · {localDateTime(r.at)}
                      {r.changedKeys.length ? ` · changed ${r.changedKeys.map((k) => schema.columns.find((c) => c.key === k)?.label ?? k).join(", ")}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
              <span className="card-sub">{published.length} published revision(s)</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="section-h">Related signals</div>
              {s.related.length === 0 && <span className="card-sub">No related signals.</span>}
              {s.related.map((r) => (
                <button className="related" key={r.id} onClick={() => onOpen(r.id)}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>{r.title}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{r.why}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {formatDate(r.date)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Explicit, two-step deletion of a tracker entry (soft delete, audited). */
function DeleteConfirm({ id, code, title, onCancel, onDeleted }: { id: string; code: string; title: string; onCancel: () => void; onDeleted: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const inv = useInvalidate();
  useEffect(() => ref.current?.focus(), []);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/items/${id}`, { method: "DELETE", json: reason.trim() ? { reason: reason.trim() } : {} });
      toast(`${code} deleted from the tracker`);
      onDeleted();
      await inv();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete");
      setBusy(false);
    }
  };
  return (
    <div className="delete-confirm" role="alertdialog" aria-labelledby="del-title" aria-describedby="del-desc" tabIndex={-1} ref={ref}>
      <b id="del-title">Delete {code} from the tracker?</b>
      <p id="del-desc">
        “{title || code}” will disappear from the Tracker, the Dashboard and exports for everyone, including clients. This can't be undone from the dashboard. Its history and the audit log are kept.
      </p>
      <label className="field">
        <span>Reason (optional, recorded in the audit log)</span>
        <input className="control" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Duplicate entry, published in error" />
      </label>
      {err && (
        <div className="err-msg" role="alert">
          ✕ {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="btn danger confirm" disabled={busy} onClick={submit}>
          {busy ? "Deleting…" : `Delete ${code}`}
        </button>
      </div>
    </div>
  );
}

function ReviseForm({ id, schema, values, onDone }: { id: string; schema: TrackerSchema; values: Record<string, unknown>; onDone: () => void }) {
  const [v, setV] = useState<Record<string, unknown>>(() => ({ ...values, [CORE.competitors]: ((values[CORE.competitors] as string[]) ?? []).join(", ") }));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const submit = async () => {
    setErr(null);
    try {
      await api(`/api/signals/${id}/revise`, { method: "POST", json: { values: normaliseValues(schema, v), note } });
      await inv();
      toast("Published a new revision");
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save");
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="section-h">Revise classification</div>
      {sortedColumns(schema).map((c) => {
        const val = String(v[c.key] ?? "");
        const set = (x: string) => setV((p) => ({ ...p, [c.key]: x, ...(c.type === "macro" ? { [CORE.subtrend]: "" } : {}) }));
        const opts = c.type === "sub" ? subtrendsOf(schema, String(v[CORE.macrotrend] ?? "")) : optionsOf(schema, c);
        return (
          <label className="field" key={c.key}>
            <span>{c.label}</span>
            {c.type === "text" ? (
              <input className="control" value={val} onChange={(e) => set(e.target.value)} />
            ) : c.type === "multi" ? (
              <Combobox multiple label={c.label} options={opts} placeholder="Select…" value={splitMulti(val)} onChange={(list) => set(list.join(", "))} />
            ) : c.type === "date" ? (
              <input className="control" type="date" value={val} onChange={(e) => set(e.target.value)} />
            ) : (
              <Combobox label={c.label} options={opts} placeholder="Select…" pinned={val ? [{ value: "", label: "— Clear —" }] : []} value={val} onChange={set} />
            )}
          </label>
        );
      })}
      <label className="field">
        <span>Reason for revision (required)</span>
        <input className="control" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Impact reclassified after client call" />
      </label>
      {err && (
        <div className="err-msg" role="alert">
          ✕ {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" disabled={!note.trim()} onClick={submit}>
          Publish revision
        </button>
        <button className="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
