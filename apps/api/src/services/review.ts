/**
 * Review decisions. Every state change is:
 *   - validated server-side against the tenant's current schema,
 *   - guarded by optimistic concurrency (`version`) and an operation token so
 *     concurrent reviewers cannot both win,
 *   - written atomically (D1 batch) with its revision / decision records,
 *   - audited.
 * Approval never overwrites the source snapshot or processing history.
 */
import {
  CORE,
  FIELDS,
  SOURCE_TIER,
  autoRecordId,
  can,
  canTransition,
  flattenKiqs,
  normaliseValues,
  primarySourceKey,
  withKiq,
  type KiqTopic,
  validateValues,
  type ClearDecidedResult,
  type ItemStatus,
  type ItemSummary,
  type ItemValues,
  type Stream,
  type TrackerSchema,
} from "@eradigm/shared";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { ApiError, conflict, forbidden } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { metric } from "../lib/log.js";
import { enqueue } from "../pipeline/process.js";
import { audit } from "./audit.js";
import { snapshotPhantom } from "./phantoms.js";
import { DUPLICATE_BASIS_LABEL, NO_PUBLISHED_DUPLICATE, getItemRow, getSummaries, getSummary, nextCode, nextInboxCodes, publishedDuplicate, type ItemRow, type PublishedDuplicate } from "./items.js";
import { PHYSICAL, loadSettings, type Schemas } from "./schema.js";

function same(a: ItemValues[string] | undefined, b: ItemValues[string] | undefined): boolean {
  const norm = (v: ItemValues[string] | undefined) => (v == null ? null : Array.isArray(v) ? [...v].sort().join("\u0001") : v);
  return norm(a) === norm(b);
}

function changedKeys(schema: TrackerSchema, a: ItemValues, b: ItemValues): string[] {
  return schema.columns.filter((c) => !same(a[c.key], b[c.key])).map((c) => c.key);
}

function assertTransition(from: ItemStatus, to: ItemStatus, what: string) {
  if (!canTransition(from, to)) throw conflict(`This item is ${from.replace("_", " ")} and cannot be ${what}`);
}

/** While an entry is with the client, Eradigm cannot change it (recall it first). */
export function assertNotWithClient(row: ItemRow) {
  if (row.with_client_at) throw conflict(`${row.code} is with the client. Recall it to the Eradigm Inbox first.`);
}

function assertVersion(row: ItemRow, version: number | undefined) {
  if (version !== undefined && row.version !== version) {
    throw conflict("This item was changed by someone else. Reload to see the latest version.");
  }
}

async function nextSeq(env: Env, itemId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM item_revisions WHERE item_id = ?1").bind(itemId).first<{ n: number }>();
  return r?.n ?? 1;
}

async function aiDraft(env: Env, tenantId: string, itemId: string): Promise<ItemValues | null> {
  const r = await env.DB.prepare("SELECT values_json FROM item_revisions WHERE tenant_id = ?1 AND item_id = ?2 AND kind = 'llm_draft' ORDER BY seq DESC LIMIT 1")
    .bind(tenantId, itemId)
    .first<{ values_json: string }>();
  return r ? (JSON.parse(r.values_json) as ItemValues) : null;
}

function guard(env: Env, itemId: string, token: string) {
  return { sql: "EXISTS (SELECT 1 FROM intelligence_items WHERE id = ? AND op_token = ?)", binds: [itemId, token] };
}

/** Statements that write the published projection (tracker columns + competitor associations). */
/** A Primary entry's source (Source Role + Source Company), for linking entries from the same source; null otherwise. */
export function sourceKeyFor(schema: TrackerSchema, values: ItemValues): string | null {
  const has = (k: string) => schema.columns.some((c) => c.key === k);
  return has(FIELDS.sourceRole) && has(FIELDS.sourceCompany) ? primarySourceKey(values[FIELDS.sourceRole], values[FIELDS.sourceCompany]) : null;
}

