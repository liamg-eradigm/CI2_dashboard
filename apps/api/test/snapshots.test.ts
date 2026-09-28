import { beforeAll, describe, expect, it } from "vitest";
import { deleteSnapshots, readSnapshot, snapshotBackend, storeSnapshot } from "../src/pipeline/snapshots";
import { env, ingest, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const enc = new TextEncoder();

/** A real item (created through the upload API) to attach test snapshots to. */
async function newItem(_tenantId: string) {
  const item = await ingest(w.a.analyst, `Snapshot store test ${Math.random().toString(36).slice(2)}`, `Body ${Math.random()} for the snapshot store test.`);
  await env.DB.prepare("DELETE FROM snapshot_blobs WHERE storage_key LIKE ?1").bind(`d1:${w.a.id}/${item.id}/%`).run();
  await env.DB.prepare("DELETE FROM source_snapshots WHERE item_id = ?1").bind(item.id).run();
  return item.id as string;
}

const params = (tenantId: string, itemId: string, html: string) => ({
  tenantId,
  itemId,
  attempt: 1,
  html: enc.encode(html),
  rawSha256: null,
  contentType: "text/html",
  httpStatus: null,
  finalUrl: null,
  redirects: 0,
  method: "upload",
  singleFile: false,
  retentionDays: 30,
});

/** Minimal in-memory R2 bucket. */
function fakeBucket() {
  const m = new Map<string, Uint8Array>();
  return {
    m,
    async head(k: string) {
      return m.has(k) ? {} : null;
    },
    async put(k: string, v: Uint8Array) {
      m.set(k, new Uint8Array(v));
    },
    async get(k: string) {
      const v = m.get(k);
      return v ? { arrayBuffer: async () => v.slice().buffer } : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) m.delete(k);
    },
  };
}

describe("snapshot store", () => {
  it("defaults to D1 on the free plan and chunks large pages below the D1 row limit", async () => {
    expect(snapshotBackend(env)).toBe("d1");
    const itemId = await newItem(w.a.id);
    const html = `<!doctype html><p>${"Ünïcode article text · ".repeat(80_000)}</p>`;
    const snap = await storeSnapshot(env, params(w.a.id, itemId, html));
    const rows = await env.DB.prepare("SELECT seq, length(CAST(data AS BLOB)) AS b FROM snapshot_blobs WHERE storage_key LIKE ?1 ORDER BY seq").bind(`d1:${w.a.id}/${itemId}/%`).all<{ seq: number; b: number }>();
    expect(rows.results?.length).toBeGreaterThan(1);
    for (const r of rows.results ?? []) expect(r.b).toBeLessThan(2_000_000);
    expect(await readSnapshot(env, w.a.id, snap.id)).toBe(html);
    // Content-addressed: storing the same page again adds nothing.
    await storeSnapshot(env, params(w.a.id, itemId, html));
    const again = await env.DB.prepare("SELECT COUNT(*) AS n FROM source_snapshots WHERE item_id = ?1").bind(itemId).first<{ n: number }>();
    expect(again?.n).toBe(1);
    // Other tenants cannot read it.
    expect(await readSnapshot(env, w.b.id, snap.id)).toBeNull();
    expect(await deleteSnapshots(env, w.a.id, itemId)).toBe(1);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshot_blobs WHERE storage_key LIKE ?1").bind(`d1:${w.a.id}/${itemId}/%`).first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect(await readSnapshot(env, w.a.id, snap.id)).toBeNull();
  });

  it("encrypts snapshots at the application level when a key is configured", async () => {
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const e = { ...env, SNAPSHOT_ENCRYPTION_KEY: key };
    const itemId = await newItem(w.a.id);
    const snap = await storeSnapshot(e, params(w.a.id, itemId, "<p>secret competitor news</p>"));
    const raw = await env.DB.prepare("SELECT data FROM snapshot_blobs WHERE storage_key LIKE ?1").bind(`d1:${w.a.id}/${itemId}/%`).first<{ data: string }>();
    expect(raw?.data).not.toContain("competitor");
    expect(await readSnapshot(e, w.a.id, snap.id)).toBe("<p>secret competitor news</p>");
  });

  it("uses R2 when a bucket is bound, and D1 snapshots stay readable after switching", async () => {
    const itemId = await newItem(w.a.id);
    const d1Snap = await storeSnapshot(env, params(w.a.id, itemId, "<p>stored in D1</p>"));
    const bucket = fakeBucket();
    const e = { ...env, SNAPSHOTS: bucket as unknown as R2Bucket };
    expect(snapshotBackend(e)).toBe("r2");
    const r2Snap = await storeSnapshot(e, params(w.a.id, itemId, "<p>stored in R2</p>"));
    expect([...bucket.m.keys()]).toEqual([expect.stringMatching(new RegExp(`^t/${w.a.id}/items/${itemId}/[0-9a-f]{64}\\.html$`))]);
    expect(await readSnapshot(e, w.a.id, r2Snap.id)).toBe("<p>stored in R2</p>");
    expect(await readSnapshot(e, w.a.id, d1Snap.id)).toBe("<p>stored in D1</p>");
    expect(await deleteSnapshots(e, w.a.id, itemId)).toBe(2);
    expect(bucket.m.size).toBe(0);
  });
});
