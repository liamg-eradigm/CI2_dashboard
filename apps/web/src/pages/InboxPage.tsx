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
  AUTO_KEYS,
  SOURCE_TIER,
  STREAM_LABEL,
  FIELDS,
  autoRecordId,
  flattenKiqs,
  kiqsFromValues,
  withKiq,
  optionsOf,
  sortedColumns,
  splitMulti,
  subtrendsOf,
  validateValues,
  type ClearDecidedResult,
  type ItemComment,
  type KiqTopic,
  type ItemStatus,
  type ItemSummary,
  type Me,
  type Stream,
  type TrackerSchema,
  primarySourceKey,
} from "@eradigm/shared";
import { api, ApiError } from "../api/client";
import { useComments, useInvalidate, useItem, useItems, usePrimarySources, useSchema } from "../api/hooks";
import { StreamSwitch } from "../components/StreamSwitch";
import { CommentsMargin, useCommentNumbers } from "../components/Comments";
import { RICH_HINT, RichTextField } from "../components/RichTextField";
import { KIQ_KEYS, KiqEditor, kiqFieldLabel } from "../components/KiqEditor";
import { Combobox } from "../components/Combobox";
import { ModelOutputTable } from "../components/ModelOutput";
import { PriorFlag } from "../components/PriorFlag";
import { SchemaEditor, TableColumnsEditor } from "../components/SchemaEditor";
import { SnapshotActions, SnapshotFrame } from "../components/SnapshotFrame";
import { localDateTime, pct } from "../lib/format";
import { useToast } from "../state/toast";
import { ENTRY_TITLE, EntryTitleInput, SizedHeading, TextSizeButtons } from "../components/TextSize";


/** The approved entry in its Tracker (searched for; the default dates cover every entry). */
function trackerLink(item: ItemSummary): string {
  const p = new URLSearchParams({ signal: item.id });
  p.set("stream", item.stream);
  // Search for it too, so the table behind the record shows exactly this entry.
  const title = String(item.draft[CORE.title] ?? "").trim();
  if (title) p.set("q", title.slice(0, 200));
  return `/tracker?${p.toString()}`;
}

