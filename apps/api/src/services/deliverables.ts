/**
 * Deliverables: .docx Alerts and Newsletters.
 *
 * - Alerts (request 51): every Tracker entry has one, created the first time
 *   it is listed. It is written into "Alert Template.docx" each time it is
 *   opened (nothing large is stored per entry), from the entry's Phantom (as
 *   first pushed, like the Phantoms Markdown) or, without one, its fields.
 * - Newsletters: Database → Generate Newsletter (request 51) writes the
 *   ticked entries into "Newsletter Template.docx", each in the section it
 *   was assigned to (Technology, People or Process). The older Deliverables →
 *   Newsletter page still makes a title-only newsletter (`titleDocx`).
 */
import { FIELDS, docxFileName, titleDocx, type Newsletter, type NewsletterSection, type Signal, type Stream, type TrackerSchema } from "@eradigm/shared";
import { signalRows } from "./query.js";
import { alertDocx, newsletterDocx, type EntryForDoc } from "./templatedDocs.js";
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

/** Attach each row's alert, creating it where needed (its .docx is written when it is opened). */
export async function ensureAlerts(env: Env, tenantId: string, rows: Signal[]): Promise<Signal[]> {
  if (!rows.length) return rows;
  const list = () =>
    env.DB.prepare("SELECT id, item_id FROM deliverables WHERE tenant_id = ?1 AND kind = 'alert' AND deleted_at IS NULL AND item_id IN (SELECT value FROM json_each(?2))")
      .bind(tenantId, JSON.stringify(rows.map((r) => r.id)))
      .all<{ id: string; item_id: string }>()
      .then((r) => new Map((r.results ?? []).map((x) => [x.item_id, x])));
  let have = await list();
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    if (have.has(r.id)) continue;
    // A long page ("Display all") is completed over the next listings.
    if (stmts.length >= ALERTS_PAGE_MAX) break;
    stmts.push(
      // OR IGNORE: a concurrent listing may have created it first (unique per entry).
      env.DB.prepare(
        "INSERT OR IGNORE INTO deliverables (id, tenant_id, kind, item_id, source_rev, name, docx_b64, bytes, created_at, updated_at) VALUES (?1, ?2, 'alert', ?3, ?4, ?5, '', 0, ?6, ?6)",
      ).bind(newId("dlv"), tenantId, r.id, r.rev, alertName(r.values[FIELDS.id] as string | null, r.code), now),
    );
  }
  if (stmts.length) {
    await env.DB.batch(stmts);
    have = await list();
  }
  return rows.map((r) => ({ ...r, alertId: have.get(r.id)?.id ?? null }));
}

/** A deliverable's .docx: an alert written now from its entry's fields, a newsletter as it was made. */
export async function readDeliverable(
  env: Env,
  tenantId: string,
  id: string,
  schemaOf: (stream: Stream) => Promise<TrackerSchema>,
): Promise<{ kind: "alert" | "newsletter"; name: string; fileName: string; bytes: Uint8Array }> {
  const r = await env.DB.prepare("SELECT kind, name, item_id, docx_b64 FROM deliverables WHERE tenant_id = ?1 AND id = ?2 AND deleted_at IS NULL")
    .bind(tenantId, id)
    .first<{ kind: "alert" | "newsletter"; name: string; item_id: string | null; docx_b64: string }>();
  if (!r) throw notFound("Deliverable");
  if (r.kind === "alert" && r.item_id) {
    const e = (await entriesForDocs(env, tenantId, [r.item_id], schemaOf, "phantoms"))[0] ?? (await entriesForDocs(env, tenantId, [r.item_id], schemaOf))[0];
    if (!e) throw notFound("Alert");
    const name = alertName(e.values[FIELDS.id] as string | null, e.code);
    return { kind: "alert", name, fileName: docxFileName(name, "alert"), bytes: alertDocx(e) };
  }
  return { kind: r.kind, name: r.name, fileName: docxFileName(r.name, r.kind), bytes: fromBase64(r.docx_b64) };
}

/** Approved Tracker entries with the schema of their stream, in the order asked (missing ones left out). */
async function entriesForDocs(
  env: Env,
  tenantId: string,
  ids: string[],
  schemaOf: (stream: Stream) => Promise<TrackerSchema>,
  table: "tracker" | "phantoms" = "tracker",
): Promise<(EntryForDoc & { id: string; code: string })[]> {
  const schemas = { primary: await schemaOf("primary"), secondary: await schemaOf("secondary") };
  const rows = await signalRows(env, schemas, tenantId, ids, { table });
  return rows.map((r) => ({ id: r.id, code: r.code, schema: schemas[r.stream], values: r.values }));
}