function projectionStatements(env: Env, schema: TrackerSchema, tenantId: string, itemId: string, values: ItemValues, token: string): D1PreparedStatement[] {
  const g = guard(env, itemId, token);
  const extra: Record<string, unknown> = {};
  for (const c of schema.columns) if (!PHYSICAL[c.key] && c.key !== CORE.competitors) extra[c.key] = values[c.key] ?? null;
  const comps = Array.isArray(values[CORE.competitors]) ? (values[CORE.competitors] as string[]) : [];
  return [
    env.DB.prepare(
      `UPDATE intelligence_items SET pub_date = ?1, title = ?2, macrotrend = ?3, subtrend = ?4, growth = ?5, impact = ?6, extra_json = ?7, record_id = ?11, source_key = ?12 WHERE id = ?8 AND tenant_id = ?9 AND op_token = ?10`,
    ).bind(
      values[CORE.date] ?? null,
      values[CORE.title] ?? null,
      values[CORE.macrotrend] ?? null,
      values[CORE.subtrend] ?? null,
      values[CORE.growth] ?? null,
      values[CORE.impact] ?? null,
      JSON.stringify(extra),
      itemId,
      tenantId,
      token,
      typeof values[FIELDS.id] === "string" ? values[FIELDS.id] : null,
      sourceKeyFor(schema, values),
    ),
    env.DB.prepare(`DELETE FROM item_competitors WHERE item_id = ? AND ${g.sql}`).bind(itemId, ...g.binds),
    ...comps.map((c) =>
      env.DB.prepare(`INSERT INTO item_competitors (tenant_id, item_id, competitor) SELECT ?, ?, ? WHERE ${g.sql}`).bind(tenantId, itemId, c, ...g.binds),
    ),
  ];
}

function duplicateError(row: ItemRow, dup: PublishedDuplicate): ApiError {
  return new ApiError(
    "DUPLICATE",
    `${row.code} is a duplicate of ${dup.signalCode}, which is already in the tracker (${DUPLICATE_BASIS_LABEL[dup.basis]}). Approving it will add a second tracker entry.`,
    undefined,
    { duplicateOf: dup.signalCode, duplicateItemId: dup.id, basis: dup.basis },
  );
}

/** Values the platform owns: Source Tier always matches the stream the source was uploaded to. */
function withAutoValues(schema: TrackerSchema, row: ItemRow, values: ItemValues): ItemValues {
  if (!schema.columns.some((c) => c.key === FIELDS.sourceTier)) return values;
  return { ...values, [FIELDS.sourceTier]: SOURCE_TIER[row.stream] ?? SOURCE_TIER.primary };
}

/**
 * Inbox entries' IDs are filled in automatically (contract 1.15):
 * Date_Competitor_Title (Secondary) or Date_Competitor_Key Intelligence
 * Question (Primary), once those fields are filled in.
 */
function withAutoId(schema: TrackerSchema, row: ItemRow, values: ItemValues): ItemValues {
  if (!schema.columns.some((c) => c.key === FIELDS.id)) return values;
  const id = autoRecordId(row.stream, values);
  return id ? { ...values, [FIELDS.id]: id } : values;
}

/**
 * Free IDs for automatic ones: each base as it is, or with _2, _3… when a
 * Tracker entry (or an earlier base in the list) already has it.
 */
export async function freeRecordIds(env: Env, tenantId: string, bases: string[], excludeItemId: string | null): Promise<string[]> {
  if (!bases.length) return [];
  const uniq = [...new Set(bases)];
  const taken = new Set<string>();
  // D1 limits LIKE patterns to 50 characters, so prefixes are compared with substr.
  for (let i = 0; i < uniq.length; i += 40) {
    const chunk = uniq.slice(i, i + 40);
    const conds = chunk.map((_, j) => `record_id = ?${3 + j} OR substr(record_id, 1, length(?${3 + j}) + 1) = ?${3 + j} || '_'`).join(" OR ");
    const res = await env.DB.prepare(`SELECT record_id FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved' AND id <> ?2 AND (${conds})`)
      .bind(tenantId, excludeItemId ?? "", ...chunk)
      .all<{ record_id: string }>();
    for (const r of res.results ?? []) taken.add(r.record_id);
  }
  return bases.map((b) => {
    let id = b;
    for (let n = 2; taken.has(id); n++) id = `${b}_${n}`;
    taken.add(id);
    return id;
  });
}

