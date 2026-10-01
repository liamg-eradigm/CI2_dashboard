/**
 * Deliverables built from Phantoms: .docx Alerts and Newsletters.
 *
 * - Alerts: every Phantom with the highest Impact (High) gets one alert,
 *   generated automatically the first time it is listed and regenerated when
 *   the entry is revised (the stored `source_rev` is its published revision).
 * - Newsletters: an analyst selects Newsletter entries (High / Medium Impact
 *   Phantoms), names the newsletter and creates it.
 *
 * The content is a placeholder until the AI writer is connected: the entry's
 * Title (alerts) or the newsletter's name, in bold 32 pt (`titleDocx`).
 */
import { CORE, FIELDS, docxFileName, titleDocx, type Newsletter, type Signal, type Stream } from "@eradigm/shared";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { ApiError, notFound } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { audit } from "./audit.js";

/** D1 allows 50 queries per request on the free plan: generate at most this many alerts per listing (the rest on the next one). */
export const ALERTS_PAGE_MAX = 25;

function toBase64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** "P-1106 alert": the entry's ID, else its signal code. */
export const alertName = (recordId: string | null | undefined, code: string) => `${recordId?.trim() || code} alert`;

/** Attach each row's alert, creating or refreshing the stored .docx where needed. */
export async function ensureAlerts(env: Env, tenantId: string, rows: Signal[]): Promise<Signal[]> {
  if (!rows.length) return rows;
  const list = () =>
    env.DB.prepare(
      "SELECT id, item_id, source_rev FROM deliverables WHERE tenant_id = ?1 AND kind = 'alert' AND deleted_at IS NULL AND item_id IN (SELECT value FROM json_each(?2))",
    )
      .bind(tenantId, JSON.stringify(rows.map((r) => r.id)))
      .all<{ id: string; item_id: string; source_rev: number | null }>()
      .then((r) => new Map((r.results ?? []).map((x) => [x.item_id, x])));
  let have = await list();
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const cur = have.get(r.id);
    if (cur && cur.source_rev === r.rev) continue;
    // A long page ("Display all") is completed over the next listings.
    if (stmts.length >= ALERTS_PAGE_MAX) break;
    const doc = titleDocx(String(r.values[CORE.title] ?? ""));
    const name = alertName(r.values[FIELDS.id] as string | null, r.code);
    stmts.push(
      cur
        ? env.DB.prepare("UPDATE deliverables SET docx_b64 = ?1, bytes = ?2, source_rev = ?3, name = ?4, updated_at = ?5 WHERE tenant_id = ?6 AND id = ?7").bind(
            toBase64(doc),
            doc.length,
            r.rev,
            name,
            now,
            tenantId,
            cur.id,
          )
        : // OR IGNORE: a concurrent listing may have created it first (unique per entry).
          env.DB.prepare(
            "INSERT OR IGNORE INTO deliverables (id, tenant_id, kind, item_id, source_rev, name, docx_b64, bytes, created_at, updated_at) VALUES (?1, ?2, 'alert', ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
          ).bind(newId("dlv"), tenantId, r.id, r.rev, name, toBase64(doc), doc.length, now),
    );
  }
  if (stmts.length) {
    await env.DB.batch(stmts);
    have = await list();
  }
  return rows.map((r) => ({ ...r, alertId: have.get(r.id)?.id ?? null }));
}

/** A stored deliverable's .docx. */
export async function readDeliverable(env: Env, tenantId: string, id: string): Promise<{ kind: "alert" | "newsletter"; name: string; fileName: string; bytes: Uint8Array }> {
  const r = await env.DB.prepare("SELECT kind, name, docx_b64 FROM deliverables WHERE tenant_id = ?1 AND id = ?2 AND deleted_at IS NULL")
    .bind(tenantId, id)
    .first<{ kind: "alert" | "newsletter"; name: string; docx_b64: string }>();
  if (!r) throw notFound("Deliverable");
  return { kind: r.kind, name: r.name, fileName: docxFileName(r.name, r.kind), bytes: fromBase64(r.docx_b64) };
}

