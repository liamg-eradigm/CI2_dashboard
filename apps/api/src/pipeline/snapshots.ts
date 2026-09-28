/**
 * Saved source copies. D1 holds the reference, fingerprint, descriptive
 * details, retention status and access scope in `source_snapshots`; the HTML
 * itself lives in one of two stores, chosen per snapshot by its storage key:
 *
 *   d1:<tenant>/<item>/<sha256>   D1 table `snapshot_blobs` (default). Works on
 *                                 the Workers Free plan with no extra product to
 *                                 enable. Stored as text in ≤ 600k-character
 *                                 chunks (D1 rows are limited to 2 MB).
 *   t/<tenant>/items/<item>/<sha256>.html
 *                                 R2 bucket bound as SNAPSHOTS (optional; used
 *                                 automatically for new snapshots when bound).
 *
 * Objects are content-addressed (sha256 in the key) and never overwritten.
 * Existing snapshots stay readable after switching stores.
 */
import type { Env } from "../env.js";
import { b64ToBytes, bytesToB64, decryptBytes, encryptBytes, sha256Hex } from "../lib/crypto.js";
import { newId, nowIso } from "../lib/ids.js";
import { log } from "../lib/log.js";

const dec = new TextDecoder();
const CHUNK_CHARS = 600_000;
const D1_PREFIX = "d1:";

export interface StoredSnapshot {
  id: string;
  sha256: string;
  bytes: number;
}

export function snapshotBackend(env: Env): "r2" | "d1" {
  return env.SNAPSHOTS ? "r2" : "d1";
}

async function d1Put(env: Env, tenantId: string, key: string, text: string): Promise<void> {
  const exists = await env.DB.prepare("SELECT 1 AS x FROM snapshot_blobs WHERE storage_key = ?1 LIMIT 1").bind(key).first();
  if (exists) return;
  const stmts = [];
  for (let i = 0, seq = 0; i < text.length || seq === 0; i += CHUNK_CHARS, seq++) {
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO snapshot_blobs (storage_key, seq, tenant_id, data) VALUES (?1, ?2, ?3, ?4)").bind(key, seq, tenantId, text.slice(i, i + CHUNK_CHARS)));
  }
  await env.DB.batch(stmts);
}

async function d1Get(env: Env, key: string): Promise<string | null> {
  const rows = await env.DB.prepare("SELECT data FROM snapshot_blobs WHERE storage_key = ?1 ORDER BY seq").bind(key).all<{ data: string }>();
  const list = rows.results ?? [];
  return list.length ? list.map((r) => r.data).join("") : null;
}

export async function storeSnapshot(
  env: Env,
  p: {
    tenantId: string;
    itemId: string;
    attempt: number;
    /** Sanitised HTML, UTF-8. */
    html: Uint8Array;
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
  const plain = p.html;
  const sha = await sha256Hex(plain);
  const encrypted = !!env.SNAPSHOT_ENCRYPTION_KEY;
  if (!encrypted && (env.ENVIRONMENT === "production" || env.ENVIRONMENT === "staging")) {
    log("warn", "snapshot_unencrypted", { reason: "SNAPSHOT_ENCRYPTION_KEY not set; relying on Cloudflare encryption at rest" });
  }
  const backend = snapshotBackend(env);
  let key: string;
  if (backend === "r2" && env.SNAPSHOTS) {
    key = `t/${p.tenantId}/items/${p.itemId}/${sha}.html`;
    const bucket = env.SNAPSHOTS;
    if (!(await bucket.head(key))) {
      const body = encrypted ? await encryptBytes(env.SNAPSHOT_ENCRYPTION_KEY as string, plain) : plain;
      await bucket.put(key, body, {
        httpMetadata: { contentType: encrypted ? "application/octet-stream" : "text/html; charset=utf-8" },
        customMetadata: { tenant: p.tenantId, item: p.itemId, encrypted: encrypted ? "aes-256-gcm" : "none", sha256: sha },
      });
    }
  } else {
    key = `${D1_PREFIX}${p.tenantId}/${p.itemId}/${sha}`;
    const text = encrypted ? bytesToB64(await encryptBytes(env.SNAPSHOT_ENCRYPTION_KEY as string, plain)) : dec.decode(plain);
    await d1Put(env, p.tenantId, key, text);
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
  const needKey = () => {
    if (!env.SNAPSHOT_ENCRYPTION_KEY) throw new Error("Snapshot is encrypted but SNAPSHOT_ENCRYPTION_KEY is not configured");
    return env.SNAPSHOT_ENCRYPTION_KEY;
  };
  if (s.r2_key.startsWith(D1_PREFIX)) {
    const text = await d1Get(env, s.r2_key);
    if (text == null) return null;
    return s.encrypted ? dec.decode(await decryptBytes(needKey(), b64ToBytes(text))) : text;
  }
  if (!env.SNAPSHOTS) {
    log("error", "snapshot_store_missing", { reason: "Snapshot is in R2 but no SNAPSHOTS bucket is bound" });
    return null;
  }
  const obj = await env.SNAPSHOTS.get(s.r2_key);
  if (!obj) return null;
  const bytes = new Uint8Array(await obj.arrayBuffer());
  return dec.decode(s.encrypted ? await decryptBytes(needKey(), bytes) : bytes);
}

/** Remove stored objects by storage key (both stores). */
export async function deleteObjects(env: Env, keys: string[]): Promise<void> {
  const d1 = keys.filter((k) => k.startsWith(D1_PREFIX));
  const r2 = keys.filter((k) => !k.startsWith(D1_PREFIX));
  if (d1.length) await env.DB.batch(d1.map((k) => env.DB.prepare("DELETE FROM snapshot_blobs WHERE storage_key = ?1").bind(k)));
  if (r2.length && env.SNAPSHOTS) await env.SNAPSHOTS.delete(r2);
}

/** Delete stored copies for an item (retention / quarantine). Returns how many objects were removed. */
export async function deleteSnapshots(env: Env, tenantId: string, itemId: string): Promise<number> {
  const rows = await env.DB.prepare("SELECT id, r2_key FROM source_snapshots WHERE tenant_id = ?1 AND item_id = ?2 AND retention_status <> 'deleted'")
    .bind(tenantId, itemId)
    .all<{ id: string; r2_key: string }>();
  const list = rows.results ?? [];
  if (!list.length) return 0;
  await deleteObjects(env, list.map((r) => r.r2_key));
  const now = nowIso();
  await env.DB.batch(list.map((r) => env.DB.prepare("UPDATE source_snapshots SET retention_status = 'deleted', deleted_at = ?1 WHERE id = ?2").bind(now, r.id)));
  return list.length;
}