/** Today's date (YYYY-MM-DD) in the tenant's time zone. */
export async function todayIn(env: Env, tenantId: string): Promise<string> {
  const { timezone } = await loadSettings(env, tenantId);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** The analyst-entered ID must be unique among tracker entries (it names the Phantoms Markdown file). */
async function assertUniqueId(env: Env, tenantId: string, id: string, values: ItemValues, label: string): Promise<void> {
  const rid = values[FIELDS.id];
  if (typeof rid !== "string" || !rid) return;
  const other = await env.DB.prepare("SELECT signal_code, title FROM intelligence_items WHERE tenant_id = ?1 AND record_id = ?2 AND status = 'approved' AND id <> ?3 LIMIT 1")
    .bind(tenantId, rid, id)
    .first<{ signal_code: string; title: string | null }>();
  if (other) throw idTaken(rid, label, other.signal_code, other.title);
}

function idTaken(rid: string, label: string, code?: string, title?: string | null): ApiError {
  const msg = `${label} “${rid}” is already used by ${code ? `${code}${title ? ` (“${title}”)` : ""}` : "another tracker entry"}. Each entry needs its own ${label}.`;
  return new ApiError("VALIDATION", msg, [{ key: FIELDS.id, label, code: "duplicate_id", message: msg }]);
}

function isUniqueViolation(err: unknown): boolean {
  return /UNIQUE/i.test(String((err as Error)?.message ?? err)) && /record/i.test(String((err as Error)?.message ?? err));
}

function validationError(errors: ReturnType<typeof validateValues>): ApiError {
  return new ApiError("VALIDATION", `Validation failed. Complete: ${errors.map((e) => e.label).join(", ")}`, errors);
}

// ---------------------------------------------------------------------------

export async function saveDraft(
  env: Env,
  schemas: Schemas,
  p: Principal,
  id: string,
  raw: Record<string, unknown>,
  version: number,
  /** Primary entries: the topics and Key Intelligence Questions (the first fills the entry's own fields). */
  kiqs?: KiqTopic[],
): Promise<ItemSummary> {
  const row = await getItemRow(env, p.tenantId, id);
  assertNotWithClient(row);
  const schema = schemas[row.stream];
  if (row.status !== "needs_review") throw conflict("Only drafts awaiting review can be edited");
  assertVersion(row, version);
  const useKiqs = kiqs && row.stream === "primary";
  let values = withAutoValues(schema, row, normaliseValues(schema, raw));
  if (useKiqs) values = withKiq(values, flattenKiqs(kiqs)[0]);
  values = withAutoId(schema, row, values);
  const errors = validateValues(schema, values, { forApproval: false });
  if (errors.length) throw new ApiError("VALIDATION", errors[0]?.message ?? "Invalid value", errors);
  const current = normaliseValues(schema, JSON.parse(row.draft_json || "{}"));
  const changed = changedKeys(schema, current, values);
  const kiqJson = useKiqs ? JSON.stringify(kiqs) : row.kiq_json;
  if (!changed.length && kiqJson === row.kiq_json) return getSummary(env, schemas, p.tenantId, id);
  const prov = JSON.parse(row.provenance_json || "{}") as Record<string, string | null>;
  for (const k of changed) prov[k] = values[k] == null ? null : "analyst";
  const token = newId("op");
  const now = nowIso();
  const g = guard(env, id, token);
  const res = await env.DB.batch([
    env.DB.prepare(
      "UPDATE intelligence_items SET draft_json = ?1, provenance_json = ?2, kiq_json = ?8, version = version + 1, op_token = ?3, updated_at = ?4 WHERE tenant_id = ?5 AND id = ?6 AND version = ?7 AND status = 'needs_review'",
    ).bind(JSON.stringify(values), JSON.stringify(prov), token, now, p.tenantId, id, version, kiqJson),
    env.DB.prepare(
      `INSERT INTO item_revisions (id, tenant_id, item_id, seq, kind, values_json, provenance_json, changed_keys, created_by, created_at, note)
       SELECT ?, ?, ?, ?, 'analyst_edit', ?, ?, ?, ?, ?, 'Analyst edit' WHERE ${g.sql}`,
    ).bind(newId("rev"), p.tenantId, id, await nextSeq(env, id), JSON.stringify(values), JSON.stringify(prov), JSON.stringify(changed), p.userId, now, ...g.binds),
  ]);
  if ((res[0]?.meta.changes ?? 0) === 0) throw conflict("This item was changed by someone else. Reload to see the latest version.");
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "item.edited", targetType: "item", targetId: id, details: { changedKeys: changed } });
  return getSummary(env, schemas, p.tenantId, id);
}

