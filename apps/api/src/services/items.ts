/**
 * Intelligence item repository: reads/writes are always scoped by tenant id.
 */
import type {
  Attempt,
  ExtractedFieldView,
  ItemDetail,
  ItemStatus,
  ItemSummary,
  ItemValues,
  Revision,
  Snapshot,
  Stream,
  TrackerSchema,
} from "@eradigm/shared";
import type { Env } from "../env.js";
import { notFound } from "../lib/errors.js";
import type { Schemas } from "./schema.js";

export interface ItemRow {
  id: string;
  tenant_id: string;
  submission_id: string;
  code: string;
  signal_code: string | null;
  stream: Stream;
  record_id: string | null;
  status: ItemStatus;
  version: number;
  op_token: string | null;
  attempts: number;
  input_type: "url" | "file" | "manual";
  url_key: string | null;
  file_sha256: string | null;
  content_sha256: string | null;
  duplicate_of: string | null;
  quarantined: number;
  outlet: string | null;
  submitted_url: string | null;
  final_url: string | null;
  received_at: string;
  submitted_by: string | null;
  headline: string | null;
  body_text: string | null;
  publication_date: string | null;
  current_snapshot_id: string | null;
  draft_json: string;
  provenance_json: string;
  extraction_json: string | null;
  model_warnings_json: string;
  warnings_count: number;
  error_code: string | null;
  error_message: string | null;
  published_rev: number | null;
  pub_date: string | null;
  title: string | null;
  macrotrend: string | null;
  subtrend: string | null;
  growth: string | null;
  impact: string | null;
  tracker_hidden_at: string | null;
  phantoms_hidden_at: string | null;
  extra_json: string;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

type Enriched = ItemRow & {
  submitted_by_name: string | null;
  published_dup: string | null;
  decision: string | null;
  decision_by: string | null;
  decision_at: string | null;
  decision_note: string | null;
  snapshot_status: string | null;
};

export type DuplicateBasis = "url" | "file" | "content";
export interface PublishedDuplicate {
  id: string;
  signalCode: string;
  basis: DuplicateBasis;
}

/**
 * Only entries already in the tracker (approved) count as duplicates: a failed,
 * rejected or still-in-review copy never blocks a new submission. Evaluated at
 * read time, so the warning is always current (e.g. the other copy is approved
 * or deleted later). `i` is the item being checked, `d` the tracker entry.
 */
const DUP_MATCH = `d.tenant_id = i.tenant_id AND d.id <> i.id AND d.status = 'approved' AND (
    (i.url_key IS NOT NULL AND d.url_key = i.url_key) OR
    (i.file_sha256 IS NOT NULL AND d.file_sha256 = i.file_sha256) OR
    (i.content_sha256 IS NOT NULL AND d.content_sha256 = i.content_sha256))`;
const DUP_BASIS = `CASE WHEN i.url_key IS NOT NULL AND d.url_key = i.url_key THEN 'url' WHEN i.file_sha256 IS NOT NULL AND d.file_sha256 = i.file_sha256 THEN 'file' ELSE 'content' END`;
const DUP_SELECT = `SELECT d.id || ' ' || d.signal_code || ' ' || ${DUP_BASIS} FROM intelligence_items d WHERE ${DUP_MATCH} ORDER BY d.approved_at LIMIT 1`;

function parseDup(v: string | null): PublishedDuplicate | null {
  const [id, signalCode, basis] = (v ?? "").split(" ");
  return id && signalCode && basis ? { id, signalCode, basis: basis as DuplicateBasis } : null;
}

/** The tracker entry this item duplicates, if any (used to guard approval). */
export async function publishedDuplicate(env: Env, tenantId: string, id: string): Promise<PublishedDuplicate | null> {
  const r = await env.DB.prepare(`SELECT (${DUP_SELECT}) AS dup FROM intelligence_items i WHERE i.tenant_id = ?1 AND i.id = ?2`).bind(tenantId, id).first<{ dup: string | null }>();
  return parseDup(r?.dup ?? null);
}

/** SQL condition that is true when item `?` has NO duplicate in the tracker (for guarded approval). */
export const NO_PUBLISHED_DUPLICATE = `NOT EXISTS (SELECT 1 FROM intelligence_items i, intelligence_items d WHERE i.id = ? AND ${DUP_MATCH})`;

export const DUPLICATE_BASIS_LABEL: Record<DuplicateBasis, string> = { url: "same URL", file: "same uploaded file", content: "same article text" };

/** Fingerprint of the article text, or null when there is too little text to compare meaningfully. */
export function contentFingerprintInput(headline: string | null | undefined, body: string | null | undefined): string | null {
  const text = `${headline ?? ""}\n${body ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  return text.length >= 40 ? text : null;
}

const SELECT_ENRICHED = `SELECT i.*,
  (SELECT u.name FROM users u WHERE u.id = i.submitted_by) AS submitted_by_name,
  CASE WHEN i.status IN ('approved', 'deleted') THEN NULL ELSE (${DUP_SELECT}) END AS published_dup,
  (SELECT s.retention_status FROM source_snapshots s WHERE s.id = i.current_snapshot_id) AS snapshot_status,
  rd.decision AS decision, (SELECT u.name FROM users u WHERE u.id = rd.reviewer_id) AS decision_by, rd.decided_at AS decision_at, rd.note AS decision_note
  FROM intelligence_items i
  LEFT JOIN review_decisions rd ON rd.id = (SELECT id FROM review_decisions x WHERE x.item_id = i.id ORDER BY x.decided_at DESC LIMIT 1)`;

export function fullDraft(schema: TrackerSchema, json: string): ItemValues {
  const d = JSON.parse(json || "{}") as ItemValues;
  const out: ItemValues = {};
  for (const c of schema.columns) out[c.key] = d[c.key] ?? null;
  return out;
}

export function toSummary(schemas: Schemas, r: Enriched): ItemSummary {
  const schema = schemas[r.stream] ?? schemas.primary;
  const dup = parseDup(r.published_dup);
  const extraction = r.extraction_json ? (JSON.parse(r.extraction_json) as Record<string, ExtractedFieldView>) : null;
  return {
    id: r.id,
    code: r.code,
    stream: r.stream,
    status: r.status,
    inputType: r.input_type,
    outlet: r.outlet,
    submittedUrl: r.submitted_url,
    url: r.final_url ?? r.submitted_url,
    receivedAt: r.received_at,
    submittedBy: r.submitted_by_name,
    title: r.headline,
    draft: fullDraft(schema, r.draft_json),
    provenance: JSON.parse(r.provenance_json || "{}"),
    extraction,
    warningsCount: r.warnings_count,
    modelWarnings: JSON.parse(r.model_warnings_json || "[]"),
    error: r.error_code ? { code: r.error_code, message: r.error_message ?? "" } : null,
    duplicateOf: dup?.signalCode ?? null,
    duplicateItemId: dup?.id ?? null,
    duplicateBasis: dup?.basis ?? null,
    quarantined: !!r.quarantined,
    version: r.version,
    attempts: r.attempts,
    signalCode: r.signal_code,
    publishedRev: r.published_rev,
    decision: r.decision
      ? { decision: r.decision as "approve" | "reject" | "reprocess", by: r.decision_by ?? "—", at: r.decision_at ?? "", note: r.decision_note }
      : null,
    hasSnapshot: !!r.current_snapshot_id && r.snapshot_status === "active",
  };
}

export async function getItemRow(env: Env, tenantId: string, id: string): Promise<ItemRow> {
  const r = await env.DB.prepare("SELECT * FROM intelligence_items WHERE tenant_id = ?1 AND id = ?2").bind(tenantId, id).first<ItemRow>();
  if (!r) throw notFound("Item");
  return r;
}

export async function getSummary(env: Env, schemas: Schemas, tenantId: string, id: string): Promise<ItemSummary> {
  const r = await env.DB.prepare(`${SELECT_ENRICHED} WHERE i.tenant_id = ?1 AND i.id = ?2`).bind(tenantId, id).first<Enriched>();
  if (!r) throw notFound("Item");
  return toSummary(schemas, r);
}

export async function listItems(env: Env, schemas: Schemas, tenantId: string, statuses: ItemStatus[], stream: Stream | null = null, limit = 200): Promise<ItemSummary[]> {
  const ph = statuses.map((_, i) => `?${i + 3}`).join(",");
  const res = await env.DB.prepare(
    `${SELECT_ENRICHED} WHERE i.tenant_id = ?1 AND (?2 IS NULL OR i.stream = ?2) AND i.status IN (${ph}) ORDER BY i.received_at DESC LIMIT ${Math.min(500, limit)}`,
  )
    .bind(tenantId, stream, ...statuses)
    .all<Enriched>();
  return (res.results ?? []).map((r) => toSummary(schemas, r));
}

/** Items awaiting the analyst (Needs review or still processing) per stream: the Inbox badges. */
export async function inboxCounts(env: Env, tenantId: string): Promise<Record<Stream, number>> {
  const res = await env.DB.prepare(
    "SELECT stream, COUNT(*) AS n FROM intelligence_items WHERE tenant_id = ?1 AND status IN ('needs_review', 'queued', 'fetching', 'extracting') GROUP BY stream",
  )
    .bind(tenantId)
    .all<{ stream: Stream; n: number }>();
  const out: Record<Stream, number> = { primary: 0, secondary: 0 };
  for (const r of res.results ?? []) out[r.stream] = r.n;
  return out;
}

export async function revisions(env: Env, tenantId: string, itemId: string): Promise<Revision[]> {
  const res = await env.DB.prepare(
    `SELECT r.seq, r.kind, r.published_rev, r.values_json, r.changed_keys, r.created_at, r.note, COALESCE(u.name, r.created_by, 'System') AS who
       FROM item_revisions r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.tenant_id = ?1 AND r.item_id = ?2 ORDER BY r.seq DESC`,
  )
    .bind(tenantId, itemId)
    .all<{ seq: number; kind: Revision["kind"]; published_rev: number | null; values_json: string; changed_keys: string; created_at: string; note: string | null; who: string }>();
  return (res.results ?? []).map((r) => ({
    seq: r.seq,
    rev: r.published_rev,
    kind: r.kind,
    values: JSON.parse(r.values_json),
    changedKeys: JSON.parse(r.changed_keys),
    by: r.who,
    at: r.created_at,
    note: r.note,
  }));
}

export async function attempts(env: Env, tenantId: string, itemId: string): Promise<Attempt[]> {
  const res = await env.DB.prepare("SELECT * FROM processing_attempts WHERE tenant_id = ?1 AND item_id = ?2 ORDER BY attempt DESC").bind(tenantId, itemId).all<{
    attempt: number;
    status: Attempt["status"];
    stage: string;
    started_at: string;
    finished_at: string | null;
    error_code: string | null;
    error_message: string | null;
    extraction_version: string | null;
    prompt_version: string | null;
    schema_version: string | null;
    provider: string | null;
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    steps_json: string;
  }>();
  return (res.results ?? []).map((a) => ({
    attempt: a.attempt,
    status: a.status,
    stage: a.stage,
    startedAt: a.started_at,
    finishedAt: a.finished_at,
    errorCode: a.error_code,
    errorMessage: a.error_message,
    extractionVersion: a.extraction_version,
    promptVersion: a.prompt_version,
    schemaVersion: a.schema_version,
    provider: a.provider,
    inputTokens: a.input_tokens,
    outputTokens: a.output_tokens,
    model: a.model,
    steps: JSON.parse(a.steps_json || "[]"),
  }));
}

export async function snapshotMeta(env: Env, tenantId: string, snapshotId: string | null): Promise<Snapshot | null> {
  if (!snapshotId) return null;
  const s = await env.DB.prepare("SELECT * FROM source_snapshots WHERE tenant_id = ?1 AND id = ?2").bind(tenantId, snapshotId).first<{
    id: string;
    sha256: string;
    bytes: number;
    content_type: string;
    final_url: string | null;
    retrieved_at: string;
    capture_method: string;
    redirects: number;
    retention_status: Snapshot["retentionStatus"];
    single_file: number;
  }>();
  if (!s) return null;
  return {
    id: s.id,
    sha256: s.sha256,
    bytes: s.bytes,
    contentType: s.content_type,
    finalUrl: s.final_url,
    retrievedAt: s.retrieved_at,
    captureMethod: s.capture_method,
    redirects: s.redirects,
    retentionStatus: s.retention_status,
    singleFile: !!s.single_file,
  };
}

export async function getDetail(env: Env, schemas: Schemas, tenantId: string, id: string): Promise<ItemDetail> {
  const summary = await getSummary(env, schemas, tenantId, id);
  const row = await getItemRow(env, tenantId, id);
  const [revs, atts, snap] = await Promise.all([revisions(env, tenantId, id), attempts(env, tenantId, id), snapshotMeta(env, tenantId, row.current_snapshot_id)]);
  return { ...summary, bodyText: row.body_text, publicationDate: row.publication_date, revisions: revs, attemptsDetail: atts, snapshot: snap };
}

/** Allocate the next human-readable code (INB-2207 / SIG-1180) for a tenant. */
export async function nextCode(env: Env, tenantId: string, name: "inbox" | "signal"): Promise<string> {
  const r = await env.DB.prepare("UPDATE counters SET value = value + 1 WHERE tenant_id = ?1 AND name = ?2 RETURNING value").bind(tenantId, name).first<{ value: number }>();
  let value = r?.value;
  if (value == null) {
    const start = name === "inbox" ? 2201 : 1101;
    await env.DB.prepare("INSERT OR IGNORE INTO counters (tenant_id, name, value) VALUES (?1, ?2, ?3)").bind(tenantId, name, start).run();
    value = start;
  }
  return `${name === "inbox" ? "INB" : "SIG"}-${value}`;
}
