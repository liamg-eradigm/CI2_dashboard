/**
 * Submitting a URL or an HTML file (URL Processing sequence, 4_Backend_Design):
 *   1. validate + normalise   2. create submission (Queued)
 *   3. enqueue background capture/extraction/classification.
 *
 * Idempotent: the same Idempotency-Key (a double-click or a network retry)
 * returns the existing item instead of creating a new one.
 *
 * Duplicates never block a submission. Only entries already in the tracker
 * (approved) count as duplicates: the item is still created and sent to the
 * Inbox, its summary carries `duplicateOf` (shown as a warning on the Input
 * page and in the Inbox), and approval asks the reviewer to confirm.
 */
import { CAPTURE_LIMITS, FIELDS, SOURCE_TIER, checkAndNormaliseUrl, dedupeKey, type ItemSummary, type Stream } from "@eradigm/shared";
import type { CaptureStep } from "@eradigm/capture";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { sha256Hex } from "../lib/crypto.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { enqueue } from "../pipeline/process.js";
import { parseUploadIsolated } from "../pipeline/capture-client.js";
import { storeSnapshot } from "../pipeline/snapshots.js";
import { audit } from "./audit.js";
import { DUPLICATE_BASIS_LABEL, contentFingerprintInput, getSummary, nextCode } from "./items.js";
import { loadSettings, type Schemas } from "./schema.js";

export interface SubmitResult {
  item: ItemSummary;
  duplicate: boolean;
}

async function byIdempotencyKey(env: Env, tenantId: string, key: string | null): Promise<string | null> {
  if (!key) return null;
  const r = await env.DB.prepare(
    "SELECT i.id FROM submissions s JOIN intelligence_items i ON i.submission_id = s.id WHERE s.tenant_id = ?1 AND s.idempotency_key = ?2 LIMIT 1",
  )
    .bind(tenantId, key)
    .first<{ id: string }>();
  return r?.id ?? null;
}

async function logCapture(env: Env, tenantId: string, itemId: string | null, input: string, finalUrl: string | null, outcome: string, ok: boolean) {
  await env.DB.prepare("INSERT INTO capture_log (id, tenant_id, item_id, at, input, final_url, outcome, ok) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
    .bind(newId("cap"), tenantId, itemId, nowIso(), input.slice(0, 2048), finalUrl, outcome.slice(0, 300), ok ? 1 : 0)
    .run();
}

/** A retried request with the same Idempotency-Key: return what the first one created. */
async function replay(env: Env, schemas: Schemas, tenantId: string, itemId: string): Promise<SubmitResult> {
  return { item: await getSummary(env, schemas, tenantId, itemId), duplicate: true };
}

/** Record (not block) a submission of a source that is already in the tracker. */
async function noteDuplicate(env: Env, p: Principal, item: ItemSummary): Promise<void> {
  if (!item.duplicateOf) return;
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "submission.duplicate",
    targetType: "item",
    targetId: item.id,
    details: { duplicateOf: item.duplicateOf, basis: item.duplicateBasis, proceeded: true },
  });
}

function isUnique(err: unknown): boolean {
  return /UNIQUE/i.test(String((err as Error)?.message ?? err));
}

/** A new item's draft: every field empty except Source Tier, which follows the stream. */
const initialDraft = (stream: Stream) => JSON.stringify({ [FIELDS.sourceTier]: SOURCE_TIER[stream] });