export async function approve(
  env: Env,
  schemas: Schemas,
  p: Principal,
  id: string,
  raw: Record<string, unknown>,
  version: number,
  note?: string,
  overrideDuplicate = false,
  /** Pushed to the Tracker from the Client Inbox (by the client), not the Eradigm Inbox. */
  fromClientInbox = false,
): Promise<ItemSummary> {
  const row = await getItemRow(env, p.tenantId, id);
  const schema = schemas[row.stream];
  assertTransition(row.status, "approved", "approved");
  if (row.status !== "needs_review") throw conflict("Only drafts awaiting review can be approved");
  if (fromClientInbox && !row.with_client_at) throw conflict(`${row.code} is no longer in the Client Inbox`);
  if (!fromClientInbox) assertNotWithClient(row);
  assertVersion(row, version);
  const values = withAutoId(schema, row, withAutoValues(schema, row, normaliseValues(schema, raw)));
  // An automatic ID already used by a Tracker entry gets _2, _3…
  const rid = values[FIELDS.id];
  if (typeof rid === "string" && rid === autoRecordId(row.stream, values)) values[FIELDS.id] = (await freeRecordIds(env, p.tenantId, [rid], id))[0] ?? rid;
  // Review Date defaults to the day of approval when the analyst leaves it empty.
  if (!values[FIELDS.reviewDate] && schema.columns.some((c) => c.key === FIELDS.reviewDate)) values[FIELDS.reviewDate] = await todayIn(env, p.tenantId);
  const errors = validateValues(schema, values, { forApproval: true });
  if (errors.length) throw validationError(errors);
  const idLabel = schema.columns.find((c) => c.key === FIELDS.id)?.label ?? "ID";
  await assertUniqueId(env, p.tenantId, id, values, idLabel);
  // The same source already in the tracker: the reviewer must explicitly confirm.
  const dup = await publishedDuplicate(env, p.tenantId, id);
  if (dup && !overrideDuplicate) throw duplicateError(row, dup);

  // Corrections are measured against the AI draft; manually entered drafts have none.
  const ai = await aiDraft(env, p.tenantId, id);
  const corrected = ai ? changedKeys(schema, normaliseValues(schema, ai), values) : [];
  const prov = JSON.parse(row.provenance_json || "{}") as Record<string, string | null>;
  const currentDraft = normaliseValues(schema, JSON.parse(row.draft_json || "{}"));
  for (const k of changedKeys(schema, currentDraft, values)) prov[k] = values[k] == null ? null : "analyst";
  for (const k of corrected) if (values[k] != null) prov[k] = "analyst";

  const signalCode = row.signal_code ?? (await nextCode(env, p.tenantId, "signal"));
  const pub = await env.DB.prepare("SELECT COALESCE(MAX(published_rev), 0) + 1 AS n FROM item_revisions WHERE item_id = ?1").bind(id).first<{ n: number }>();
  const rev = pub?.n ?? 1;
  const token = newId("op");
  const now = nowIso();
  const g = guard(env, id, token);
  const revId = newId("rev");
  let res: D1Result[];
  try {
    res = await env.DB.batch([
    env.DB.prepare(
      `UPDATE intelligence_items SET status = 'approved', draft_json = ?, provenance_json = ?, signal_code = ?, published_rev = ?, approved_at = ?, approved_by = ?,
              with_client_at = NULL, version = version + 1, op_token = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND version = ? AND status = 'needs_review'${overrideDuplicate ? "" : ` AND ${NO_PUBLISHED_DUPLICATE}`}`,
    ).bind(JSON.stringify(values), JSON.stringify(prov), signalCode, rev, now, p.userId, token, now, p.tenantId, id, version, ...(overrideDuplicate ? [] : [id])),
    ...projectionStatements(env, schema, p.tenantId, id, values, token),
    // Its Phantom: frozen as first pushed to the Tracker.
    snapshotPhantom(env, p.tenantId, id),
    env.DB.prepare(
      `INSERT INTO item_revisions (id, tenant_id, item_id, seq, kind, published_rev, values_json, provenance_json, changed_keys, created_by, created_at, note)
       SELECT ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ? WHERE ${g.sql}`,
    ).bind(
      revId,
      p.tenantId,
      id,
      await nextSeq(env, id),
      rev,
      JSON.stringify(values),
      JSON.stringify(prov),
      JSON.stringify(corrected),
      p.userId,
      now,
      note?.trim() ||
        (fromClientInbox
          ? "Pushed to the Tracker from the Client Inbox · validation passed"
          : dup
            ? `Pushed to the Tracker from the Eradigm Inbox · confirmed although ${dup.signalCode} is already in the tracker`
            : "Pushed to the Tracker from the Eradigm Inbox · validation passed"),
      ...g.binds,
    ),
    env.DB.prepare(
      `INSERT INTO review_decisions (id, tenant_id, item_id, revision_id, decision, reviewer_id, decided_at, note, corrected_keys)
       SELECT ?, ?, ?, ?, 'approve', ?, ?, ?, ? WHERE ${g.sql}`,
    ).bind(newId("dec"), p.tenantId, id, revId, p.userId, now, note ?? null, JSON.stringify(corrected), ...g.binds),
  ]);
  } catch (err) {
    // Another entry took the same ID between the check and the write.
    if (isUniqueViolation(err)) throw idTaken(String(values[FIELDS.id]), idLabel);
    throw err;
  }
  if ((res[0]?.meta.changes ?? 0) === 0) {
    // Another copy of the same source was approved in the meantime.
    const raced = overrideDuplicate ? null : await publishedDuplicate(env, p.tenantId, id);
    if (raced) throw duplicateError(row, raced);
    throw conflict("This item was changed by someone else. Reload to see the latest version.");
  }
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "item.approved",
    targetType: "item",
    targetId: id,
    details: { signalCode, rev, correctedKeys: corrected, ...(dup ? { duplicateOverride: { of: dup.signalCode, basis: dup.basis } } : {}) },
  });
  metric(env, "item_approved", 1, { tenant: p.tenantId });
  return getSummary(env, schemas, p.tenantId, id);
}

