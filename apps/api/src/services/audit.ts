/**
 * Tamper-resistant audit record (6_QC_&_Compliance).
 *
 * Covers account creation, role and permission changes, sign-ins, submissions,
 * automated classifications, analyst edits, approvals, rejections, exports and
 * deletions. Events form a per-tenant HMAC hash chain; a unique index on
 * (chain, prev_hash) keeps it linear under concurrency and database triggers
 * make the table append-only. `verifyChain` detects any modification.
 *
 * Details must never contain article content, model output or analyst text —
 * only identifiers, field keys, counts and codes.
 */
import type { Env } from "../env.js";
import { canonicalJson, hmacHex } from "../lib/crypto.js";
import { newId, nowIso } from "../lib/ids.js";
import { log } from "../lib/log.js";

export const GENESIS = "genesis";

export type AuditAction =
  | "auth.sign_in"
  | "auth.sessions_revoked"
  | "auth.sign_in_failed"
  | "auth.sign_out"
  | "user.invite_created"
  | "user.identity_linked"
  | "user.created"
  | "user.role_changed"
  | "user.deactivated"
  | "user.reactivated"
  | "submission.created"
  | "submission.duplicate"
  | "item.classified"
  | "item.routed"
  | "item.failed"
  | "item.quarantined"
  | "item.edited"
  | "item.approved"
  | "item.revised"
  | "item.rejected"
  | "item.reprocess_requested"
  | "item.deleted"
  | "schema.changed"
  | "settings.changed"
  | "export.created"
  | "snapshot.downloaded"
  | "markdown.downloaded"
  | "import.completed"
  | "snapshot.attached"
  | "deliverable.created"
  | "deliverable.downloaded"
  | "summary.changed"
  | "summary.generated"
  | "view.saved"
  | "view.deleted"
  | "retention.purged"
  | "incident.resolved";

export interface AuditInput {
  tenantId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

interface Row {
  seq: number;
  id: string;
  chain: string;
  tenant_id: string | null;
  at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: string;
  prev_hash: string;
  hash: string;
}

function payload(r: Omit<Row, "seq" | "hash">): string {
  return canonicalJson({
    id: r.id,
    chain: r.chain,
    tenant_id: r.tenant_id,
    at: r.at,
    actor_id: r.actor_id,
    actor_email: r.actor_email,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    details: JSON.parse(r.details_json),
    prev_hash: r.prev_hash,
  });
}

export async function audit(env: Env, e: AuditInput): Promise<void> {
  const chain = e.tenantId ?? "_platform";
  for (let attempt = 0; attempt < 6; attempt++) {
    const last = await env.DB.prepare("SELECT hash FROM audit_events WHERE chain = ?1 ORDER BY seq DESC LIMIT 1")
      .bind(chain)
      .first<{ hash: string }>();
    const row = {
      id: newId("aud"),
      chain,
      tenant_id: e.tenantId,
      at: nowIso(),
      actor_id: e.actorId,
      actor_email: e.actorEmail,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      details_json: JSON.stringify(e.details ?? {}),
      prev_hash: last?.hash ?? GENESIS,
    };
    const hash = await hmacHex(env.AUDIT_HMAC_KEY, payload(row));
    try {
      await env.DB.prepare(
        `INSERT INTO audit_events (id, chain, tenant_id, at, actor_id, actor_email, action, target_type, target_id, details_json, prev_hash, hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
        .bind(row.id, row.chain, row.tenant_id, row.at, row.actor_id, row.actor_email, row.action, row.target_type, row.target_id, row.details_json, row.prev_hash, hash)
        .run();
      return;
    } catch (err) {
      // Another writer extended the chain first (unique (chain, prev_hash)); retry on the new head.
      if (!/UNIQUE/i.test(String((err as Error).message))) throw err;
    }
  }
  log("error", "audit_chain_contention", { chain, action: e.action });
  throw new Error("Could not append audit event");
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  reason: string | null;
  head: string | null;
}

export async function verifyChain(env: Env, tenantId: string): Promise<ChainVerification> {
  let prev = GENESIS;
  let checked = 0;
  let cursor = 0;
  for (;;) {
    const page = await env.DB.prepare("SELECT * FROM audit_events WHERE chain = ?1 AND seq > ?2 ORDER BY seq LIMIT 500")
      .bind(tenantId, cursor)
      .all<Row>();
    const rows = page.results ?? [];
    if (!rows.length) break;
    for (const r of rows) {
      if (r.prev_hash !== prev) return { ok: false, checked, brokenAtSeq: r.seq, reason: "Chain link mismatch (event removed or reordered)", head: prev };
      const expected = await hmacHex(env.AUDIT_HMAC_KEY, payload(r));
      if (expected !== r.hash) return { ok: false, checked, brokenAtSeq: r.seq, reason: "Event content was modified", head: prev };
      prev = r.hash;
      checked++;
      cursor = r.seq;
    }
  }
  return { ok: true, checked, brokenAtSeq: null, reason: null, head: checked ? prev : null };
}

export async function listAudit(env: Env, tenantId: string, before: number | null, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT seq, at, actor_email, action, target_type, target_id, details_json, hash
       FROM audit_events WHERE chain = ?1 AND (?2 IS NULL OR seq < ?2) ORDER BY seq DESC LIMIT ?3`,
  )
    .bind(tenantId, before, limit)
    .all<{ seq: number; at: string; actor_email: string | null; action: string; target_type: string | null; target_id: string | null; details_json: string; hash: string }>();
  return (rows.results ?? []).map((r) => ({
    seq: r.seq,
    at: r.at,
    actor: r.actor_email,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: JSON.parse(r.details_json) as Record<string, unknown>,
    hash: r.hash,
  }));
}