interface ItemRef {
  id: string;
  signal_code: string | null;
  record_id: string | null;
  title: string | null;
  stream: Stream;
  impact: string | null;
  status: string;
  deleted_at: string | null;
  phantoms_hidden_at: string | null;
}

async function itemRefs(env: Env, tenantId: string, ids: string[]): Promise<Map<string, ItemRef>> {
  if (!ids.length) return new Map();
  const res = await env.DB.prepare(
    "SELECT id, signal_code, record_id, title, stream, impact, status, deleted_at, phantoms_hidden_at FROM intelligence_items WHERE tenant_id = ?1 AND id IN (SELECT value FROM json_each(?2))",
  )
    .bind(tenantId, JSON.stringify(ids))
    .all<ItemRef>();
  return new Map((res.results ?? []).map((r) => [r.id, r]));
}

const toItems = (ids: string[], refs: Map<string, ItemRef>): Newsletter["items"] =>
  ids.map((id) => {
    const r = refs.get(id);
    return { id, code: r?.signal_code ?? null, recordId: r?.record_id ?? null, title: r?.title ?? "", stream: r?.stream ?? "primary", deleted: !r || r.status !== "approved" || !!r.deleted_at };
  });

/** Newsletters, newest first, with the Phantoms each was built from. */
export async function listNewsletters(env: Env, tenantId: string): Promise<Newsletter[]> {
  const res = await env.DB.prepare(
    `SELECT d.id, d.name, d.items_json, d.created_at, (SELECT u.name FROM users u WHERE u.id = d.created_by) AS created_by
       FROM deliverables d WHERE d.tenant_id = ?1 AND d.kind = 'newsletter' AND d.deleted_at IS NULL ORDER BY d.created_at DESC, d.id DESC LIMIT 200`,
  )
    .bind(tenantId)
    .all<{ id: string; name: string; items_json: string; created_at: string; created_by: string | null }>();
  const rows = (res.results ?? []).map((r) => ({ ...r, ids: JSON.parse(r.items_json || "[]") as string[] }));
  const refs = await itemRefs(env, tenantId, [...new Set(rows.flatMap((r) => r.ids))]);
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, createdBy: r.created_by ?? "—", items: toItems(r.ids, refs) }));
}

/**
 * Create a newsletter from Newsletter entries. `isNewsletterEntry` applies the
 * same rule as the Newsletter table (a Phantom with High or Medium Impact).
 */
export async function createNewsletter(
  env: Env,
  p: Principal,
  name: string,
  itemIds: string[],
  isNewsletterEntry: (stream: Stream, impact: string | null) => Promise<boolean>,
): Promise<Newsletter> {
  const ids = [...new Set(itemIds)];
  const refs = await itemRefs(env, p.tenantId, ids);
  for (const id of ids) {
    const r = refs.get(id);
    if (!r || r.status !== "approved" || r.deleted_at) throw new ApiError("VALIDATION", "One of the selected entries is no longer in the tracker. Reload and select again.");
    if (r.phantoms_hidden_at || !(await isNewsletterEntry(r.stream, r.impact))) {
      throw new ApiError("VALIDATION", `${r.signal_code ?? "An entry"} is not a Newsletter entry (Phantoms with High or Medium Impact only)`);
    }
  }
  const doc = titleDocx(name);
  const id = newId("dlv");
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO deliverables (id, tenant_id, kind, name, items_json, docx_b64, bytes, created_by, created_at, updated_at) VALUES (?1, ?2, 'newsletter', ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
  )
    .bind(id, p.tenantId, name, JSON.stringify(ids), toBase64(doc), doc.length, p.userId, now)
    .run();
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "deliverable.created", targetType: "deliverable", targetId: id, details: { kind: "newsletter", name, items: ids.length } });
  return { id, name, createdAt: now, createdBy: p.name, items: toItems(ids, refs) };
}
