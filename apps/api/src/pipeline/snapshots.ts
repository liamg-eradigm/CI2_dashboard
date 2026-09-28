/**
 * Saved source copies live in R2 (large objects); D1 holds only the reference,
 * fingerprint, descriptive details, retention status and access scope.
 * Objects are content-addressed (sha256 in the key) and never overwritten.
 */
import type { Env } from "../env.js";
import { decryptBytes, encryptBytes, sha256Hex } from "../lib/crypto.js";
import { newId, nowIso } from "../lib/ids.js";
import { log } from "../lib/log.js";

const enc = new TextEncoder();

export interface StoredSnapshot {
  id: string;
  sha256: string;
  bytes: number;
}

export async function storeSnapshot(
  env: Env,
  p: {
    tenantId: string;
    itemId: string;
    attempt: number;
    html: string;
    rawSha256: string | null;
    contentType: string;
    httpStatus: number | null;
    finalUrl: string | null;
    redirects: number;
    method: string;
    singleFile: boolean;
    retentionDays: number;
  },
): Promise<StoredSnapshot> {
  const plain = enc.encode(p.html);
  const sha = await sha256Hex(plain);
  const key = `t/${p.tenantId}/items/${p.itemId}/${sha}.html`;
  const encrypted = !!env.SNAPSHOT_ENCRYPTION_KEY;
  if (!encrypted && (env.ENVIRONMENT === "production" || env.ENVIRONMENT === "staging")) {
    log("warn", "snapshot_unencrypted", { reason: "SNAPSHOT_ENCRYPTION_KEY not set; relying on R2 encryption at rest" });
  }
  const existing = await env.SNAPSHOTS.head(key);
  if (!existing) {
    const body = encrypted ? await encryptBytes(env.SNAPSHOT_ENCRYPTION_KEY as string, plain) : plain;
    await env.SNAPSHOTS.put(key, body, {
      httpMetadata: { contentType: encrypted ? "application/octet-stream" : "text/html; charset=utf-8" },
      customMetadata: { tenant: p.tenantId, item: p.itemId, encrypted: encrypted ? "aes-256-gcm" : "none", sha256: sha },
    });
  }
  const id = newId("snap");
  const retrievedAt = nowIso();
  const retainUntil = p.retentionDays > 0 ? new Date(Date.now() + p.retentionDays * 86_400_000).toISOString() : null;
  await env.DB.prepare(
    `INSERT INTO source_snapshots (id, tenant_id, item_id, attempt, r2_key, sha256, raw_sha256, bytes, content_type, http_status, final_url, redirects, capture_method, single_file, encrypted, retain_until, retrieved_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
     ON CONFLICT (item_id, sha256) DO NOTHING`,
  )
    .bind(id, p.tenantId, p.itemId, p.attempt, key, sha, p.rawSha256, plain.byteLength, p.contentType, p.httpStatus, p.finalUrl, p.redirects, p.method, p.singleFile ? 1 : 0, encrypted ? 1 : 0, retainUntil, retrievedAt)
    .run();
  const row = await env.DB.prepare("SELECT id FROM source_snapshots WHERE item_id = ?1 AND sha256 = ?2").bind(p.itemId, sha).first<{ id: string }>();
  return { id: row?.id ?? id, sha256: sha, bytes: plain.byteLength };
}

export async function readSnapshot(env: Env, tenantId: string, snapshotId: string): Promise<string | null> {
  const s = await env.DB.prepare("SELECT r2_key, encrypted, retention_status FROM source_snapshots WHERE tenant_id = ?1 AND id = ?2")
    .bind(tenantId, snapshotId)
    .first<{ r2_key: string; encrypted: number; retention_status: string }>();
  if (!s || s.retention_status !== "active") return null;
  const obj = await env.SNAPSHOTS.get(s.r2_key);
  if (!obj) return null;
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(await obj.arrayBuffer());
  if (s.encrypted) {
    if (!env.SNAPSHOT_ENCRYPTION_KEY) throw new Error("Snapshot is encrypted but SNAPSHOT_ENCRYPTION_KEY is not configured");
    bytes = await decryptBytes(env.SNAPSHOT_ENCRYPTION_KEY, bytes);
  }
  return new TextDecoder().decode(bytes);
}

/** Delete stored copies for an item (retention / quarantine). Returns how many objects were removed. */
export async function deleteSnapshots(env: Env, tenantId: string, itemId: string): Promise<number> {
  const rows = await env.DB.prepare("SELECT id, r2_key FROM source_snapshots WHERE tenant_id = ?1 AND item_id = ?2 AND retention_status <> 'deleted'")
    .bind(tenantId, itemId)
    .all<{ id: string; r2_key: string }>();
  const list = rows.results ?? [];
  if (!list.length) return 0;
  await env.SNAPSHOTS.delete(list.map((r) => r.r2_key));
  const now = nowIso();
  await env.DB.batch(list.map((r) => env.DB.prepare("UPDATE source_snapshots SET retention_status = 'deleted', deleted_at = ?1 WHERE id = ?2").bind(now, r.id)));
  return list.length;
}
