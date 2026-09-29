/**
 * Approved signal detail (record drawer): source, snapshot, provenance,
 * company associations, classifications, revision history and related signals.
 */
import { CORE, entryMarkdown, markdownFileName, type ExtractedFieldView, type SignalDetail, type Stream } from "@eradigm/shared";
import type { Env } from "../env.js";
import { notFound } from "../lib/errors.js";
import { revisions, snapshotMeta } from "./items.js";
import { rowValues } from "./query.js";
import type { Schemas } from "./schema.js";

const SEP = "\u001f";

export async function signalDetail(env: Env, schemas: Schemas, tenantId: string, id: string): Promise<SignalDetail> {
  const r = await env.DB.prepare(
    `SELECT i.*, (SELECT group_concat(c.competitor, '${SEP}') FROM item_competitors c WHERE c.item_id = i.id) AS competitors,
            (SELECT u.name FROM users u WHERE u.id = i.approved_by) AS approved_by_name
       FROM intelligence_items i WHERE i.tenant_id = ?1 AND i.id = ?2 AND i.status = 'approved' AND i.deleted_at IS NULL`,
  )
    .bind(tenantId, id)
    .first<Record<string, unknown> & { id: string; signal_code: string; stream: Stream; record_id: string | null; code: string; competitors: string | null; extra_json: string; pub_date: string; title: string | null; macrotrend: string | null; subtrend: string | null; growth: string | null; impact: string | null; body_text: string | null; final_url: string | null; submitted_url: string | null; published_rev: number; approved_at: string; approved_by_name: string | null; received_at: string; current_snapshot_id: string | null; provenance_json: string; extraction_json: string | null }>();
  if (!r) throw notFound("Signal");
  const values = rowValues(schemas[r.stream] ?? schemas.primary, r);
  const attempt = await env.DB.prepare(
    "SELECT extraction_version, prompt_version, schema_version, model FROM processing_attempts WHERE tenant_id = ?1 AND item_id = ?2 AND status = 'succeeded' ORDER BY attempt DESC LIMIT 1",
  )
    .bind(tenantId, id)
    .first<{ extraction_version: string | null; prompt_version: string | null; schema_version: string | null; model: string | null }>();
  const comps = (values[CORE.competitors] as string[]) ?? [];
  const related = await env.DB.prepare(
    `SELECT i.id, i.signal_code, i.title, i.pub_date, CASE WHEN i.subtrend = ?3 THEN 'Same subtrend' ELSE 'Same macrotrend and competitor' END AS why
       FROM intelligence_items i
      WHERE i.tenant_id = ?1 AND i.id <> ?2 AND i.status = 'approved' AND i.deleted_at IS NULL
        AND (i.subtrend = ?3 OR (i.macrotrend = ?4 AND EXISTS (SELECT 1 FROM item_competitors c WHERE c.item_id = i.id AND c.competitor IN (SELECT value FROM json_each(?5)))))
      ORDER BY (i.subtrend = ?3) DESC, i.pub_date DESC LIMIT 3`,
  )
    .bind(tenantId, id, r.subtrend, r.macrotrend, JSON.stringify(comps))
    .all<{ id: string; signal_code: string; title: string | null; pub_date: string | null; why: string }>();
  return {
    id: r.id,
    code: r.signal_code,
    stream: r.stream,
    values,
    text: r.body_text ?? "",
    url: r.final_url ?? r.submitted_url,
    rev: r.published_rev,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by_name ?? "—",
    inboxCode: r.code,
    receivedAt: r.received_at,
    submittedUrl: r.submitted_url,
    snapshot: await snapshotMeta(env, tenantId, r.current_snapshot_id),
    provenance: JSON.parse(r.provenance_json || "{}"),
    evidence: r.extraction_json ? (JSON.parse(r.extraction_json) as Record<string, ExtractedFieldView>) : null,
    extraction: {
      extractionVersion: attempt?.extraction_version ?? null,
      promptVersion: attempt?.prompt_version ?? null,
      schemaVersion: attempt?.schema_version ?? null,
      model: attempt?.model ?? null,
    },
    revisions: await revisions(env, tenantId, id),
    related: (related.results ?? []).map((x) => ({ id: x.id, code: x.signal_code, title: x.title ?? "", date: x.pub_date, why: x.why })),
  };
}

/**
 * The Phantoms Markdown for a tracker entry, built from its published field
 * values only (plus who approved it, for QC.Reviewed_by).
 */
export async function signalMarkdown(env: Env, schemas: Schemas, tenantId: string, id: string): Promise<{ markdown: string; fileName: string; code: string }> {
  const r = await env.DB.prepare(
    `SELECT i.signal_code, i.stream, i.record_id, i.pub_date, i.title, i.macrotrend, i.subtrend, i.growth, i.impact, i.extra_json,
            (SELECT group_concat(c.competitor, '${SEP}') FROM item_competitors c WHERE c.item_id = i.id) AS competitors,
            (SELECT u.name FROM users u WHERE u.id = i.approved_by) AS approved_by_name
       FROM intelligence_items i WHERE i.tenant_id = ?1 AND i.id = ?2 AND i.status = 'approved' AND i.deleted_at IS NULL`,
  )
    .bind(tenantId, id)
    .first<{ signal_code: string; stream: Stream; record_id: string | null; pub_date: string; title: string | null; macrotrend: string | null; subtrend: string | null; growth: string | null; impact: string | null; extra_json: string; competitors: string | null; approved_by_name: string | null }>();
  if (!r) throw notFound("Signal");
  const values = rowValues(schemas[r.stream] ?? schemas.primary, r);
  return { markdown: entryMarkdown(values, { reviewedBy: r.approved_by_name }), fileName: markdownFileName(values, r.signal_code), code: r.signal_code };
}
