/**
 * The saved HTML pages of a Tracker entry: its first page (the captured or
 * first attached page, intelligence_items.current_snapshot_id) and any pages
 * attached after it (source_snapshots.extra = 1, see migration 0011).
 */
import { MAX_SAVED_PAGES, type SavedPage } from "@eradigm/shared";
import type { Env } from "../env.js";
import { notFound } from "../lib/errors.js";

interface PageRow {
  id: string;
  file_name: string | null;
  final_url: string | null;
  bytes: number;
  retrieved_at: string;
  is_first: number;
}

/** "nature-article.html" → "nature-article"; a captured page → its site; else "Saved page n". */
export function pageName(r: Pick<PageRow, "file_name" | "final_url">, n: number): string {
  const f = r.file_name?.replace(/\.html?$/i, "").trim();
  if (f) return f;
  if (r.final_url) {
    try {
      const u = new URL(r.final_url);
      return `${u.hostname.replace(/^www\./, "")}${u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : ""}`.slice(0, 120);
    } catch {
      /* not a URL */
    }
  }
  return `Saved page ${n}`;
}

/** The entry's active saved pages, first page first, then in the order attached. */
export async function listPages(env: Env, tenantId: string, itemId: string): Promise<SavedPage[]> {
  const res = await env.DB.prepare(
    `SELECT s.id, s.file_name, s.final_url, s.bytes, s.retrieved_at, (s.id = i.current_snapshot_id) AS is_first
       FROM source_snapshots s JOIN intelligence_items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?1 AND s.item_id = ?2 AND s.retention_status = 'active' AND (s.id = i.current_snapshot_id OR s.extra = 1)
      ORDER BY is_first DESC, s.retrieved_at, s.id LIMIT ${MAX_SAVED_PAGES}`,
  )
    .bind(tenantId, itemId)
    .all<PageRow>();
  return (res.results ?? []).map((r, i) => ({ id: r.id, name: pageName(r, i + 1), first: !!r.is_first, bytes: r.bytes, savedAt: r.retrieved_at }));
}

/** Which snapshot to show: the requested page of this entry, else its first page. */
export async function pageSnapshotId(env: Env, tenantId: string, item: { id: string; current_snapshot_id: string | null }, page: string | undefined): Promise<string> {
  if (!page || page === item.current_snapshot_id) {
    if (!item.current_snapshot_id) throw notFound("Snapshot");
    return item.current_snapshot_id;
  }
  const r = await env.DB.prepare("SELECT id FROM source_snapshots WHERE tenant_id = ?1 AND item_id = ?2 AND id = ?3 AND extra = 1 AND retention_status = 'active'")
    .bind(tenantId, item.id, page)
    .first<{ id: string }>();
  if (!r) throw notFound("Saved page");
  return r.id;
}