export async function submitUrl(
  env: Env,
  ctx: ExecutionContext | null,
  schemas: Schemas,
  p: Principal,
  rawUrl: string,
  idemKey: string | null,
  stream: Stream = "primary",
): Promise<SubmitResult> {
  const prior = await byIdempotencyKey(env, p.tenantId, idemKey);
  if (prior) return replay(env, schemas, p.tenantId, prior);

  const c = checkAndNormaliseUrl(rawUrl);
  if (!c.ok) {
    const outcome = `${c.stage === "destination" ? "Blocked" : "Rejected"} · ${c.reason.replace(/^Blocked · /, "")}`;
    await logCapture(env, p.tenantId, null, rawUrl, null, outcome, false);
    await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "submission.created", details: { rejected: true, code: c.code } });
    throw new ApiError("VALIDATION", c.reason, [{ key: "url", label: "URL", code: c.code, message: c.reason }]);
  }
  const urlKey = dedupeKey(c.url);

  const now = nowIso();
  const subId = newId("sub");
  const itemId = newId("itm");
  const code = await nextCode(env, p.tenantId, "inbox");
  const steps: CaptureStep[] = [{ label: "Validate and normalise", ok: true, detail: `Normalised to ${c.url}${c.notes.length ? ` · ${c.notes.join(", ")}` : ""}` }];
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO submissions (id, tenant_id, submitted_by, input_type, submitted_url, normalized_url, idempotency_key, created_at) VALUES (?1, ?2, ?3, 'url', ?4, ?5, ?6, ?7)",
      ).bind(subId, p.tenantId, p.userId, rawUrl.slice(0, 2048), c.url, idemKey, now),
      env.DB.prepare(
        `INSERT INTO intelligence_items (id, tenant_id, submission_id, code, status, input_type, url_key, outlet, submitted_url, received_at, submitted_by, created_at, updated_at, stream, draft_json)
         VALUES (?1, ?2, ?3, ?4, 'queued', 'url', ?5, ?6, ?7, ?8, ?9, ?8, ?8, ?10, ?11)`,
      ).bind(itemId, p.tenantId, subId, code, urlKey, c.host.replace(/^www\./, ""), c.url, now, p.userId, stream, initialDraft(stream)),
      env.DB.prepare(
        "INSERT INTO processing_attempts (id, tenant_id, item_id, attempt, status, stage, requested_by, started_at, steps_json) VALUES (?1, ?2, ?3, 1, 'running', 'queued', ?4, ?5, ?6)",
      ).bind(newId("att"), p.tenantId, itemId, p.userId, now, JSON.stringify(steps)),
    ]);
  } catch (err) {
    if (!isUnique(err)) throw err;
    // Lost a race with a retry of the same request: return the winner.
    const winner = await byIdempotencyKey(env, p.tenantId, idemKey);
    if (winner) return replay(env, schemas, p.tenantId, winner);
    throw err;
  }
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "submission.created", targetType: "item", targetId: itemId, details: { code, inputType: "url" } });
  await enqueue(env, ctx, { kind: "process", tenantId: p.tenantId, itemId, attempt: 1 });
  const item = await getSummary(env, schemas, p.tenantId, itemId);
  await noteDuplicate(env, p, item);
  return { item, duplicate: false };
}