/**
 * Edit an approved entry and approve it again. The new version goes through
 * the approval checks again (required fields, options, dates, unique ID), is
 * published as a new revision, and is re-stamped as approved by the editor
 * (QC Reviewed_by) today (Review Date, unless the editor set it). The Tracker,
 * Dashboard and Megatrends follow the new revision; Phantoms (with their
 * Markdown, alerts and newsletters) keep the entry as first pushed.
 */
export async function revise(env: Env, schemas: Schemas, p: Principal, id: string, raw: Record<string, unknown>, note?: string): Promise<void> {
  const row = await getItemRow(env, p.tenantId, id);
  const schema = schemas[row.stream];
  if (row.status !== "approved") throw conflict("Only approved entries can be edited here");
  const values = withAutoValues(schema, row, normaliseValues(schema, raw));
  const current = normaliseValues(schema, JSON.parse(row.draft_json || "{}"));
  const changed = changedKeys(schema, current, values);
  if (!changed.length) throw new ApiError("BAD_REQUEST", "Nothing changed");
  // Re-approved today, unless the editor chose the Review Date themselves.
  if (schema.columns.some((c) => c.key === FIELDS.reviewDate) && (!values[FIELDS.reviewDate] || !changed.includes(FIELDS.reviewDate))) {
    values[FIELDS.reviewDate] = await todayIn(env, p.tenantId);
    if (current[FIELDS.reviewDate] !== values[FIELDS.reviewDate] && !changed.includes(FIELDS.reviewDate)) changed.push(FIELDS.reviewDate);
  }
  const errors = validateValues(schema, values, { forApproval: true });
  if (errors.length) throw validationError(errors);
  const idLabel = schema.columns.find((c) => c.key === FIELDS.id)?.label ?? "ID";
  await assertUniqueId(env, p.tenantId, id, values, idLabel);
  const prov = JSON.parse(row.provenance_json || "{}") as Record<string, string | null>;
  for (const k of changed) prov[k] = values[k] == null ? null : "analyst";
  const pub = await env.DB.prepare("SELECT COALESCE(MAX(published_rev), 0) + 1 AS n FROM item_revisions WHERE item_id = ?1").bind(id).first<{ n: number }>();
  const rev = pub?.n ?? 2;
  const token = newId("op");
  const now = nowIso();
  const g = guard(env, id, token);
  let res: D1Result[];
  try {
    res = await env.DB.batch([
    env.DB.prepare(
      "UPDATE intelligence_items SET draft_json = ?1, provenance_json = ?2, published_rev = ?3, approved_at = ?5, approved_by = ?9, version = version + 1, op_token = ?4, updated_at = ?5 WHERE tenant_id = ?6 AND id = ?7 AND version = ?8 AND status = 'approved'",
    ).bind(JSON.stringify(values), JSON.stringify(prov), rev, token, now, p.tenantId, id, row.version, p.userId),
    ...projectionStatements(env, schema, p.tenantId, id, values, token),
    env.DB.prepare(
      `INSERT INTO item_revisions (id, tenant_id, item_id, seq, kind, published_rev, values_json, provenance_json, changed_keys, created_by, created_at, note)
       SELECT ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ? WHERE ${g.sql}`,
    ).bind(newId("rev"), p.tenantId, id, await nextSeq(env, id), rev, JSON.stringify(values), JSON.stringify(prov), JSON.stringify(changed), p.userId, now, note?.trim() || "Edited and re-approved", ...g.binds),
  ]);
  } catch (err) {
    if (isUniqueViolation(err)) throw idTaken(String(values[FIELDS.id]), idLabel);
    throw err;
  }
  if ((res[0]?.meta.changes ?? 0) === 0) throw conflict("This signal was changed by someone else. Reload to see the latest version.");
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "item.revised", targetType: "item", targetId: id, details: { rev, changedKeys: changed } });
}