const TABS: { key: string; label: string; statuses: ItemStatus[]; withClient?: boolean }[] = [
  { key: "review", label: "Needs review", statuses: ["needs_review"], withClient: false },
  { key: "client", label: "With client", statuses: ["needs_review"], withClient: true },
  { key: "processing", label: "Processing", statuses: [...IN_PROGRESS_STATUSES] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
  { key: "decided", label: "Pushed & Rejected", statuses: ["approved", "rejected"] },
];
const ALL_STATUSES: ItemStatus[] = ["needs_review", "queued", "fetching", "extracting", "failed", "approved", "rejected"];
const inTab = (t: (typeof TABS)[number], i: ItemSummary) => t.statuses.includes(i.status) && (t.withClient == null || t.withClient === i.withClient);
const STREAM_FILTER: [Stream | "all", string][] = [
  ["all", "All"],
  ["secondary", "Secondary"],
  ["primary", "Primary"],
];

/**
 * The Eradigm Inbox: one inbox for both trackers. Each entry shows its own
 * tracker's fields. Reject, Send to Client (to the Client Inbox) or Push to
 * Tracker (approve).
 */
export function InboxPage({ me }: { me: Me }) {
  const primary = useSchema("primary");
  const secondary = useSchema("secondary");
  const [tab, setTab] = useState("review");
  const [show, setShow] = useState<Stream | "all">("all");
  const [schemaOpen, setSchemaOpen] = useState(false);
  // The column editor works on one tracker at a time (Secondary first; it follows the Primary / Secondary view).
  const [colStream, setColStream] = useState<Stream>("secondary");
  useEffect(() => {
    if (show !== "all") setColStream(show);
  }, [show]);
  const all = useItems(ALL_STATUSES, true, true);
  const items = (all.data ?? []).filter((i) => show === "all" || i.stream === show);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, items.filter((i) => inTab(t, i)).length]));
  const today = new Date().toISOString().slice(0, 10);
  const approvedToday = items.filter((i) => i.status === "approved" && i.decision?.at.slice(0, 10) === today).length;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0]!;
  const shown = items.filter((i) => inTab(current, i));
  const schemaOf = (st: Stream) => (st === "primary" ? primary.data : secondary.data);
  const s = schemaOf(colStream);
  const manual = me.features.prefill === "manual";

  return (
    <>
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">
              {counts.review ?? 0} awaiting review · {counts.client ?? 0} with the client · {approvedToday} pushed today
            </span>
            <h1 id="page-title">Eradigm Inbox</h1>
          </div>
          <div className="band-copy">
            {manual
              ? "Primary and Secondary entries in one place, each with its own fields. Fill in every field from the saved page, then Push to Tracker, Send to Client for them to check and comment, or Reject."
              : "Primary and Secondary entries in one place, each with its own fields. Check each draft against its source, then Push to Tracker, Send to Client for them to check and comment, or Reject."}
          </div>
        </div>
      </section>
      <div className="content" style={{ gap: 14 }}>
        <div className="stream-bar">
          <div className="seg" role="group" aria-label="Show entries from" style={{ display: "flex" }}>
            {STREAM_FILTER.map(([k, label]) => (
              <button key={k} aria-pressed={show === k} onClick={() => setShow(k)} style={{ padding: "0 14px" }}>
                {label}
              </button>
            ))}
          </div>
          <span className="stream-note">Primary and Secondary sources arrive in this one inbox; pushed entries go to their own Tracker.</span>
        </div>
        {can(me.role, "schema:edit") && (
          <section className="card flush" aria-labelledby="cols-title">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 18px", flexWrap: "wrap" }}>
              <div>
                <h2 className="card-title" id="cols-title">
                  Columns · {STREAM_LABEL[colStream]}
                </h2>
                <span className="card-sub">
                  {s
                    ? `${s.columns.length} Inbox columns · ${s.columns.filter((c) => c.inTracker).length} in the Tracker · ${s.columns.filter((c) => c.inPhantoms).length} in Phantoms · changes apply to ${STREAM_LABEL[colStream]} entries only`
                    : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <StreamSwitch noun="columns" value={colStream} onChange={setColStream} label="Columns of" />
                <button className="btn secondary" aria-expanded={schemaOpen} onClick={() => setSchemaOpen((o) => !o)} style={schemaOpen ? { background: "var(--tint)" } : undefined}>
                  {schemaOpen ? "Done" : "Edit columns"}
                </button>
              </div>
            </div>
            {schemaOpen && (
              <>
                <div className="cols-section-h" id="cols-inbox">
                  <h3>{STREAM_LABEL[colStream]} Inbox columns</h3>
                  <span>Every field of an entry: names, types, dropdown options and whether approval requires it. One input fills all of them.</span>
                </div>
                <SchemaEditor key={colStream} stream={colStream} />
                <div className="cols-section-h" id="cols-tracker">
                  <h3>{STREAM_LABEL[colStream]} Tracker columns</h3>
                  <span>The columns of the Tracker table, filters and exports, chosen from the Inbox columns.</span>
                </div>
                <TableColumnsEditor key={`t-${colStream}`} stream={colStream} table="tracker" />
                <div className="cols-section-h" id="cols-phantoms">
                  <h3>{STREAM_LABEL[colStream]} Phantoms columns</h3>
                  <span>The columns of the Phantoms table and its exports, chosen from the Inbox columns. The Markdown files are not affected.</span>
                </div>
                <TableColumnsEditor key={`p-${colStream}`} stream={colStream} table="phantoms" />
              </>
            )}
          </section>
        )}

        <div className="inbox-tabs-row">
          <div className="seg inbox-tabs" role="group" aria-label="Inbox views" style={{ display: "flex", flexWrap: "wrap" }}>
            {TABS.map((t) => (
              <button key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)} style={{ padding: "0 14px" }}>
                {t.label} ({counts[t.key] ?? 0})
              </button>
            ))}
          </div>
          {tab === "decided" && can(me.role, "item:delete") && shown.length > 0 && <DeleteAll shown={shown} stream={show} />}
        </div>

        {all.isLoading && <div className="skeleton" style={{ height: 120 }} />}
        {all.isError && (
          <div className="banner err" role="alert">
            {(all.error as Error).message}
          </div>
        )}
        {shown.map((it) => {
          const sch = schemaOf(it.stream);
          return sch ? <InboxCard key={it.id} item={it} schema={sch} me={me} /> : null;
        })}
        {!all.isLoading && shown.length === 0 && <div className="empty">{tab === "client" ? "Nothing is with the client." : "Nothing here."}</div>}
      </div>
    </>
  );
}