export async function submitFile(
  env: Env,
  ctx: ExecutionContext | null,
  schemas: Schemas,
  p: Principal,
  file: { name: string; bytes: ArrayBuffer; type: string },
  idemKey: string | null,
  stream: Stream = "primary",
): Promise<SubmitResult> {
  if (!/\.html?$/i.test(file.name)) throw new ApiError("UNSUPPORTED_MEDIA", "Only .html or .htm files are accepted");
  if (file.type && !/^(text\/html|application\/xhtml\+xml|application\/octet-stream)$/i.test(file.type.split(";")[0] ?? "")) {
    throw new ApiError("UNSUPPORTED_MEDIA", "Only HTML files are accepted");
  }
  if (file.bytes.byteLength > CAPTURE_LIMITS.maxBytes) throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds the ${CAPTURE_LIMITS.maxBytes / 1048576} MB limit`);
  const prior = await byIdempotencyKey(env, p.tenantId, idemKey);
  if (prior) return replay(env, schemas, p.tenantId, prior);

  const fileSha = await sha256Hex(file.bytes);
  const label = `${file.name}${/Page saved with SingleFile/i.test(new TextDecoder().decode(file.bytes.slice(0, 8000))) ? " (SingleFile)" : ""}`;

  // Scan and sanitise in the isolated worker BEFORE anything is stored.
  const parsed = await parseUploadIsolated(env, file.bytes, file.name);
  if (!parsed.ok) {
    await logCapture(env, p.tenantId, null, label, null, `Rejected · ${parsed.message}`, false);
    await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "submission.created", details: { rejected: true, code: parsed.code, inputType: "file" } });
    throw new ApiError("VALIDATION", parsed.message, [{ key: "file", label: "File", code: parsed.code, message: parsed.message }]);
  }
  const urlKey = parsed.finalUrl ? dedupeKey(parsed.finalUrl) : null;

  const settings = await loadSettings(env, p.tenantId);
  const now = nowIso();
  const subId = newId("sub");
  const itemId = newId("itm");
  const code = await nextCode(env, p.tenantId, "inbox");
  const fp = contentFingerprintInput(parsed.article.headline, parsed.article.bodyText);
  const contentSha = fp ? await sha256Hex(fp) : null;
  let outlet = parsed.article.siteName;
  if (!outlet && parsed.finalUrl) outlet = new URL(parsed.finalUrl).hostname.replace(/^www\./, "");
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO submissions (id, tenant_id, submitted_by, input_type, submitted_url, normalized_url, file_name, file_sha256, idempotency_key, created_at) VALUES (?1, ?2, ?3, 'file', NULL, ?4, ?5, ?6, ?7, ?8)",
      ).bind(subId, p.tenantId, p.userId, parsed.finalUrl, file.name.slice(0, 255), fileSha, idemKey, now),
      env.DB.prepare(
        `INSERT INTO intelligence_items (id, tenant_id, submission_id, code, status, input_type, url_key, file_sha256, content_sha256, outlet, submitted_url, final_url, received_at, submitted_by,
                                         headline, body_text, publication_date, model_warnings_json, created_at, updated_at, stream, draft_json)
         VALUES (?1, ?2, ?3, ?4, 'queued', 'file', ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?10, ?10, ?16, ?17)`,
      ).bind(
        itemId,
        p.tenantId,
        subId,
        code,
        urlKey,
        fileSha,
        contentSha,
        outlet ?? "Uploaded file",
        parsed.finalUrl,
        now,
        p.userId,
        parsed.article.headline,
        parsed.article.bodyText,
        parsed.article.publicationDate,
        JSON.stringify(parsed.warnings),
        stream,
        initialDraft(stream),
      ),
      env.DB.prepare(
        "INSERT INTO processing_attempts (id, tenant_id, item_id, attempt, status, stage, requested_by, started_at, steps_json) VALUES (?1, ?2, ?3, 1, 'running', 'queued', ?4, ?5, ?6)",
      ).bind(newId("att"), p.tenantId, itemId, p.userId, now, JSON.stringify(parsed.steps)),
    ]);
  } catch (err) {
    if (!isUnique(err)) throw err;
    const winner = await byIdempotencyKey(env, p.tenantId, idemKey);
    if (winner) return replay(env, schemas, p.tenantId, winner);
    throw err;
  }
  const snap = await storeSnapshot(env, {
    tenantId: p.tenantId,
    itemId,
    attempt: 1,
    html: parsed.html,
    rawSha256: parsed.rawSha256,
    contentType: "text/html",
    httpStatus: null,
    finalUrl: parsed.finalUrl,
    redirects: 0,
    method: "upload",
    singleFile: parsed.singleFile.detected,
    retentionDays: settings.retention.snapshotDays,
  });
  await env.DB.prepare("UPDATE intelligence_items SET current_snapshot_id = ?1 WHERE tenant_id = ?2 AND id = ?3").bind(snap.id, p.tenantId, itemId).run();
  const item = await getSummary(env, schemas, p.tenantId, itemId);
  const dupNote = item.duplicateOf && item.duplicateBasis ? ` · ⚠ already in the tracker as ${item.duplicateOf} (${DUPLICATE_BASIS_LABEL[item.duplicateBasis]})` : "";
  await logCapture(env, p.tenantId, itemId, label, parsed.finalUrl ? `${parsed.finalUrl} (from file metadata)` : null, `Captured · sent to Needs review${dupNote}`, true);
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "submission.created", targetType: "item", targetId: itemId, details: { code, inputType: "file", singleFile: parsed.singleFile.detected } });
  await noteDuplicate(env, p, item);
  await enqueue(env, ctx, { kind: "process", tenantId: p.tenantId, itemId, attempt: 1 });
  return { item, duplicate: false };
}
