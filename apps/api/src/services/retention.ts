/**
 * Retention and deletion rules (run daily by the cron trigger):
 *   - snapshots past their retention date are deleted from the snapshot store (metadata kept, marked expired);
 *   - rejected / failed items lose their stored content after `rejectedDays`;
 *   - Deleted items lose all stored content after `deletedDays`;
 *   - items stuck in processing for over 30 minutes are marked Failed so they can be retried.
 * The audit trail itself is append-only and retained.
 */
import type { Env } from "../env.js";
import { nowIso } from "../lib/ids.js";
import { alert, log } from "../lib/log.js";
import { deleteObjects, deleteSnapshots } from "../pipeline/snapshots.js";
import { audit } from "./audit.js";
import { loadSettings } from "./schema.js";

const STUCK_MINUTES = 30;

async function purgeContent(env: Env, tenantId: string, itemId: string) {
  await deleteSnapshots(env, tenantId, itemId);
  await env.DB.prepare(
    "UPDATE intelligence_items SET body_text = NULL, headline = CASE WHEN status = 'deleted' THEN NULL ELSE headline END, extraction_json = NULL, updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3",
  )
    .bind(nowIso(), tenantId, itemId)
    .run();
}

export async function runRetention(env: Env): Promise<Record<string, number>> {
  const totals = { snapshotsExpired: 0, itemsPurged: 0, stuckFailed: 0 };
  const tenants = await env.DB.prepare("SELECT id FROM tenants WHERE active = 1").all<{ id: string }>();
  const now = nowIso();
  for (const { id: tenantId } of tenants.results ?? []) {
    const s = await loadSettings(env, tenantId);
    let snapshots = 0;
    let purged = 0;

    const expired = await env.DB.prepare("SELECT id, r2_key FROM source_snapshots WHERE tenant_id = ?1 AND retention_status = 'active' AND retain_until IS NOT NULL AND retain_until < ?2 LIMIT 500")
      .bind(tenantId, now)
      .all<{ id: string; r2_key: string }>();
    for (const snap of expired.results ?? []) {
      await deleteObjects(env, [snap.r2_key]);
      await env.DB.prepare("UPDATE source_snapshots SET retention_status = 'expired', deleted_at = ?1 WHERE id = ?2").bind(now, snap.id).run();
      snapshots++;
    }

    const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const stale = await env.DB.prepare(
      `SELECT id FROM intelligence_items WHERE tenant_id = ?1 AND (
         (status IN ('rejected', 'failed') AND updated_at < ?2) OR (status = 'deleted' AND deleted_at < ?3)
       ) AND (body_text IS NOT NULL OR current_snapshot_id IN (SELECT id FROM source_snapshots WHERE retention_status = 'active')) LIMIT 500`,
    )
      .bind(tenantId, cutoff(s.retention.rejectedDays), cutoff(s.retention.deletedDays))
      .all<{ id: string }>();
    for (const it of stale.results ?? []) {
      await purgeContent(env, tenantId, it.id);
      purged++;
    }

    const stuck = await env.DB.prepare(
      `UPDATE intelligence_items SET status = 'failed', error_code = 'TIMEOUT', error_message = 'Processing did not finish · retry to process again', version = version + 1, updated_at = ?1
        WHERE tenant_id = ?2 AND status IN ('queued', 'fetching', 'extracting') AND updated_at < ?3`,
    )
      .bind(now, tenantId, new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString())
      .run();
    const stuckN = stuck.meta.changes ?? 0;
    if (stuckN) await alert(env, `${stuckN} item(s) were stuck in processing and were marked Failed`, { tenant: tenantId });

    if (snapshots || purged || stuckN) {
      await audit(env, { tenantId, actorId: null, actorEmail: "system", action: "retention.purged", details: { snapshotsExpired: snapshots, itemsPurged: purged, stuckFailed: stuckN } });
    }
    totals.snapshotsExpired += snapshots;
    totals.itemsPurged += purged;
    totals.stuckFailed += stuckN;
  }
  log("info", "retention_run", totals);
  return totals;
}