/**
 * Delete a stored alert or newsletter (soft delete, audited). A deleted
 * alert's entry no longer appears in Deliverables → Alerts and gets no new
 * alert; the Phantom itself is not touched.
 */
export async function deleteDeliverable(env: Env, p: Principal, id: string): Promise<{ ok: true; kind: "alert" | "newsletter"; name: string }> {
  const r = await env.DB.prepare("SELECT kind, name, item_id FROM deliverables WHERE tenant_id = ?1 AND id = ?2 AND deleted_at IS NULL")
    .bind(p.tenantId, id)
    .first<{ kind: "alert" | "newsletter"; name: string; item_id: string | null }>();
  if (!r) throw notFound("Deliverable");
  await env.DB.prepare("UPDATE deliverables SET deleted_at = ?1, updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3 AND deleted_at IS NULL").bind(nowIso(), p.tenantId, id).run();
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "deliverable.deleted",
    targetType: "deliverable",
    targetId: id,
    details: { kind: r.kind, name: r.name, ...(r.item_id ? { itemId: r.item_id } : {}) },
  });
  return { ok: true, kind: r.kind, name: r.name };
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
  // Newsletters are built from Phantoms: their title, ID and Impact as first pushed to the Tracker.
  const res = await env.DB.prepare(
    `SELECT i.id, i.signal_code, COALESCE(p.record_id, i.record_id) AS record_id, COALESCE(p.title, i.title) AS title, i.stream, COALESCE(p.impact, i.impact) AS impact,
            i.status, i.deleted_at, i.phantoms_hidden_at
       FROM intelligence_items i LEFT JOIN phantom_snapshots p ON p.item_id = i.id WHERE i.tenant_id = ?1 AND i.id IN (SELECT value FROM json_each(?2))`,
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

// ---------------------------------------------------------------------------
// The Database page (request 43)
// ---------------------------------------------------------------------------

/**
 * The Database page's extras for a page of Tracker rows: whether each entry
 * is in Phantoms (`phantomImpacts`: the Phantom Impacts that count, null =
 * all), its alert (written now, as on Deliverables → Alerts, for a Phantom
 * with the highest Impact whose alert was never deleted) and the newsletters
 * it is in. Alerts are written from the Phantom (its evergreen snapshot), as
 * on Deliverables → Alerts, so both pages share one alert per entry.
 */
export async function databaseExtras(env: Env, tenantId: string, rows: Signal[], phantomImpacts: string[] | null): Promise<Signal[]> {
  if (!rows.length) return rows;
  const ids = JSON.stringify(rows.map((r) => r.id));
  const [snaps, deleted, letters] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.item_id, p.title, p.record_id, p.impact, p.published_rev FROM phantom_snapshots p JOIN intelligence_items i ON i.id = p.item_id
        WHERE i.tenant_id = ?1 AND i.phantoms_hidden_at IS NULL AND p.item_id IN (SELECT value FROM json_each(?2))`,
    ).bind(tenantId, ids),
    env.DB.prepare("SELECT DISTINCT item_id FROM deliverables WHERE tenant_id = ?1 AND kind = 'alert' AND deleted_at IS NOT NULL AND item_id IN (SELECT value FROM json_each(?2))").bind(tenantId, ids),
    env.DB.prepare(
      `SELECT d.id, d.name, d.created_at, j.value AS item_id FROM deliverables d, json_each(d.items_json) j
        WHERE d.tenant_id = ?1 AND d.kind = 'newsletter' AND d.deleted_at IS NULL AND j.value IN (SELECT value FROM json_each(?2))
        ORDER BY d.created_at DESC, d.id DESC`,
    ).bind(tenantId, ids),
  ]);
  type Snap = { item_id: string; title: string | null; record_id: string | null; impact: string | null; published_rev: number };
  const snap = new Map(((snaps?.results ?? []) as Snap[]).map((x) => [x.item_id, x]));
  const noAlert = new Set(((deleted?.results ?? []) as { item_id: string }[]).map((x) => x.item_id));
  const inLetters = new Map<string, { id: string; name: string; createdAt: string }[]>();
  for (const l of (letters?.results ?? []) as { id: string; name: string; created_at: string; item_id: string }[]) {
    const list = inLetters.get(l.item_id) ?? [];
    if (!list.some((x) => x.id === l.id)) list.push({ id: l.id, name: l.name, createdAt: l.created_at });
    inLetters.set(l.item_id, list);
  }
  const phantom = (id: string) => {
    const x = snap.get(id);
    return !!x && (!phantomImpacts || (!!x.impact && phantomImpacts.includes(x.impact)));
  };
  // Request 51: every entry has an alert (unless its alert was deleted).
  const due = rows.filter((r) => !noAlert.has(r.id));
  const alerts = new Map((await ensureAlerts(env, tenantId, due)).map((r) => [r.id, r.alertId ?? null]));
  return rows.map((r) => ({
    ...r,
    phantom: phantom(r.id),
    alertId: alerts.get(r.id) ?? null,
    alertPending: alerts.has(r.id) && !alerts.get(r.id),
    newsletters: inLetters.get(r.id) ?? [],
  }));
}

/** "Newsletter · 8 Oct 2026, 14:32" in the workspace's time zone. */
export function generatedNewsletterName(now: Date, timeZone: string): string {
  let when: string;
  try {
    when = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  } catch {
    when = now.toISOString().slice(0, 16).replace("T", " ");
  }
  return `Newsletter · ${when}`;
}

/**
 * Generate Newsletter (request 43; the template in request 51): the ticked
 * Database rows, any Tracker entries of either stream, each written into the
 * section of "Newsletter Template.docx" it was assigned to, in the order given.
 */
export async function generateNewsletter(
  env: Env,
  p: Principal,
  itemIds: string[],
  sections: Record<string, NewsletterSection>,
  timeZone: string,
  schemaOf: (stream: Stream) => Promise<TrackerSchema>,
): Promise<Newsletter> {
  const ids = [...new Set(itemIds)];
  for (const id of ids) if (!sections[id]) throw new ApiError("VALIDATION", "Choose Technology, People or Process for every selected entry.");
  const res = await env.DB.prepare(
    `SELECT i.id, i.signal_code, i.record_id, i.title, i.stream, i.status, i.deleted_at, i.tracker_hidden_at
       FROM intelligence_items i WHERE i.tenant_id = ?1 AND i.id IN (SELECT value FROM json_each(?2))`,
  )
    .bind(p.tenantId, JSON.stringify(ids))
    .all<{ id: string; signal_code: string | null; record_id: string | null; title: string | null; stream: Stream; status: string; deleted_at: string | null; tracker_hidden_at: string | null }>();
  const byId = new Map((res.results ?? []).map((r) => [r.id, r]));
  const rows = ids.map((id) => {
    const r = byId.get(id);
    if (!r || r.status !== "approved" || r.deleted_at || r.tracker_hidden_at) throw new ApiError("VALIDATION", "One of the selected entries is no longer in the database. Reload and select again.");
    return r;
  });
  const entries = new Map((await entriesForDocs(env, p.tenantId, ids, schemaOf)).map((e) => [e.id, e]));
  const grouped: Record<NewsletterSection, EntryForDoc[]> = { technology: [], people: [], process: [] };
  for (const id of ids) {
    const e = entries.get(id);
    if (e) grouped[sections[id]!].push(e);
  }
  const now = new Date();
  const name = generatedNewsletterName(now, timeZone);
  const doc = newsletterDocx(grouped, monthYear(now, timeZone));
  const id = newId("dlv");
  const at = nowIso();
  await env.DB.prepare(
    "INSERT INTO deliverables (id, tenant_id, kind, name, items_json, docx_b64, bytes, created_by, created_at, updated_at) VALUES (?1, ?2, 'newsletter', ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
  )
    .bind(id, p.tenantId, name, JSON.stringify(ids), toBase64(doc), doc.length, p.userId, at)
    .run();
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "deliverable.created",
    targetType: "deliverable",
    targetId: id,
    details: { kind: "newsletter", name, items: ids.length, generated: true, sections: Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.length])) },
  });
  return {
    id,
    name,
    createdAt: at,
    createdBy: p.name,
    items: rows.map((r) => ({ id: r.id, code: r.signal_code, recordId: r.record_id, title: r.title ?? "", stream: r.stream, deleted: false })),
  };
}

/** The month (1–12) and year now, in the workspace's time zone. */
export function monthYear(now: Date, timeZone: string): { month: number; year: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, month: "numeric", year: "numeric" }).formatToParts(now);
    const n = (t: string) => Number(parts.find((x) => x.type === t)?.value);
    if (n("month") && n("year")) return { month: n("month"), year: n("year") };
  } catch {
    /* unknown time zone: UTC */
  }
  return { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
}