/**
 * A Primary entry with several Key Intelligence Questions becomes one Inbox
 * entry per question, before Push to Tracker: this entry keeps the first;
 * new entries (split_from = this one, codes reserved at once) take the others,
 * sharing every other field, its text and saved page. Fingerprints (URL, file,
 * text) stay with this entry, so the new ones are not flagged as duplicates
 * of it. Staff split entries in the Eradigm Inbox; the client those in theirs.
 */
export async function splitItem(env: Env, schemas: Schemas, p: Principal, id: string, version: number, kiqs: KiqTopic[]): Promise<ItemSummary[]> {
  const row = await getItemRow(env, p.tenantId, id);
  if (row.stream !== "primary") throw new ApiError("BAD_REQUEST", "Only Primary entries have Key Intelligence Questions");
  if (row.status !== "needs_review") throw conflict(`${row.code} is not awaiting review`);
  if (row.with_client_at ? !can(p.role, "clientInbox:act") : !can(p.role, "item:review")) throw forbidden("You cannot push this entry to the Tracker");
  assertVersion(row, version);
  const schema = schemas.primary;
  const rows = flattenKiqs(kiqs);
  if (!rows.length) throw new ApiError("VALIDATION", "Add at least one Key Intelligence Question", [{ key: FIELDS.keyQuestion, label: "Key Intelligence Question", code: "required", message: "Add at least one Key Intelligence Question" }]);
  const base = normaliseValues(schema, JSON.parse(row.draft_json || "{}"));
  const valuesOf = (i: number) => withAutoId(schema, row, withAutoValues(schema, row, withKiq(base, rows[i])));
  const one = (r: (typeof rows)[number]) => JSON.stringify([{ topic: r.topic, kiqs: [{ question: r.question, details: r.details, metrics: r.metrics }] }]);
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      "UPDATE intelligence_items SET draft_json = ?1, kiq_json = ?2, version = version + 1, updated_at = ?3 WHERE tenant_id = ?4 AND id = ?5 AND version = ?6 AND status = 'needs_review'",
    ).bind(JSON.stringify(valuesOf(0)), one(rows[0]!), now, p.tenantId, id, version),
  ];
  const ids = [id];
  if (rows.length > 1) {
    const codes = await nextInboxCodes(env, p.tenantId, rows.length - 1);
    const reset: Record<string, unknown> = {
      url_key: null,
      file_sha256: null,
      content_sha256: null,
      duplicate_of: null,
      signal_code: null,
      published_rev: null,
      approved_at: null,
      approved_by: null,
      record_id: null,
      op_token: null,
      version: 1,
      split_from: row.split_from ?? row.id,
      created_at: now,
      updated_at: now,
    };
    const cols = Object.keys(row as unknown as Record<string, unknown>);
    for (let i = 1; i < rows.length; i++) {
      const nid = newId("itm");
      ids.push(nid);
      const rec: Record<string, unknown> = { ...(row as unknown as Record<string, unknown>), ...reset, id: nid, code: codes[i - 1], draft_json: JSON.stringify(valuesOf(i)), kiq_json: one(rows[i]!) };
      stmts.push(env.DB.prepare(`INSERT INTO intelligence_items (${cols.join(", ")}) VALUES (${cols.map((_, j) => `?${j + 1}`).join(", ")})`).bind(...cols.map((c) => rec[c] ?? null)));
    }
  }
  const res = await env.DB.batch(stmts);
  if ((res[0]?.meta.changes ?? 0) === 0) throw conflict("This entry was changed by someone else. Reload to see the latest version.");
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "item.split", targetType: "item", targetId: id, details: { code: row.code, entries: rows.length } });
  return getSummaries(env, schemas, p.tenantId, ids);
}

