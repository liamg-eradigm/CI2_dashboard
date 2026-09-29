import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CORE,
  IN_PROGRESS_STATUSES,
  LOW_CONFIDENCE,
  STATUS_GLYPH,
  STATUS_LABEL,
  can,
  normaliseValues,
  optionsOf,
  sortedColumns,
  subtrendsOf,
  validateValues,
  type ItemStatus,
  type ItemSummary,
  type Me,
  type TrackerSchema,
} from "@eradigm/shared";
import { api, ApiError } from "../api/client";
import { useInvalidate, useItem, useItems, useSchema } from "../api/hooks";
import { ModelOutputTable } from "../components/ModelOutput";
import { SchemaEditor } from "../components/SchemaEditor";
import { SnapshotActions, SnapshotFrame } from "../components/SnapshotFrame";
import { localDateTime, pct } from "../lib/format";
import { useToast } from "../state/toast";

const TABS: { key: string; label: string; statuses: ItemStatus[] }[] = [
  { key: "review", label: "Needs review", statuses: ["needs_review"] },
  { key: "processing", label: "Processing", statuses: [...IN_PROGRESS_STATUSES] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
  { key: "decided", label: "Approved & rejected", statuses: ["approved", "rejected"] },
];
const ALL_STATUSES: ItemStatus[] = ["needs_review", "queued", "fetching", "extracting", "failed", "approved", "rejected"];

export function InboxPage({ me }: { me: Me }) {
  const schema = useSchema();
  const [tab, setTab] = useState("review");
  const [schemaOpen, setSchemaOpen] = useState(false);
  const all = useItems(ALL_STATUSES, true, true);
  const items = all.data ?? [];
  const counts = Object.fromEntries(TABS.map((t) => [t.key, items.filter((i) => t.statuses.includes(i.status)).length]));
  const today = new Date().toISOString().slice(0, 10);
  const approvedToday = items.filter((i) => i.status === "approved" && i.decision?.at.slice(0, 10) === today).length;
  const shown = items.filter((i) => TABS.find((t) => t.key === tab)?.statuses.includes(i.status));
  const s = schema.data;
  const manual = me.features.prefill === "manual";

  return (
    <>
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">
              {counts.review ?? 0} awaiting review · {approvedToday} approved today
            </span>
            <h1 id="page-title">Inbox</h1>
          </div>
          <div className="band-copy">
            {manual
              ? "Each captured source arrives with its tracker fields empty. Open the saved page, enter every field, then approve. Approval validates the entry, records reviewer and time, and publishes a new revision. The saved page and processing history are kept."
              : "Check each tracker draft against its source, edit any field, then approve. Approval validates the entry, records reviewer and time, and publishes a new revision. The source snapshot and processing history are kept."}
          </div>
        </div>
      </section>
      <div className="content" style={{ gap: 14 }}>
        {can(me.role, "schema:edit") && (
          <section className="card flush" aria-labelledby="cols-title">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 18px", flexWrap: "wrap" }}>
              <div>
                <h2 className="card-title" id="cols-title">
                  Tracker columns
                </h2>
                <span className="card-sub">{s ? `${s.columns.length} columns · changes apply to drafts, the Tracker, filters and exports` : ""}</span>
              </div>
              <button className="btn secondary" aria-expanded={schemaOpen} onClick={() => setSchemaOpen((o) => !o)} style={schemaOpen ? { background: "var(--tint)" } : undefined}>
                {schemaOpen ? "Done" : "Edit columns"}
              </button>
            </div>
            {schemaOpen && <SchemaEditor />}
          </section>
        )}

        <div className="seg inbox-tabs" role="group" aria-label="Inbox views" style={{ alignSelf: "flex-start", display: "flex" }}>
          {TABS.map((t) => (
            <button key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)} style={{ padding: "0 14px" }}>
              {t.label} ({counts[t.key] ?? 0})
            </button>
          ))}
        </div>

        {all.isLoading && <div className="skeleton" style={{ height: 120 }} />}
        {all.isError && (
          <div className="banner err" role="alert">
            {(all.error as Error).message}
          </div>
        )}
        {s && shown.map((it) => <InboxCard key={it.id} item={it} schema={s} me={me} />)}
        {s && !all.isLoading && shown.length === 0 && <div className="empty">Nothing here.</div>}
      </div>
    </>
  );
}

