/**
 * Phantoms are an evergreen snapshot of each entry: its values as first
 * pushed to the Tracker (migration 0012). Later Tracker edits do not change
 * them; option renames do (a label change, not a content change).
 */
import type { Env } from "../env.js";
import { nowIso } from "../lib/ids.js";

const COLUMNS = "item_id, tenant_id, pub_date, title, macrotrend, subtrend, growth, impact, record_id, extra_json, competitors_json, published_rev, approved_at, approved_by, created_at";

/** SQL that freezes the Phantom of every approved entry matching `where` (on `i`) that has none yet. */
export const SNAPSHOT_SELECT = (where: string) => `INSERT OR IGNORE INTO phantom_snapshots (${COLUMNS})
  SELECT i.id, i.tenant_id, i.pub_date, i.title, i.macrotrend, i.subtrend, i.growth, i.impact, i.record_id, COALESCE(i.extra_json, '{}'),
         COALESCE((SELECT json_group_array(c.competitor) FROM item_competitors c WHERE c.item_id = i.id), '[]'),
         COALESCE(i.published_rev, 1), i.approved_at, i.approved_by, ?1
    FROM intelligence_items i WHERE i.status = 'approved' AND ${where}`;

/** Freeze an entry's Phantom (after its Tracker values are written, in the same batch). Does nothing if it has one. */
export function snapshotPhantom(env: Env, tenantId: string, itemId: string): D1PreparedStatement {
  return env.DB.prepare(SNAPSHOT_SELECT("i.tenant_id = ?2 AND i.id = ?3")).bind(nowIso(), tenantId, itemId);
}

/** Option renames reach the snapshots too (physical column, extra field, or competitor list). */
export function renamePhantomOption(env: Env, tenantId: string, stream: string, target: { physical?: string; extraPath?: string; multi?: boolean }, from: string, to: string): D1PreparedStatement {
  const inStream = "item_id IN (SELECT id FROM intelligence_items WHERE tenant_id = ?1 AND stream = ?4)";
  if (target.multi) {
    return env.DB.prepare(
      `UPDATE phantom_snapshots SET competitors_json = (SELECT json_group_array(CASE WHEN value = ?2 THEN ?3 ELSE value END) FROM json_each(competitors_json))
        WHERE tenant_id = ?1 AND ${inStream} AND EXISTS (SELECT 1 FROM json_each(competitors_json) WHERE value = ?2)`,
    ).bind(tenantId, from, to, stream);
  }
  if (target.physical) {
    return env.DB.prepare(`UPDATE phantom_snapshots SET ${target.physical} = ?3 WHERE tenant_id = ?1 AND ${inStream} AND ${target.physical} = ?2`).bind(tenantId, from, to, stream);
  }
  return env.DB.prepare(`UPDATE phantom_snapshots SET extra_json = json_set(extra_json, ?5, ?3) WHERE tenant_id = ?1 AND ${inStream} AND json_extract(extra_json, ?5) = ?2`).bind(
    tenantId,
    from,
    to,
    stream,
    target.extraPath,
  );
}