export async function reject(env: Env, schemas: Schemas, p: Principal, id: string, reason: string | undefined, version: number): Promise<ItemSummary> {
  const row = await getItemRow(env, p.tenantId, id);
  assertNotWithClient(row);
  assertTransition(row.status, "rejected", "rejected");
  assertVersion(row, version);
  const token = newId("op");
  const now = nowIso();
  const g = guard(env, id, token);
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE intelligence_items SET status = 'rejected', version = version + 1, op_token = ?1, updated_at = ?2 WHERE tenant_id = ?3 AND id = ?4 AND version = ?5 AND status = 'needs_review'").bind(
      token,
      now,
      p.tenantId,
      id,
      version,
    ),
    env.DB.prepare(`INSERT INTO review_decisions (id, tenant_id, item_id, decision, reviewer_id, decided_at, note) SELECT ?, ?, ?, 'reject', ?, ?, ? WHERE ${g.sql}`).bind(
      newId("dec"),
      p.tenantId,
      id,
      p.userId,
      now,
      reason?.trim() || null,
      ...g.binds,
    ),
  ]);
  if ((res[0]?.meta.changes ?? 0) === 0) throw conflict("This item was changed by someone else. Reload to see the latest version.");
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "item.rejected", targetType: "item", targetId: id, details: { hasReason: !!reason } });
  return getSummary(env, schemas, p.tenantId, id);
}

export async function reprocess(env: Env, ctx: ExecutionContext | null, schemas: Schemas, p: Principal, id: string, version?: number): Promise<ItemSummary> {
  const row = await getItemRow(env, p.tenantId, id);
  assertNotWithClient(row);
  assertTransition(row.status, "queued", "reprocessed");
  if (row.quarantined) throw conflict("Quarantined items cannot be reprocessed; their content was deleted under the data policy");
  if (row.input_type === "manual") throw conflict("Manual entries have no source file to process; fill in the fields instead");
  if (row.input_type === "file" && !row.current_snapshot_id && !row.body_text) throw conflict("The uploaded file is no longer stored; upload it again");
  assertVersion(row, version);
  const attempt = row.attempts + 1;
  const prev = await env.DB.prepare("SELECT steps_json FROM processing_attempts WHERE item_id = ?1 AND attempt = 1").bind(id).first<{ steps_json: string }>();
  const prevSteps = JSON.parse(prev?.steps_json ?? "[]") as { label: string; ok: boolean; detail: string }[];
  const steps = row.input_type === "url" ? prevSteps.slice(0, 1) : prevSteps.slice(0, 5);
  const token = newId("op");
  const now = nowIso();
  const g = guard(env, id, token);
  const res = await env.DB.batch([
    env.DB.prepare(
      `UPDATE intelligence_items SET status = 'queued', attempts = ?1, error_code = NULL, error_message = NULL, duplicate_of = NULL, version = version + 1, op_token = ?2, updated_at = ?3
        WHERE tenant_id = ?4 AND id = ?5 AND attempts = ?6 AND status IN ('needs_review', 'failed', 'rejected')`,
    ).bind(attempt, token, now, p.tenantId, id, row.attempts),
    env.DB.prepare(
      `INSERT INTO processing_attempts (id, tenant_id, item_id, attempt, status, stage, requested_by, started_at, steps_json) SELECT ?, ?, ?, ?, 'running', 'queued', ?, ?, ? WHERE ${g.sql}`,
    ).bind(newId("att"), p.tenantId, id, attempt, p.userId, now, JSON.stringify(steps), ...g.binds),
    env.DB.prepare(`INSERT INTO review_decisions (id, tenant_id, item_id, decision, reviewer_id, decided_at) SELECT ?, ?, ?, 'reprocess', ?, ? WHERE ${g.sql}`).bind(
      newId("dec"),
      p.tenantId,
      id,
      p.userId,
      now,
      ...g.binds,
    ),
  ]);
  if ((res[0]?.meta.changes ?? 0) === 0) throw conflict("This item is already being reprocessed.");
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "item.reprocess_requested", targetType: "item", targetId: id, details: { attempt } });
  await enqueue(env, ctx, { kind: "process", tenantId: p.tenantId, itemId: id, attempt });
  return getSummary(env, schemas, p.tenantId, id);
}