type Draft = Record<string, string>;
type DupInfo = { signalCode: string; id: string | null; basis: string | null };
const DUP_BASIS: Record<string, string> = { url: "same URL", file: "same uploaded file", content: "same article text" };
const toDraft = (schema: TrackerSchema, it: ItemSummary): Draft =>
  Object.fromEntries(sortedColumns(schema).map((c) => [c.key, Array.isArray(it.draft[c.key]) ? (it.draft[c.key] as string[]).join(", ") : String(it.draft[c.key] ?? "")]));

function InboxCard({ item, schema, me }: { item: ItemSummary; schema: TrackerSchema; me: Me }) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(schema, item));
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dupConfirm, setDupConfirm] = useState<DupInfo | null>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const detail = useItem(open ? item.id : null);
  const pending = item.status === "needs_review";
  const canReview = can(me.role, "item:review");
  const manual = me.features.prefill === "manual";
  const emptyDraft = pending && sortedColumns(schema).every((c) => item.draft[c.key] == null || item.draft[c.key] === "" || (Array.isArray(item.draft[c.key]) && (item.draft[c.key] as unknown[]).length === 0));

  // Latest version this card knows about, and the values last persisted. Saves
  // are queued so fast data entry never races itself into a version conflict.
  const versionRef = useRef(item.version);
  const savedRef = useRef(JSON.stringify(normaliseValues(schema, item.draft)));
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const bump = (v: number) => {
    versionRef.current = Math.max(versionRef.current, v);
  };

  // Refresh local state only when the server moved beyond what this card saved
  // (another user, a schema rename or a reprocess) — never for our own saves.
  useEffect(() => {
    if (item.version > versionRef.current) {
      setDraft(toDraft(schema, item));
      savedRef.current = JSON.stringify(normaliseValues(schema, item.draft));
      bump(item.version);
    }
  }, [item.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = sortedColumns(schema);
  const values = useMemo(() => normaliseValues(schema, draft), [schema, draft]);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const missingNow = new Set(pending ? validateValues(schema, values, { forApproval: true }).filter((e) => e.code === "required").map((e) => e.key) : []);

  const set = (k: string, v: string) => {
    setDraft((d) => ({ ...d, [k]: v, ...(k === CORE.macrotrend ? { [CORE.subtrend]: "" } : {}) }));
    setErrors((e) => e.filter((x) => x !== k));
  };

  /** Persist analyst edits (recorded as a revision) when a field loses focus. */
  const persist = async () => {
    const v = valuesRef.current;
    const json = JSON.stringify(v);
    if (json === savedRef.current || !pending) return;
    if (validateValues(schema, v, { forApproval: false }).length) return;
    try {
      const r = await api<ItemSummary>(`/api/items/${item.id}/draft`, { method: "PATCH", json: { values: v, version: versionRef.current } });
      savedRef.current = json;
      bump(r.version);
      void inv("items");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMsg(e.message);
        await inv("items");
      }
    }
  };
  const saveDraft = () => {
    chainRef.current = chainRef.current.then(persist);
    return chainRef.current;
  };

  const act = async (path: string, json: unknown, ok: (r: ItemSummary) => string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<ItemSummary>(`/api/items/${item.id}${path}`, { method: path === "" ? "DELETE" : "POST", json });
      bump(r.version);
      toast(ok(r));
      await inv();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "DUPLICATE") {
        // The same source is in the tracker (possibly approved by someone else just now): ask to confirm.
        const dd = err.details as { duplicateOf?: string; duplicateItemId?: string; basis?: string };
        setDupConfirm({ signalCode: dd.duplicateOf ?? "an existing entry", id: dd.duplicateItemId ?? null, basis: dd.basis ?? null });
        await inv("items");
        return;
      }
      if (err.fields?.length) setErrors(err.fields.map((f) => f.key));
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (overrideDuplicate = false) => {
    const errs = validateValues(schema, values, { forApproval: true });
    if (errs.length) {
      setErrors(errs.map((e) => e.key));
      setMsg(`Validation failed. Complete: ${errs.map((e) => e.label).join(", ")}`);
      return;
    }
    // Already in the tracker: never publish a second entry without an explicit confirmation.
    if (!overrideDuplicate && item.duplicateOf) {
      setDupConfirm({ signalCode: item.duplicateOf, id: item.duplicateItemId, basis: item.duplicateBasis });
      return;
    }
    setDupConfirm(null);
    // Let any queued draft save finish first so approval uses the latest version.
    await chainRef.current;
    void act(
      "/approve",
      { values: valuesRef.current, version: versionRef.current, ...(overrideDuplicate ? { overrideDuplicate: true } : {}) },
      (r) => `${r.signalCode} published to the tracker as rev ${r.publishedRev}${overrideDuplicate ? " (duplicate confirmed)" : ""}`,
    );
  };

  const statusTag = item.status === "needs_review" ? "warn" : item.status === "approved" ? "ok" : item.status === "failed" || item.status === "rejected" ? "err" : "info";
  const extraction = item.extraction;

  return (
    <section className={`inbox-card ${item.status}`} aria-labelledby={`t-${item.id}`}>
      <div className="inbox-head">
        <button className="icon-btn" aria-expanded={open} aria-controls={`src-${item.id}`} onClick={() => setOpen((o) => !o)} title={open ? "Hide source" : "View source HTML"} style={open ? { background: "var(--tint)" } : undefined}>
          <span className={`chev ${open ? "open" : ""}`} aria-hidden="true">
            ▶
          </span>
          <span className="sr-only">{open ? "Hide source" : "View source"}</span>
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="inbox-meta">
            <span className="code">{item.code}</span>
            <span aria-hidden="true">·</span>
            <span>{item.outlet ?? "Unknown source"}</span>
            <span aria-hidden="true">·</span>
            <span>Received {localDateTime(item.receivedAt)}</span>
            {item.submittedBy && (
              <>
                <span aria-hidden="true">·</span>
                <span>by {item.submittedBy}</span>
              </>
            )}
            <span className={`tag ${statusTag}`}>
              <span aria-hidden="true">{STATUS_GLYPH[item.status]} </span>
              {STATUS_LABEL[item.status]}
            </span>
            {extraction && pending && (
              <span className="tag warn">
                LLM draft · {item.warningsCount} warning{item.warningsCount === 1 ? "" : "s"}
              </span>
            )}
            {!extraction && emptyDraft && <span className="tag info">Awaiting analyst entry</span>}
            {item.duplicateOf && pending && <span className="tag err">⚠ Duplicate of {item.duplicateOf}</span>}
            {item.attempts > 1 && <span className="tag info">Attempt {item.attempts}</span>}
          </div>
          <div className="inbox-title" id={`t-${item.id}`}>
            {String(item.draft[CORE.title] ?? "") || item.title || item.url || "Untitled submission"}
          </div>
          {item.error && (
            <div className="err-msg" style={{ marginTop: 4 }}>
              <span aria-hidden="true">✕ </span>
              {item.quarantined ? "Quarantined · " : ""}
              {item.error.message}
            </div>
          )}
        </div>
        <div className="inbox-actions">
          {pending && canReview && (
            <>
              <button
                className="btn secondary"
                disabled={busy}
                title={manual ? "Capture the source again · values you entered are kept" : "Run capture and AI pre-fill again"}
                onClick={() => act("/reprocess", { version: versionRef.current }, () => `${item.code} queued for another processing attempt`)}
              >
                ↻ {manual ? "Re-capture" : "Reprocess"}
              </button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt("Reason for rejecting (optional)") ?? undefined;
                  void chainRef.current.then(() => act("/reject", { version: versionRef.current, reason }, () => `${item.code} rejected`));
                }}
              >
                ✕ Reject
              </button>
              <button className="btn" style={{ height: 38, padding: "0 18px", fontSize: 14 }} disabled={busy} onClick={() => void approve()}>
                ✓ Approve
              </button>
            </>
          )}
          {(item.status === "failed" || item.status === "rejected") && canReview && !item.quarantined && (
            <button className="btn secondary" disabled={busy} onClick={() => act("/reprocess", { version: versionRef.current }, () => `${item.code} queued for retry`)}>
              ↻ {item.status === "failed" ? "Retry" : "Reprocess"}
            </button>
          )}
          {(item.status === "failed" || item.status === "rejected") && can(me.role, "item:delete") && (
            <button className="btn danger" disabled={busy} onClick={() => window.confirm(`Delete ${item.code}?`) && act("", undefined, () => `${item.code} deleted`)}>
              Delete
            </button>
          )}
          {item.decision && !pending && (
            <div className={`decided ${item.status === "approved" ? "" : "bad"}`}>
              <b>
                {item.status === "approved" ? `✓ Approved · ${item.signalCode} rev ${item.publishedRev}` : item.status === "rejected" ? "✕ Rejected" : ""}
              </b>
              <span>
                {item.decision.by} · {localDateTime(item.decision.at)}
              </span>
            </div>
          )}
          {IN_PROGRESS_STATUSES.includes(item.status) && <span className="tag info">Processing…</span>}
        </div>
      </div>

      {pending && (dupConfirm || item.duplicateOf) && (
        <DuplicateWarning
          code={item.code}
          dup={dupConfirm ?? { signalCode: item.duplicateOf ?? "", id: item.duplicateItemId, basis: item.duplicateBasis }}
          confirming={!!dupConfirm && canReview}
          busy={busy}
          onCancel={() => setDupConfirm(null)}
          onConfirm={() => void approve(true)}
        />
      )}

      {item.hasSnapshot && !open && pending && (
        <div className="source-hint">
          <button className="link-btn" aria-controls={`src-${item.id}`} aria-expanded={false} onClick={() => setOpen(true)}>
            View saved page
          </button>
          <SnapshotActions itemId={item.id} code={item.code} />
        </div>
      )}

      {open && (
        <div className="source-box" id={`src-${item.id}`}>
          <div className="source-bar">
            <span>{item.url ?? "Uploaded file"}</span>
            <span>
              Saved {localDateTime(item.receivedAt)}
              {detail.data?.publicationDate ? ` · page publication date ${detail.data.publicationDate}` : ""}
            </span>
            {item.hasSnapshot && <SnapshotActions itemId={item.id} code={item.code} />}
          </div>
          {item.hasSnapshot ? (
            <SnapshotFrame itemId={item.id} title={`Saved source for ${item.code}`} height={520} />
          ) : (
            <div className="source-text">
              {detail.isLoading && <div className="skeleton" style={{ height: 80 }} />}
              <div style={{ font: "600 11px var(--sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "#777" }}>{item.outlet} · extracted text (no stored snapshot)</div>
              <div className="h">{detail.data?.title ?? item.title}</div>
              {(detail.data?.bodyText ?? "")
                .split(/\n{2,}/)
                .filter(Boolean)
                .map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
            </div>
          )}
        </div>
      )}

      {(pending || item.status === "approved" || item.status === "rejected") && (
        <div className="draft-wrap">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div className="section-h">
              Tracker draft
              {pending && !extraction && <span className="section-note"> · enter every required field from the saved page</span>}
            </div>
            {extraction && (
              <button className="link-btn" aria-expanded={evidence} onClick={() => setEvidence((e) => !e)}>
                {evidence ? "Hide" : "Show"} evidence & confidence
              </button>
            )}
          </div>
          <div className="table-wrap" style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
            <table className="draft-table" style={{ minWidth: Math.max(1280, cols.length * 140) }}>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} scope="col" id={`h-${item.id}-${c.key}`}>
                      {c.label}
                      {c.required ? "" : " (optional)"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {cols.map((c) => {
                    const v = draft[c.key] ?? "";
                    const ex = extraction?.[c.key];
                    const invalid = errors.includes(c.key);
                    const missing = missingNow.has(c.key);
                    const cls = `dcell ${invalid ? "invalid" : missing ? "missing" : ""}`;
                    const common = {
                      className: cls,
                      disabled: !pending || !canReview,
                      // Explicit name: the column header can be scrolled out of view in the wide draft table.
                      "aria-label": c.label,
                      "aria-invalid": invalid || undefined,
                      "aria-describedby": `n-${item.id}-${c.key}`,
                      onBlur: saveDraft,
                    };
                    const opts = c.type === "sub" ? (draft[CORE.macrotrend] ? subtrendsOf(schema, draft[CORE.macrotrend]) : []) : optionsOf(schema, c);
                    const w = c.type === "date" ? 132 : c.type === "multi" ? 150 : c.type === "macro" ? 170 : c.type === "sub" ? 180 : c.type === "select" ? 132 : undefined;
                    const lowConf = ex?.confidence != null && ex.confidence < LOW_CONFIDENCE;
                    const prov = item.provenance[c.key];
                    return (
                      <td key={c.key} style={{ width: w }}>
                        {c.type === "date" ? (
                          <input type="date" {...common} value={v} onChange={(e) => set(c.key, e.target.value)} />
                        ) : c.type === "text" || c.type === "multi" ? (
                          <input {...common} value={v} onChange={(e) => set(c.key, e.target.value)} placeholder={c.type === "multi" ? "Comma-separated" : ""} style={{ minWidth: c.key === CORE.title ? 220 : 130 }} />
                        ) : (
                          <select {...common} value={v} onChange={(e) => set(c.key, e.target.value)}>
                            <option value="">Select…</option>
                            {opts.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className={`cell-note ${ex?.warnings.length || lowConf ? "w" : ""}`} id={`n-${item.id}-${c.key}`}>
                          {invalid ? (
                            <span style={{ color: "var(--error)" }}>✕ Required</span>
                          ) : missing ? (
                            <span>⚠ Required</span>
                          ) : ex?.confidence != null ? (
                            <span>
                              {lowConf ? "⚠ " : ""}
                              {prov === "analyst" ? "Edited · " : prov === "source" ? "Source · " : "AI · "}
                              {pct(ex.confidence)}
                            </span>
                          ) : prov === "analyst" ? (
                            <span>Edited</span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          {msg && (
            <div className="err-msg" role="alert">
              <b>✕ {msg}</b>
            </div>
          )}
          {evidence && extraction && <ModelOutputTable schema={schema} extraction={extraction} caption={`Model evidence for ${item.code}`} />}
          {pending && item.modelWarnings.length > 0 && (
            <div className="cell-note w" style={{ fontSize: 12 }}>
              ⚠ {item.modelWarnings.join(" · ")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** A very visible warning that the same source is already in the tracker, with an explicit override at approval. */
function DuplicateWarning({ code, dup, confirming, busy, onCancel, onConfirm }: { code: string; dup: DupInfo; confirming: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) ref.current?.focus();
  }, [confirming]);
  const why = dup.basis ? DUP_BASIS[dup.basis] ?? "same source" : "same source";
  return (
    <div ref={ref} tabIndex={-1} className={`dup-warning ${confirming ? "confirming" : ""}`} role={confirming ? "alertdialog" : "note"} aria-labelledby={`dup-${code}`} aria-describedby={`dup-d-${code}`}>
      <div className="dup-icon" aria-hidden="true">
        ⚠
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <b id={`dup-${code}`}>{confirming ? `Duplicate — ${dup.signalCode} is already in the tracker` : `Possible duplicate of ${dup.signalCode}, which is already in the tracker`}</b>
        <p id={`dup-d-${code}`}>
          {code} has the {why} as {dup.signalCode}.{" "}
          {confirming ? "Approving it anyway will publish a second, separate tracker entry. Only do this if it is genuinely a different update." : "You will be asked to confirm before it can be approved."}{" "}
          {dup.id && (
            <Link to={`/tracker?signal=${encodeURIComponent(dup.id)}`} target="_blank" rel="noopener">
              Open {dup.signalCode} in the Tracker ↗
            </Link>
          )}
        </p>
        {confirming && (
          <div className="dup-actions">
            <button className="btn secondary" disabled={busy} onClick={onCancel}>
              Cancel — don't approve
            </button>
            <button className="btn danger" disabled={busy} onClick={onConfirm}>
              Approve anyway (override duplicate)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
