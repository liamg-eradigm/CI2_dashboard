import { useEffect, useRef, useState } from "react";
import { AUTO_KEYS, CORE, STREAM_LABEL, can, displayValue, normaliseValues, optionsOf, sortedColumns, splitMulti, subtrendsOf, type Me, type SignalDetail, type TrackerSchema } from "@eradigm/shared";
import { api, ApiError } from "../api/client";
import { useInvalidate, useSchema, useSignal } from "../api/hooks";
import { useToast } from "../state/toast";
import { formatDate, localDateTime, pct } from "../lib/format";
import { Combobox } from "./Combobox";
import { DeleteEntries, type DeleteTable } from "./DeleteEntries";
import { LinkedPanes } from "./LinkedPanes";
import { RICH_HINT, RichTextField } from "./RichTextField";
import { RichText } from "./BulletText";
import { SnapshotFrame } from "./SnapshotFrame";

const PROV: Record<string, string> = { source: "From source", ai: "AI suggested", analyst: "Analyst" };

export function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Already handled by a field (e.g. Tab indenting a bullet, or Esc releasing it).
      if (e.defaultPrevented) return;
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

export function RecordDrawer({
  id,
  schema: pageSchema,
  me,
  table,
  startEditing = false,
  editable = true,
  onClose,
  onOpen,
}: {
  id: string;
  schema: TrackerSchema;
  me: Me;
  /** The table the drawer was opened from; deleting then offers "that table only". None on the Dashboard. */
  table?: DeleteTable;
  /** Open straight into the edit form (from an Edit button). */
  startEditing?: boolean;
  /** Whether Edit is offered (Phantoms are an evergreen snapshot and are never edited). */
  editable?: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const sig = useSignal(id);
  // The entry's own inbox column set (the Dashboard page passes the merged one).
  const own = useSchema(sig.data?.stream ?? "primary");
  const schema = own.data ?? pageSchema;
  const ref = useFocusTrap(true, onClose);
  // Opened from an Edit button: start in the edit form.
  const [editing, setEditing] = useState(startEditing);
  const [deleting, setDeleting] = useState(false);
  const s = sig.data;
  const canRevise = editable && can(me.role, "item:edit");
  // Admins and analysts only (the API enforces the same rule).
  const canDelete = can(me.role, "item:delete");
  // A Primary entry linked to others from the same source: shown side by side with its earlier (or later) entry.
  const linked = !!s && !!(s.linkedEarlier || s.linkedLater);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className={`drawer${linked && !editing && !deleting ? " linked-drawer" : ""}`} role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={ref}>
        <div className="drawer-head">
          <div className="drawer-meta">
            <span className="mono" style={{ color: "var(--ink)" }}>
              {s?.code ?? "…"}
            </span>
            {s && (
              <>
                <span>·</span>
                <span>{STREAM_LABEL[s.stream]} Tracker</span>
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
                ✎ Edit
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
        {s && linked && !editing && !deleting && (
          <LinkedPanes
            opened={s}
            render={(x, titleId) => <RecordView s={x} schema={schema} me={me} onOpen={onOpen} titleId={titleId} />}
          />
        )}
        {s && (!linked || editing || deleting) && (
          <div className="drawer-body">
            {deleting && (
              <DeleteEntries
                table={table}
                entries={[{ id: s.id, code: s.code, title: String(s.values[CORE.title] ?? "") }]}
                onCancel={() => setDeleting(false)}
                onDone={(ids) => (ids.length ? onClose() : undefined)}
              />
            )}
            {editing ? (
              <>
                <h2 id="drawer-title" style={{ font: "700 20px/1.3 var(--sans)", textWrap: "pretty" }}>
                  {String(s.values[CORE.title] ?? "")}
                </h2>
                {/* Editing: the fields first, then the page text to check them against (no saved-page window). */}
                <EditForm id={id} code={s.code} schema={schema} values={s.values} onDone={() => setEditing(false)} />
                <div className="edit-source" data-testid="edit-source-text">
                  <div className="section-h">Text of the saved page</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)", whiteSpace: "pre-line" }}>{s.text || "No text was captured for this entry."}</div>
                </div>
              </>
            ) : linked ? null : (
              <RecordView s={s} schema={schema} me={me} onOpen={onOpen} titleId="drawer-title" />
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** An approved entry's record: title, page text, classifications, long fields, sources, provenance, history and related signals. */
function RecordView({ s, schema, me, onOpen, titleId }: { s: SignalDetail; schema: TrackerSchema; me: Me; onOpen: (id: string) => void; titleId: string }) {
  const cols = sortedColumns(schema);
  const published = s.revisions.filter((r) => r.kind === "published");
  return (
    <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 id={titleId} style={{ font: "700 20px/1.3 var(--sans)", textWrap: "pretty" }}>
                {String(s.values[CORE.title] ?? "")}
              </h2>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)", whiteSpace: "pre-line" }}>{s.text}</div>
            </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="section-h">Classifications</div>
                <div className="cls-grid">
                  {cols
                    .filter((c) => c.key !== CORE.title && c.key !== CORE.competitors && c.type !== "long")
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

            {cols
                .filter((c) => c.type === "long")
                .map((c) => (
                  <div key={c.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="section-h">{c.label}</div>
                    {s.values[c.key] ? <RichText className="rd-long" text={String(s.values[c.key])} /> : <div className="rd-long">—</div>}
                  </div>
                ))}

            <>
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
              </>
            
    </>
  );
}

/**
 * Edit an approved entry, then approve it again: the new version is validated
 * like an approval and published as a new revision, so the Tracker, Phantoms,
 * Markdown, Dashboard and alerts are regenerated from it.
 */
function EditForm({ id, code, schema, values, onDone }: { id: string; code: string; schema: TrackerSchema; values: Record<string, unknown>; onDone: () => void }) {
  const [v, setV] = useState<Record<string, unknown>>(() => ({ ...values, [CORE.competitors]: ((values[CORE.competitors] as string[]) ?? []).join(", ") }));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const inv = useInvalidate();
  const submit = async () => {
    setErr(null);
    setFieldErr({});
    setBusy(true);
    try {
      const r = await api<{ rev: number }>(`/api/signals/${id}/revise`, { method: "POST", json: { values: normaliseValues(schema, v), ...(note.trim() ? { note: note.trim() } : {}) } });
      await inv();
      toast(`${code} pushed to the Tracker again as rev ${r.rev} · its Phantom is unchanged`);
      onDone();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.fields.length ? `${e.fields.length === 1 ? "One field needs" : `${e.fields.length} fields need`} attention before approval.` : e.message);
        setFieldErr(Object.fromEntries(e.fields.map((f) => [f.key, f.message])));
      } else setErr("Could not save");
      setBusy(false);
    }
  };
  return (
    <div className="edit-form" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="section-h">Edit entry</div>
      <p className="card-sub" style={{ margin: 0 }}>
        Change any field, then approve. The new version is checked like a new approval and published as a new revision: the Tracker, Phantoms, Markdown, Dashboard and alerts all update.
      </p>
      {sortedColumns(schema).map((c) => {
        const val = String(v[c.key] ?? "");
        const set = (x: string) => setV((p) => ({ ...p, [c.key]: x, ...(c.type === "macro" ? { [CORE.subtrend]: "" } : {}) }));
        const opts = c.type === "sub" ? subtrendsOf(schema, String(v[CORE.macrotrend] ?? "")) : optionsOf(schema, c);
        const fe = fieldErr[c.key];
        const errId = fe ? `edit-err-${c.key}` : undefined;
        const hintId = `edit-hint-${c.key}`;
        return (
          <label className="field" key={c.key}>
            <span>
              {c.label}
              {c.required ? " *" : ""}
            </span>
            {AUTO_KEYS.includes(c.key) ? (
              <input className="control" value={val} readOnly aria-readonly="true" />
            ) : c.type === "text" ? (
              <input className="control" value={val} onChange={(e) => set(e.target.value)} aria-invalid={!!fe} aria-describedby={errId} />
            ) : c.type === "long" ? (
              <>
                <RichTextField
                  className="control"
                  rows={6}
                  value={val}
                  onValueChange={set}
                  aria-label={c.label}
                  aria-invalid={!!fe}
                  aria-describedby={errId ? `${errId} ${hintId}` : hintId}
                />
                <span className="list-hint" id={hintId}>
                  {RICH_HINT}
                </span>
              </>
            ) : c.type === "multi" ? (
              <Combobox multiple label={c.label} options={opts} placeholder="Select…" value={splitMulti(val)} onChange={(list) => set(list.join(", "))} invalid={!!fe} describedBy={errId} />
            ) : c.type === "date" ? (
              <input className="control" type="date" value={val} onChange={(e) => set(e.target.value)} aria-invalid={!!fe} aria-describedby={errId} />
            ) : (
              <Combobox label={c.label} options={opts} placeholder="Select…" pinned={val ? [{ value: "", label: "— Clear —" }] : []} value={val} onChange={set} invalid={!!fe} describedBy={errId} />
            )}
            {fe && (
              <span className="err-msg field-err" id={errId}>
                ✕ {fe}
              </span>
            )}
          </label>
        );
      })}
      <label className="field">
        <span>Note (optional, kept in the revision history)</span>
        <input className="control" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Impact reclassified after client call" />
      </label>
      {err && (
        <div className="err-msg" role="alert">
          ✕ {err}
        </div>
      )}
      <div className="edit-actions">
        <button className="btn" disabled={busy} onClick={() => void submit()}>
          {busy ? "Pushing…" : "✓ Push to Tracker"}
        </button>
        <button className="btn secondary" disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