/**
 * Mark an item Deleted. For an approved entry this removes it from the Tracker,
 * Dashboard, exports and signal links for everyone. The row, its revisions and
 * the audit trail are kept (soft delete); the saved page follows the normal
 * retention policy.
 */
export async function softDelete(env: Env, schemas: Schemas, p: Principal, id: string, reason?: string, requestedFrom?: "tracker" | "phantoms"): Promise<ItemSummary> {
  const row = await getItemRow(env, p.tenantId, id);
  assertTransition(row.status, "deleted", "deleted");
  const now = nowIso();
  const res = await env.DB.prepare("UPDATE intelligence_items SET status = 'deleted', deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3 AND status = ?4")
    .bind(now, p.tenantId, id, row.status)
    .run();
  if ((res.meta.changes ?? 0) === 0) throw conflict("This item was changed by someone else. Reload to see the latest version.");
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "item.deleted", targetType: "item", targetId: id, details: { from: row.status, signalCode: row.signal_code, table: "global", ...(requestedFrom ? { requestedFrom } : {}), ...(reason?.trim() ? { reason: reason.trim() } : {}) } });
  return getSummary(env, schemas, p.tenantId, id);
}

const TABLE_NAME = { tracker: "Tracker", phantoms: "Phantoms" } as const;

/**
 * Remove an approved entry from one table only: from the Tracker (and so the
 * Dashboard, Trend Test and Tracker exports) while it stays in Phantoms, or
 * from Phantoms while it stays in the Tracker. If that would leave it in
 * neither table (already removed from the other one, or a Secondary entry
 * below the Phantoms Impact threshold), it is deleted globally instead.
 */
export async function deleteFromTable(
  env: Env,
  schemas: Schemas,
  p: Principal,
  id: string,
  table: "tracker" | "phantoms",
  qualifiesForPhantoms: (stream: Stream, impact: string | null) => Promise<boolean>,
  reason?: string,
): Promise<ItemSummary> {
  const row = await getItemRow(env, p.tenantId, id);
  if (row.status !== "approved") throw conflict("Only tracker entries can be deleted from one table");
  const inOther = table === "tracker" ? !row.phantoms_hidden_at && (await qualifiesForPhantoms(row.stream, row.impact)) : !row.tracker_hidden_at;
  if (!inOther) return softDelete(env, schemas, p, id, reason, table);
  const col = table === "tracker" ? "tracker_hidden_at" : "phantoms_hidden_at";
  const now = nowIso();
  const res = await env.DB.prepare(`UPDATE intelligence_items SET ${col} = ?1, version = version + 1, updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3 AND status = 'approved' AND ${col} IS NULL`)
    .bind(now, p.tenantId, id)
    .run();
  if ((res.meta.changes ?? 0) === 0) throw conflict(`${row.signal_code ?? "This entry"} is already deleted from ${TABLE_NAME[table]}`);
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "item.deleted", targetType: "item", targetId: id, details: { from: row.status, signalCode: row.signal_code, table, ...(reason?.trim() ? { reason: reason.trim() } : {}) } });
  return getSummary(env, schemas, p.tenantId, id);
}

/**
 * "Delete All" in the Eradigm Inbox's Pushed & Rejected view (migration 0013):
 * rejected entries are deleted; pushed entries only leave the Inbox (they
 * stay in the Tracker and Phantoms). Optionally one stream only.
 */
export async function clearDecided(env: Env, p: Principal, stream: Stream | null): Promise<ClearDecidedResult> {
  const now = nowIso();
  const [rejected, pushed] = await env.DB.batch([
    env.DB.prepare("UPDATE intelligence_items SET status = 'deleted', deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE tenant_id = ?2 AND (?3 IS NULL OR stream = ?3) AND status = 'rejected'").bind(
      now,
      p.tenantId,
      stream,
    ),
    env.DB.prepare(
      "UPDATE intelligence_items SET inbox_cleared_at = ?1, version = version + 1, updated_at = ?1 WHERE tenant_id = ?2 AND (?3 IS NULL OR stream = ?3) AND status = 'approved' AND inbox_cleared_at IS NULL",
    ).bind(now, p.tenantId, stream),
  ]);
  const out = { rejectedDeleted: rejected?.meta.changes ?? 0, pushedCleared: pushed?.meta.changes ?? 0 };
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "inbox.cleared", targetType: "inbox", targetId: stream ?? "all", details: out });
  return out;
}
