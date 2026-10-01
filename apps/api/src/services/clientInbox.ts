/**
 * The Client Inbox (migration 0012). From the Eradigm Inbox an analyst can
 * send an entry to the client to check; the client reads it, comments on its
 * text (like Word comments), then sends it back to Eradigm or pushes it to the
 * Tracker. The entry stays "needs_review" throughout; `with_client_at` says
 * which inbox it is in.
 */
import { PAGE_TEXT_FIELD, type ItemComment, type ItemSummary, type Role } from "@eradigm/shared";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { ApiError, conflict, forbidden, notFound } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { audit } from "./audit.js";
import { getItemRow, getSummary, type ItemRow } from "./items.js";
import { approve } from "./review.js";
import type { Schemas } from "./schema.js";

function assertPending(row: ItemRow) {
  if (row.status !== "needs_review") throw conflict(`${row.code} is not awaiting review`);
}
function assertVersion(row: ItemRow, version: number) {
  if (row.version !== version) throw conflict("This entry was changed by someone else. Reload to see the latest version.");
}

/** Eradigm Inbox → Client Inbox. */
export async function sendToClient(env: Env, schemas: Schemas, p: Principal, id: string, version: number): Promise<ItemSummary> {
  const row = await getItemRow(env, p.tenantId, id);
  assertPending(row);
  if (row.with_client_at) throw conflict(`${row.code} is already with the client`);
  assertVersion(row, version);
  const now = nowIso();
  const res = await env.DB.prepare(
    "UPDATE intelligence_items SET with_client_at = ?1, sent_to_client_by = ?2, version = version + 1, updated_at = ?1 WHERE tenant_id = ?3 AND id = ?4 AND version = ?5 AND status = 'needs_review' AND with_client_at IS NULL",
  )
    .bind(now, p.userId, p.tenantId, id, version)
    .run();
  if (!res.meta.changes) throw conflict("This entry was changed by someone else. Reload to see the latest version.");
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "item.sent_to_client", targetType: "item", targetId: id, details: { code: row.code } });
  return getSummary(env, schemas, p.tenantId, id);
}

/** Client Inbox → Eradigm Inbox: by the client ("Send to Eradigm", keeping their comments) or by Eradigm (recall). */
export async function backToEradigm(env: Env, schemas: Schemas, p: Principal, id: string, version: number, by: "client" | "eradigm"): Promise<ItemSummary> {
  const row = await getItemRow(env, p.tenantId, id);
  assertPending(row);
  if (!row.with_client_at) throw conflict(`${row.code} is not in the Client Inbox`);
  assertVersion(row, version);
  const now = nowIso();
  const res = await env.DB.prepare(
    `UPDATE intelligence_items SET with_client_at = NULL${by === "client" ? ", client_returned_at = ?1, client_returned_by = ?2" : ""}, version = version + 1, updated_at = ?1
      WHERE tenant_id = ?3 AND id = ?4 AND version = ?5 AND with_client_at IS NOT NULL`,
  )
    .bind(now, p.userId, p.tenantId, id, version)
    .run();
  if (!res.meta.changes) throw conflict("This entry was changed by someone else. Reload to see the latest version.");
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: by === "client" ? "item.returned_by_client" : "item.recalled_from_client",
    targetType: "item",
    targetId: id,
    details: { code: row.code },
  });
  return getSummary(env, schemas, p.tenantId, id);
}