/**
 * "Delete All" in Pushed & Rejected: rejected entries are deleted; pushed
 * entries leave the Inbox but stay in the Tracker and Phantoms. Follows the
 * "Show entries from" filter.
 */
function DeleteAll({ shown, stream }: { shown: ItemSummary[]; stream: Stream | "all" }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const inv = useInvalidate();
  const rejected = shown.filter((i) => i.status === "rejected").length;
  const pushed = shown.length - rejected;
  const run = async () => {
    const scope = stream === "all" ? "" : ` ${STREAM_LABEL[stream]}`;
    const parts = [
      rejected ? `${rejected} rejected entr${rejected === 1 ? "y is" : "ies are"} deleted.` : "",
      pushed ? `${pushed} pushed entr${pushed === 1 ? "y leaves" : "ies leave"} the Inbox but stay${pushed === 1 ? "s" : ""} in the Tracker and Phantoms.` : "",
    ].filter(Boolean);
    if (!window.confirm(`Delete all${scope} entries in Pushed & Rejected?\n\n${parts.join("\n")}`)) return;
    setBusy(true);
    try {
      const r = await api<ClearDecidedResult>("/api/items/clear-decided", { method: "POST", json: stream === "all" ? {} : { stream } });
      toast(`Pushed & Rejected cleared · ${r.rejectedDeleted} deleted · ${r.pushedCleared} pushed entr${r.pushedCleared === 1 ? "y" : "ies"} kept in the Tracker`);
      await inv("items");
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn danger" disabled={busy} onClick={() => void run()} data-testid="delete-all">
      🗑 Delete All
    </button>
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
  // Primary: the Insight Topics and their Key Intelligence Questions (one Tracker entry each).
  const primary = item.stream === "primary";
  const [kiqs, setKiqs] = useState<KiqTopic[]>(() => item.kiqs ?? kiqsFromValues(item.draft));
  const kiqsRef = useRef(kiqs);
  kiqsRef.current = kiqs;
  const [errors, setErrors] = useState<string[]>([]);
  const [fieldMsg, setFieldMsg] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dupConfirm, setDupConfirm] = useState<DupInfo | null>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const detail = useItem(open ? item.id : null);
  const pending = item.status === "needs_review";
  const canReview = can(me.role, "item:review");
  // With the client: read-only here until they send it back (or it is recalled).
  const withClient = pending && item.withClient;
  const actionable = pending && !item.withClient;
  const comments = useComments(item.id, item.comments > 0 || !!item.returnedByClient);
  const allComments = comments.data ?? [];
  const fieldOrder = useMemo(
    () => [
      ...sortedColumns(schema).map((c) => c.key),
      ...(item.kiqs ?? []).flatMap((t, ti) => [`_kiq.${ti}.topic`, ...t.kiqs.flatMap((_, ki) => ["question", "details", "metrics"].map((p) => `_kiq.${ti}.${ki}.${p}`))]),
      "_text",
    ],
    [schema, item.kiqs],
  );
  const { numberOf } = useCommentNumbers(allComments, fieldOrder);
  const openOn = (k: string) => allComments.filter((c) => c.field === k && !c.resolved).length;
  /** Jump to a comment's words in its field. */
  const showComment = (c: ItemComment) => {
    const el = document.getElementById(`f-${item.id}-${c.field}`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus();
    const i = "setSelectionRange" in el ? el.value.indexOf(c.quote) : -1;
    if (i >= 0) el.setSelectionRange(i, i + c.quote.length);
  };
  const manual = me.features.prefill === "manual";
  // A blank entry typed in from scratch (Input → Manual entry): no source file to view or re-capture.
  const typedIn = item.inputType === "manual";
  const emptyDraft = pending && sortedColumns(schema).filter((c) => !AUTO_KEYS.includes(c.key)).every((c) => item.draft[c.key] == null || item.draft[c.key] === "" || (Array.isArray(item.draft[c.key]) && (item.draft[c.key] as unknown[]).length === 0));

  // Latest version this card knows about, and the values last persisted. Saves
  // are queued so fast data entry never races itself into a version conflict.
  const versionRef = useRef(item.version);
  const savedRef = useRef(JSON.stringify([normaliseValues(schema, item.draft), primary ? (item.kiqs ?? null) : null]));
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const bump = (v: number) => {
    versionRef.current = Math.max(versionRef.current, v);
  };

  // Refresh local state only when the server moved beyond what this card saved
  // (another user, a schema rename or a reprocess) — never for our own saves.
  useEffect(() => {
    if (item.version > versionRef.current) {
      setDraft(toDraft(schema, item));
      if (primary) setKiqs(item.kiqs ?? kiqsFromValues(item.draft));
      savedRef.current = JSON.stringify([normaliseValues(schema, item.draft), primary ? (item.kiqs ?? null) : null]);
      bump(item.version);
    }
  }, [item.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ID is filled in automatically, and Primary topics and questions have their own editor.
  const cols = sortedColumns(schema).filter((c) => c.key !== FIELDS.id && !(primary && KIQ_KEYS.includes(c.key)));
  const hasId = schema.columns.some((c) => c.key === FIELDS.id);
  const values = useMemo(() => {
    let v = normaliseValues(schema, draft);
    if (primary) v = withKiq(v, flattenKiqs(kiqs)[0]);
    const id = autoRecordId(item.stream, v);
    return hasId ? { ...v, [FIELDS.id]: id } : v;
  }, [schema, draft, kiqs, primary, item.stream, hasId]);
  const autoId = hasId ? (values[FIELDS.id] as string | null) : null;
  // Primary: the same source (Source Role + Source Company) as entries already in the Tracker (request 27).
  const sources = usePrimarySources(primary && pending);
  const sourceKey = primary && pending ? primarySourceKey(values[FIELDS.sourceRole], values[FIELDS.sourceCompany]) : null;
  const prior = sourceKey ? (sources.data ?? []).filter((x) => x.key === sourceKey) : [];
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const missingNow = new Set(actionable ? validateValues(schema, values, { forApproval: true }).filter((e) => e.code === "required").map((e) => e.key) : []);

  const set = (k: string, v: string) => {
    setDraft((d) => ({ ...d, [k]: v, ...(k === CORE.macrotrend ? { [CORE.subtrend]: "" } : {}) }));
    setErrors((e) => e.filter((x) => x !== k));
  };

  /** Persist analyst edits (recorded as a revision) when a field loses focus. */
  const persist = async () => {
    const v = valuesRef.current;
    const k = primary ? kiqsRef.current : null;
    const json = JSON.stringify([v, k]);
    if (json === savedRef.current || !actionable) return;
    if (validateValues(schema, v, { forApproval: false }).length) return;
    try {
      const r = await api<ItemSummary>(`/api/items/${item.id}/draft`, { method: "PATCH", json: { values: v, version: versionRef.current, ...(k ? { kiqs: k } : {}) } });
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
      if (err.fields?.length) {
        setErrors(err.fields.map((f) => f.key));
        setFieldMsg(Object.fromEntries(err.fields.map((f) => [f.key, f.code === "required" ? "Required" : f.code === "duplicate_id" ? "Already used" : "Check this value"])));
      }
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (overrideDuplicate = false) => {
    // Primary: one Tracker entry per Key Intelligence Question (none entered: one entry, as before).
    const rows = primary ? flattenKiqs(kiqs) : [];
    // The ID's parts are checked instead of the (hidden) ID itself.
    const errs = validateValues(schema, values, { forApproval: true }).filter((e) => e.key !== FIELDS.id);
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
    if (rows.length > 1) return void pushEach(rows.length, overrideDuplicate);
    void act(
      "/approve",
      { values: valuesRef.current, version: versionRef.current, ...(overrideDuplicate ? { overrideDuplicate: true } : {}) },
      (r) =>
        `${r.signalCode} published to the tracker as rev ${r.publishedRev}${overrideDuplicate ? " (duplicate confirmed)" : ""}`,
    );
  };

  /**
   * Several Key Intelligence Questions: save, split into one Inbox entry per
   * question (this one keeps the first), then push each to the Tracker.
   */
  const pushEach = async (n: number, overrideDuplicate: boolean) => {
    if (!window.confirm(`Push ${n} Tracker entries, one per Key Intelligence Question? Every other field is shared.`)) return;
    setBusy(true);
    setMsg(null);
    let done = 0;
    try {
      await saveDraft();
      const parts = await api<ItemSummary[]>(`/api/items/${item.id}/split`, { method: "POST", json: { version: versionRef.current, kiqs: kiqsRef.current } });
      for (const [i, p] of parts.entries()) {
        await api<ItemSummary>(`/api/items/${p.id}/approve`, { method: "POST", json: { values: p.draft, version: p.version, ...(i === 0 && overrideDuplicate ? { overrideDuplicate: true } : {}) } });
        done++;
      }
      toast(`${done} Tracker entries pushed from ${item.code}, one per Key Intelligence Question`);
    } catch (e) {
      const err = e as ApiError;
      setMsg(done ? `${done} of ${n} entries pushed; the rest stay in the Inbox as separate entries: ${err.message}` : err.message);
      if (err.code === "DUPLICATE") setDupConfirm({ signalCode: (err.details as { duplicateOf?: string })?.duplicateOf ?? "an existing entry", id: null, basis: null });
    } finally {
      setBusy(false);
      await inv();
    }
  };

  const statusTag = item.status === "needs_review" ? "warn" : item.status === "approved" ? "ok" : item.status === "failed" || item.status === "rejected" ? "err" : "info";
  const extraction = item.extraction;

  return (
    <section className={`inbox-card ${item.status}`} aria-labelledby={`t-${item.id}`}>
      <div className="inbox-head">
        {typedIn ? (
          <span className="icon-btn manual-glyph" title="Manual entry · no source file" aria-hidden="true">
            ✎
          </span>
        ) : (
          <button className="icon-btn" aria-expanded={open} aria-controls={`src-${item.id}`} onClick={() => setOpen((o) => !o)} title={open ? "Hide source" : "View source HTML"} style={open ? { background: "var(--tint)" } : undefined}>
            <span className={`chev ${open ? "open" : ""}`} aria-hidden="true">
              ▶
            </span>
            <span className="sr-only">{open ? "Hide source" : "View source"}</span>
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="inbox-meta">
            <span className="code">{item.code}</span>
            <span className={`tag ${item.stream === "primary" ? "info" : "ok"}`} data-testid="stream-tag">
              {STREAM_LABEL[item.stream]}
            </span>
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
            {prior.length > 0 && (
              <span className="tag info" data-testid="prior-tag">
                🔗 Prior primary information
              </span>
            )}
            {item.attempts > 1 && <span className="tag info">Attempt {item.attempts}</span>}
            {withClient && item.sentToClient && (
              <span className="tag info">
                ↗ With the client · sent by {item.sentToClient.by} {localDateTime(item.sentToClient.at)}
              </span>
            )}
            {actionable && item.returnedByClient && (
              <span className="tag warn">
                ↩ Back from {item.returnedByClient.by} · {localDateTime(item.returnedByClient.at)}
              </span>
            )}
            {item.comments > 0 && <span className="tag warn">💬 {item.comments} open comment{item.comments === 1 ? "" : "s"}</span>}
          </div>
          <SizedHeading as="div" className="inbox-title" id={`t-${item.id}`} sizeKey={ENTRY_TITLE} label="entry titles" rowClassName="inbox-title-row">
            {String(item.draft[CORE.title] ?? "") || item.title || item.url || "Untitled submission"}
          </SizedHeading>
          {hasId && (pending || item.status === "approved") && (
            <div className="auto-id" data-testid="auto-id">
              <b>ID</b>
              {(item.status === "approved" ? (item.draft[FIELDS.id] as string | null) : autoId) ??
                `filled in once ${primary ? "Event Date, Competitors and a Key Intelligence Question" : "Event Date, Competitors and Title"} are entered`}
            </div>
          )}
          {item.error && (
            <div className="err-msg" style={{ marginTop: 4 }}>
              <span aria-hidden="true">✕ </span>
              {item.quarantined ? "Quarantined · " : ""}
              {item.error.message}
            </div>
          )}
        </div>
        <div className="inbox-actions">
          {withClient && canReview && (
            <button className="btn secondary" disabled={busy} onClick={() => act("/recall", { version: versionRef.current }, () => `${item.code} recalled from the Client Inbox`)} title="Take it back without waiting for the client">
              ↙ Recall from client
            </button>
          )}
          {actionable && canReview && (
            <>
              {!typedIn && (
                <button
                  className="btn secondary"
                  disabled={busy}
                  title={manual ? "Capture the source again · values you entered are kept" : "Run capture and AI pre-fill again"}
                  onClick={() => act("/reprocess", { version: versionRef.current }, () => `${item.code} queued for another processing attempt`)}
                >
                  ↻ {manual ? "Re-capture" : "Reprocess"}
                </button>
              )}
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
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => void chainRef.current.then(() => act("/send-to-client", { version: versionRef.current }, () => `${item.code} sent to the Client Inbox`))}
                title="Send it to the client to check and comment on"
              >
                ↗ Send to Client
              </button>
              <button className="btn" style={{ height: 38, padding: "0 18px", fontSize: 14 }} disabled={busy} onClick={() => void approve()}>
                ✓ Push to Tracker
              </button>
            </>
          )}
          {(item.status === "failed" || item.status === "rejected") && canReview && !item.quarantined && !typedIn && (
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
                {item.status === "approved" ? `✓ Pushed to Tracker · ${item.signalCode} rev ${item.publishedRev}` : item.status === "rejected" ? "✕ Rejected" : ""}
              </b>
              <span>
                {item.decision.by} · {localDateTime(item.decision.at)}
              </span>
              {item.status === "approved" && (
                <Link className="link-btn decided-link" to={trackerLink(item)}>
                  View in Tracker →
                </Link>
              )}
            </div>
          )}
          {IN_PROGRESS_STATUSES.includes(item.status) && <span className="tag info">Processing…</span>}
        </div>
      </div>

      {actionable && (dupConfirm || item.duplicateOf) && (
        <DuplicateWarning
          code={item.code}
          dup={dupConfirm ?? { signalCode: item.duplicateOf ?? "", id: item.duplicateItemId, basis: item.duplicateBasis }}
          confirming={!!dupConfirm && canReview}
          busy={busy}
          onCancel={() => setDupConfirm(null)}
          onConfirm={() => void approve(true)}
        />
      )}

      {prior.length > 0 && <PriorFlag code={item.code} role={String(values[FIELDS.sourceRole] ?? "")} company={String(values[FIELDS.sourceCompany] ?? "")} prior={prior} />}

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
              {pending && !extraction && <span className="section-note">{typedIn ? " · manual entry: fill in every required field (attach the HTML later from the tracker if you have it)" : " · enter every required field from the saved page"}</span>}
            </div>
            {extraction && (
              <button className="link-btn" aria-expanded={evidence} onClick={() => setEvidence((e) => !e)}>
                {evidence ? "Hide" : "Show"} evidence & confidence
              </button>
            )}
          </div>
          {allComments.length > 0 && (
            <CommentsMargin
              itemId={item.id}
              comments={allComments}
              labelOf={(f) => (f === "_text" ? "Page text" : (kiqFieldLabel(f, schema) ?? schema.columns.find((c) => c.key === f)?.label ?? f))}
              numberOf={numberOf}
              canResolve={canReview}
              onShow={showComment}
              title="Client comments"
            />
          )}
          {actionable && (primary || cols.some((c) => c.type === "long")) && <div className="list-hint">{RICH_HINT}</div>}
          <div className="draft-grid" role="group" aria-label={`Tracker fields for ${item.code}`}>
            {cols.map((c) => {
              const v = draft[c.key] ?? "";
              const ex = extraction?.[c.key];
              const invalid = errors.includes(c.key);
              const missing = missingNow.has(c.key);
              const auto = AUTO_KEYS.includes(c.key);
              const cls = `dcell ${invalid ? "invalid" : missing ? "missing" : ""}`;
              const common = {
                id: `f-${item.id}-${c.key}`,
                className: cls,
                disabled: !actionable || !canReview,
                "aria-label": c.label,
                "aria-invalid": invalid || undefined,
                "aria-describedby": `n-${item.id}-${c.key}`,
                onBlur: saveDraft,
              };
              const opts = c.type === "sub" ? (draft[CORE.macrotrend] ? subtrendsOf(schema, draft[CORE.macrotrend]) : []) : optionsOf(schema, c);
              const lowConf = ex?.confidence != null && ex.confidence < LOW_CONFIDENCE;
              const prov = item.provenance[c.key];
              const span = c.type === "long" ? "full" : c.key === CORE.title ? "wide" : "";
              const titleBox = c.key === CORE.title && c.type === "text" && !auto;
              return (
                <div key={c.key} className={`dfield ${span}`}>
                  {/* Request 47: A− / A+ beside the Title's label size every entry's title. */}
                  <div className={titleBox ? "ts-label-row" : "ts-plain"}>
                    <span className="dlabel" id={`h-${item.id}-${c.key}`}>
                      {c.label}
                      {auto ? " (automatic)" : c.required ? "" : " (optional)"}
                      {openOn(c.key) > 0 && (
                        <span className="dlabel-c" title="Open client comments on this field">
                          {" "}
                          💬 {openOn(c.key)}
                        </span>
                      )}
                    </span>
                    {titleBox && actionable && canReview && <TextSizeButtons sizeKey={ENTRY_TITLE} label="entry titles" />}
                  </div>
                  {auto ? (
                    <input className="dcell auto" aria-label={c.label} readOnly value={SOURCE_TIER[item.stream]} aria-describedby={`n-${item.id}-${c.key}`} />
                  ) : c.type === "date" ? (
                    <input type="date" {...common} value={v} onChange={(e) => set(c.key, e.target.value)} />
                  ) : c.type === "long" ? (
                    <RichTextField {...common} className={`${cls} long`} rows={4} value={v} onValueChange={(x) => set(c.key, x)} />
                  ) : titleBox ? (
                    <EntryTitleInput {...common} value={v} onChange={(e) => set(c.key, e.target.value)} />
                  ) : c.type === "text" ? (
                    <input {...common} value={v} onChange={(e) => set(c.key, e.target.value)} />
                  ) : c.type === "multi" ? (
                    <Combobox
                      multiple
                      className={cls}
                      label={c.label}
                      disabled={common.disabled}
                      invalid={invalid}
                      describedBy={common["aria-describedby"]}
                      placeholder="Select…"
                      options={opts}
                      value={splitMulti(v)}
                      onChange={(list) => set(c.key, list.join(", "))}
                      onBlur={saveDraft}
                    />
                  ) : (
                    <Combobox
                      className={cls}
                      label={c.label}
                      disabled={common.disabled}
                      invalid={invalid}
                      describedBy={common["aria-describedby"]}
                      placeholder={c.type === "sub" && !draft[CORE.macrotrend] ? "Choose a macrotrend first" : "Select…"}
                      options={opts}
                      pinned={v ? [{ value: "", label: "— Clear —" }] : []}
                      value={v}
                      onChange={(x) => set(c.key, x)}
                      onBlur={saveDraft}
                    />
                  )}
                  <div className={`cell-note ${ex?.warnings.length || lowConf ? "w" : ""}`} id={`n-${item.id}-${c.key}`}>
                    {invalid ? (
                      <span style={{ color: "var(--error)" }}>✕ {fieldMsg[c.key] ?? "Required"}</span>
                    ) : missing ? (
                      <span>⚠ Required</span>
                    ) : auto ? (
                      <span>Set from the {STREAM_LABEL[item.stream]} Source</span>
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
                </div>
              );
            })}
            {primary && (
              <KiqEditor
                idPrefix={`f-${item.id}`}
                schema={schema}
                topics={kiqs}
                disabled={!actionable || !canReview}
                invalid={errors.includes(FIELDS.keyQuestion)}
                onChange={(t) => {
                  setKiqs(t);
                  setErrors((e) => e.filter((x) => x !== FIELDS.keyQuestion));
                }}
                onBlur={() => void saveDraft()}
                openOn={openOn}
              />
            )}
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
