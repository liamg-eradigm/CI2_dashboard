/**
 * Read cache keyed by each workspace's data version (D1 rows read).
 *
 * The Workers Free plan allows 5 million D1 rows read a day. The dashboard
 * polls (Inbox, badges) and re-reads the same tables on every page, so most
 * reads return what the last one did. Each workspace has a data version
 * (tenant_data_versions, migration 0017) that goes up with every change:
 * every API request that is not a read (POST, PUT, PATCH, DELETE), every
 * background job step and the nightly retention run. A read whose workspace
 * version has not moved since is answered from this isolate's memory, for
 * the cost of reading the version (one row). A change anywhere moves the
 * version, so a cached answer is never stale; isolates that have not seen a
 * version yet simply read D1 as before.
 *
 * Memory only (no KV or Cache API: the Cache API does nothing on workers.dev,
 * and KV's free writes are few). Bounded by entries and size.
 */
import type { Env } from "../env.js";

const MAX_ENTRIES = 400;
const MAX_CHARS = 24_000_000;
const MAX_ENTRY_CHARS = 4_000_000;

const store = new Map<string, string>();
let chars = 0;

function evict() {
  while (store.size > MAX_ENTRIES || chars > MAX_CHARS) {
    const oldest = store.keys().next();
    if (oldest.done) return;
    chars -= store.get(oldest.value)?.length ?? 0;
    store.delete(oldest.value);
  }
}

export function cacheGet(key: string): string | undefined {
  const v = store.get(key);
  if (v === undefined) return undefined;
  // Most recently used last (Map keeps insertion order).
  store.delete(key);
  store.set(key, v);
  return v;
}

export function cachePut(key: string, value: string): void {
  if (value.length > MAX_ENTRY_CHARS) return;
  const old = store.get(key);
  if (old !== undefined) {
    chars -= old.length;
    store.delete(key);
  }
  store.set(key, value);
  chars += value.length;
  evict();
}

/** Typed values (e.g. the column sets), kept apart from responses. */
const values = new Map<string, unknown>();
export function memo<T>(key: string, make: () => Promise<T>): Promise<T> {
  if (values.has(key)) return Promise.resolve(values.get(key) as T);
  return make().then((v) => {
    if (values.size > 200) values.delete(values.keys().next().value as string);
    values.set(key, v);
    return v;
  });
}

/** Empty the isolate's caches (tests). */
export function clearCaches(): void {
  store.clear();
  values.clear();
  chars = 0;
}

/** The workspace's data versions (one row read): any change (v), and changes that can reach the Tracker (t). */
export interface DataVersions {
  v: number;
  t: number;
}
export async function dataVersion(env: Env, tenantId: string): Promise<DataVersions> {
  const r = await env.DB.prepare("SELECT v, t FROM tenant_data_versions WHERE tenant_id = ?1").bind(tenantId).first<DataVersions>();
  return { v: r?.v ?? 0, t: r?.t ?? 0 };
}

/**
 * Something in the workspace changed: answers cached before are no longer
 * used. "inbox": only entries still in the Inbox (and other things no cached
 * Tracker read shows) changed, so Tracker-side reads stay cached.
 */
export async function bumpDataVersion(env: Env, tenantId: string, scope: "all" | "inbox" = "all"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tenant_data_versions (tenant_id, v, t, updated_at) VALUES (?1, 1, 1, ?2)
     ON CONFLICT (tenant_id) DO UPDATE SET v = v + 1, t = t + ?3, updated_at = excluded.updated_at`,
  )
    .bind(tenantId, new Date().toISOString(), scope === "all" ? 1 : 0)
    .run();
}

/** Every workspace changed (the nightly retention run). */
export async function bumpAllDataVersions(env: Env): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tenant_data_versions (tenant_id, v, t, updated_at) SELECT id, 1, 1, ?1 FROM tenants WHERE true
     ON CONFLICT (tenant_id) DO UPDATE SET v = v + 1, t = t + 1, updated_at = excluded.updated_at`,
  )
    .bind(new Date().toISOString())
    .run();
}