/** Client Inbox → Tracker: approved as it stands (the same checks as Push to Tracker in the Eradigm Inbox). */
export async function clientPush(env: Env, schemas: Schemas, p: Principal, id: string, version: number): Promise<ItemSummary> {
  const row = await getItemRow(env, p.tenantId, id);
  if (!row.with_client_at) throw conflict(`${row.code} is not in the Client Inbox`);
  const draft = JSON.parse(row.draft_json || "{}") as Record<string, unknown>;
  try {
    return await approve(env, schemas, p, id, draft, version, undefined, false, true);
  } catch (e) {
    // The client cannot complete or override the entry: say what to do instead.
    if (e instanceof ApiError && (e.code === "VALIDATION" || e.code === "DUPLICATE")) {
      throw new ApiError(e.code, `${e.message} Send it to Eradigm to complete it.`, e.fields, e.details);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** Who may read and write an entry's comments: Eradigm staff always; clients while it is in their inbox. */
async function commentableRow(env: Env, p: Principal, id: string, write: boolean): Promise<ItemRow> {
  const row = await getItemRow(env, p.tenantId, id);
  const staff = p.role === "admin" || p.role === "analyst";
  if (!staff && !row.with_client_at) throw notFound("Item");
  if (write && row.status !== "needs_review") throw conflict("Comments can only be added while the entry awaits review");
  return row;
}

interface CommentRow {
  id: string;
  field_key: string;
  start_offset: number;
  end_offset: number;
  quote: string;
  body: string;
  author_id: string;
  author_name: string | null;
  author_role: Role | null;
  created_at: string;
  resolved_at: string | null;
  resolver_name: string | null;
}

const toComment = (p: Principal, r: CommentRow): ItemComment => ({
  id: r.id,
  field: r.field_key,
  start: r.start_offset,
  end: r.end_offset,
  quote: r.quote,
  body: r.body,
  author: r.author_name ?? "—",
  authorRole: r.author_role ?? "client",
  mine: r.author_id === p.userId,
  at: r.created_at,
  resolved: r.resolved_at ? { by: r.resolver_name ?? "—", at: r.resolved_at } : null,
});

export async function listComments(env: Env, p: Principal, id: string): Promise<ItemComment[]> {
  await commentableRow(env, p, id, false);
  const res = await env.DB.prepare(
    `SELECT m.id, m.field_key, m.start_offset, m.end_offset, m.quote, m.body, m.author_id, m.created_at, m.resolved_at,
            (SELECT u.name FROM users u WHERE u.id = m.author_id) AS author_name,
            (SELECT r.role FROM role_assignments r WHERE r.user_id = m.author_id AND r.tenant_id = m.tenant_id LIMIT 1) AS author_role,
            (SELECT u.name FROM users u WHERE u.id = m.resolved_by) AS resolver_name
       FROM item_comments m WHERE m.tenant_id = ?1 AND m.item_id = ?2 AND m.deleted_at IS NULL ORDER BY m.field_key, m.start_offset, m.created_at`,
  )
    .bind(p.tenantId, id)
    .all<CommentRow>();
  return (res.results ?? []).map((r) => toComment(p, r));
}

export async function addComment(env: Env, p: Principal, id: string, c: { field: string; start: number; end: number; quote: string; body: string }): Promise<ItemComment[]> {
  const row = await commentableRow(env, p, id, true);
  if (c.end <= c.start) throw new ApiError("VALIDATION", "Highlight some text to comment on");
  const draft = JSON.parse(row.draft_json || "{}") as Record<string, unknown>;
  if (c.field !== PAGE_TEXT_FIELD && !(c.field in draft)) throw new ApiError("VALIDATION", "Unknown field");
  const cid = newId("cmt");
  await env.DB.prepare(
    "INSERT INTO item_comments (id, tenant_id, item_id, field_key, start_offset, end_offset, quote, body, author_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
  )
    .bind(cid, p.tenantId, id, c.field, c.start, c.end, c.quote.slice(0, 4000), c.body, p.userId, nowIso())
    .run();
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "comment.added", targetType: "item", targetId: id, details: { code: row.code, field: c.field } });
  return listComments(env, p, id);
}

/** Resolve or reopen (Eradigm), or delete (its author, or an admin). */
export async function updateComment(env: Env, p: Principal, id: string, cid: string, change: { resolved: boolean } | "delete"): Promise<ItemComment[]> {
  const row = await commentableRow(env, p, id, false);
  const c = await env.DB.prepare("SELECT author_id FROM item_comments WHERE tenant_id = ?1 AND item_id = ?2 AND id = ?3 AND deleted_at IS NULL")
    .bind(p.tenantId, id, cid)
    .first<{ author_id: string }>();
  if (!c) throw notFound("Comment");
  const now = nowIso();
  if (change === "delete") {
    if (c.author_id !== p.userId && p.role !== "admin") throw forbidden("Only its author can delete a comment");
    await env.DB.prepare("UPDATE item_comments SET deleted_at = ?1 WHERE tenant_id = ?2 AND id = ?3").bind(now, p.tenantId, cid).run();
  } else {
    if (p.role === "client") throw forbidden("Eradigm resolves comments");
    await env.DB.prepare("UPDATE item_comments SET resolved_at = ?1, resolved_by = ?2 WHERE tenant_id = ?3 AND id = ?4")
      .bind(change.resolved ? now : null, change.resolved ? p.userId : null, p.tenantId, cid)
      .run();
  }
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: change === "delete" ? "comment.deleted" : "comment.resolved",
    targetType: "item",
    targetId: id,
    details: { code: row.code, ...(change === "delete" ? {} : { resolved: change.resolved }) },
  });
  return listComments(env, p, id);
}
