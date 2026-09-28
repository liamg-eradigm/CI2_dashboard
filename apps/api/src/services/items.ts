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
  TrackerSchema,
} from "@eradigm/shared";
import type { Env } from "../env.js";
import { notFound } from "../lib/errors.js";

export interface ItemRow {
  id: string;
  tenant_id: string;
  submission_id: string;
  code: string;
  signal_code: string | null;
  status: ItemStatus;
  version: number;
  op_token: string | null;
  attempts: number;
  input_type: "url" | "file";
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
  extra_json: string;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

type Enriched = ItemRow & {
  submitted_by_name: string | null;
  duplicate_code: string | null;
  decision: string | null;
  decision_by: string | null;
  decision_at: string | null;
  decision_note: string | null;
  snapshot_status: string | null;
};

const SELECT_ENRICHED = `SELECT i.*,
  (SELECT u.name FROM users u WHERE u.id = i.submitted_by) AS submitted_by_name,
  (SELECT d.code FROM intelligence_items d WHERE d.id = i.duplicate_of AND d.tenant_id = i.tenant_id) AS duplicate_code,
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

export function toSummary(schema: TrackerSchema, r: Enriched): ItemSummary {
  const extraction = r.extraction_json ? (JSON.parse(r.extraction_json) as Record<string, ExtractedFieldView>) : null;
  return {
    id: r.id,
    code: r.code,
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
    duplicateOf: r.duplicate_code,
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

export async function getSummary(env: Env, schema: TrackerSchema, tenantId: string, id: string): Promise<ItemSummary> {
  const r = await env.DB.prepare(`${SELECT_ENRICHED} WHERE i.tenant_id = ?1 AND i.id = ?2`).bind(tenantId, id).first<Enriched>();
  if (!r) throw notFound("Item");
  return toSummary(schema, r);
}

export async function listItems(env: Env, schema: TrackerSchema, tenantId: string, statuses: ItemStatus[], limit = 200): Promise<ItemSummary[]> {
  const ph = statuses.map((_, i) => `?${i + 2}`).join(",");
  const res = await env.DB.prepare(`${SELECT_ENRICHED} WHERE i.tenant_id = ?1 AND i.status IN (${ph}) ORDER BY i.received_at DESC LIMIT ${Math.min(500, limit)}`)
    .bind(tenantId, ...statuses)
    .all<Enriched>();
  return (res.results ?? []).map((r) => toSummary(schema, r));
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
    model: string | null;
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

export async function getDetail(env: Env, schema: TrackerSchema, tenantId: string, id: string): Promise<ItemDetail> {
  const summary = await getSummary(env, schema, tenantId, id);
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
