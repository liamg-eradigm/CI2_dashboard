/**
 * Background processing of a submission (Queue consumer).
 *
 *   Queued → Fetching → Extracting → Needs review        (success)
 *                    ↘            ↘ Failed              (error, quarantine, duplicate)
 *
 * Every job message carries the attempt number. A message whose attempt no
 * longer matches the item (a newer reprocess was requested) or whose item is
 * no longer in progress is acknowledged and skipped, so redelivered or
 * duplicated messages can never create duplicate records. Retrying a failed
 * item creates a new attempt; nothing from an earlier attempt is overwritten
 * except the item's current draft.
 */
import {
  CORE,
  EXTRACTION_VERSION,
  LOW_CONFIDENCE,
  applyRedactionPolicy,
  buildExtractionInput,
  enforceTaxonomy,
  REDACTION_POLICY_VERSION,
  validateValues,
  type ExtractedFieldView,
  type ItemValues,
} from "@eradigm/shared";
import { createLlmProvider, LlmError } from "@eradigm/llm";
import type { CaptureStep } from "@eradigm/capture";
import type { Env, JobMessage } from "../env.js";
import { sha256Hex } from "../lib/crypto.js";
import { newId, nowIso } from "../lib/ids.js";
import { alert, log, metric } from "../lib/log.js";
import { audit } from "../services/audit.js";
import { getItemRow, type ItemRow } from "../services/items.js";
import { loadSchema, loadSettings } from "../services/schema.js";
import { captureUrlIsolated } from "./capture-client.js";
import { deleteSnapshots, storeSnapshot } from "./snapshots.js";

export class RetryableError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Enqueueing
// ---------------------------------------------------------------------------

const testQueue: JobMessage[] = [];

export async function enqueue(env: Env, ctx: ExecutionContext | null, msg: JobMessage): Promise<void> {
  if (env.JOBS && env.ENVIRONMENT !== "test") {
    await env.JOBS.send(msg, { contentType: "json" });
    return;
  }
  if (env.ENVIRONMENT === "test") {
    testQueue.push(msg);
    return;
  }
  // No queue bound (local fallback): process in the background of this request.
  ctx?.waitUntil(runJob(env, msg, 1).catch((e) => log("error", "inline_job_failed", { message: (e as Error).message })));
}

/** Test hook: run queued jobs synchronously. */
export async function drainTestQueue(env: Env): Promise<number> {
  let n = 0;
  while (testQueue.length) {
    const msg = testQueue.shift() as JobMessage;
    await runJob(env, msg, 1);
    n++;
  }
  return n;
}

export function peekTestQueue(): readonly JobMessage[] {
  return testQueue;
}

/** Runs a job; retryable errors on the final delivery become a Failed item. */
export async function runJob(env: Env, msg: JobMessage, delivery: number, maxDeliveries = 1): Promise<"done" | "skipped" | "retry"> {
  try {
    return await processJob(env, msg);
  } catch (err) {
    if (err instanceof RetryableError && delivery < maxDeliveries) {
      log("warn", "job_retry", { item: msg.itemId, attempt: msg.attempt, delivery, code: err.code });
      return "retry";
    }
    const code = err instanceof RetryableError ? err.code : "INTERNAL";
    const message = err instanceof RetryableError ? `${err.message} (after ${delivery} tries)` : "Unexpected processing error";
    log("error", "job_failed", { item: msg.itemId, attempt: msg.attempt, code, message: (err as Error).message });
    await failItem(env, msg, code, message, null);
    const row = await env.DB.prepare("SELECT input_type, submitted_url FROM intelligence_items WHERE tenant_id = ?1 AND id = ?2")
      .bind(msg.tenantId, msg.itemId)
      .first<{ input_type: string; submitted_url: string | null }>();
    if (row?.input_type === "url") await logCapture(env, msg.tenantId, msg.itemId, row.submitted_url ?? "", null, `Failed · ${message}`, false);
    return "done";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setStatus(env: Env, msg: JobMessage, from: string[], to: string): Promise<boolean> {
  const ph = from.map((_, i) => `?${i + 5}`).join(",");
  const r = await env.DB.prepare(`UPDATE intelligence_items SET status = ?1, updated_at = ?2 WHERE tenant_id = ?3 AND id = ?4 AND attempts = ?${from.length + 5} AND status IN (${ph})`)
    .bind(to, nowIso(), msg.tenantId, msg.itemId, ...from, msg.attempt)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

async function saveSteps(env: Env, msg: JobMessage, stage: string, steps: CaptureStep[]): Promise<void> {
  await env.DB.prepare("UPDATE processing_attempts SET stage = ?1, steps_json = ?2 WHERE tenant_id = ?3 AND item_id = ?4 AND attempt = ?5")
    .bind(stage, JSON.stringify(steps), msg.tenantId, msg.itemId, msg.attempt)
    .run();
}

async function logCapture(env: Env, tenantId: string, itemId: string, input: string, finalUrl: string | null, outcome: string, ok: boolean) {
  await env.DB.prepare("INSERT INTO capture_log (id, tenant_id, item_id, at, input, final_url, outcome, ok) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
    .bind(newId("cap"), tenantId, itemId, nowIso(), input.slice(0, 2048), finalUrl, outcome.slice(0, 300), ok ? 1 : 0)
    .run();
}

export async function failItem(env: Env, msg: JobMessage, code: string, message: string, steps: CaptureStep[] | null, extra: { duplicateOf?: string } = {}) {
  const now = nowIso();
  const stmts = [
    env.DB.prepare(
      `UPDATE intelligence_items SET status = 'failed', error_code = ?1, error_message = ?2, duplicate_of = COALESCE(?3, duplicate_of), version = version + 1, updated_at = ?4
        WHERE tenant_id = ?5 AND id = ?6 AND attempts = ?7 AND status IN ('queued', 'fetching', 'extracting')`,
    ).bind(code, message.slice(0, 500), extra.duplicateOf ?? null, now, msg.tenantId, msg.itemId, msg.attempt),
    env.DB.prepare(
      `UPDATE processing_attempts SET status = 'failed', finished_at = ?1, error_code = ?2, error_message = ?3${steps ? ", steps_json = ?7" : ""}
        WHERE tenant_id = ?4 AND item_id = ?5 AND attempt = ?6`,
    ).bind(now, code, message.slice(0, 500), msg.tenantId, msg.itemId, msg.attempt, ...(steps ? [JSON.stringify(steps)] : [])),
  ];
  await env.DB.batch(stmts);
  await audit(env, { tenantId: msg.tenantId, actorId: null, actorEmail: "system", action: "item.failed", targetType: "item", targetId: msg.itemId, details: { attempt: msg.attempt, code } });
  metric(env, "item_failed", 1, { tenant: msg.tenantId, code });
}

function llmFromEnv(env: Env) {
  return createLlmProvider({
    provider: env.LLM_PROVIDER,
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.LLM_MODEL,
    effort: env.LLM_EFFORT,
    timeoutMs: 60_000,
  });
}

/** Does the evidence excerpt actually appear in the source text? */
function evidenceSupported(evidence: string | null, text: string): boolean {
  if (!evidence) return false;
  if (/^(article headline|page metadata|trade publication byline|page marked as press release)$/i.test(evidence.trim())) return true;
  const clean = (s: string) => s.toLowerCase().replace(/[“”"‘’'…]/g, "").replace(/\s+/g, " ").trim();
  const e = clean(evidence);
  if (e.length < 6) return false;
  const t = clean(text);
  if (t.includes(e)) return true;
  // Accept excerpts that were lightly trimmed: require the first 40 chars to match.
  return e.length > 40 && t.includes(e.slice(0, 40));
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export async function processJob(env: Env, msg: JobMessage): Promise<"done" | "skipped"> {
  let item: ItemRow;
  try {
    item = await getItemRow(env, msg.tenantId, msg.itemId);
  } catch {
    return "skipped";
  }
  if (item.attempts !== msg.attempt || !["queued", "fetching", "extracting"].includes(item.status)) {
    log("info", "job_skipped", { item: msg.itemId, attempt: msg.attempt, status: item.status, current: item.attempts });
    return "skipped";
  }
  const [schema, settings] = await Promise.all([loadSchema(env, msg.tenantId), loadSettings(env, msg.tenantId)]);
  const att = await env.DB.prepare("SELECT steps_json FROM processing_attempts WHERE tenant_id = ?1 AND item_id = ?2 AND attempt = ?3")
    .bind(msg.tenantId, msg.itemId, msg.attempt)
    .first<{ steps_json: string }>();
  let steps: CaptureStep[] = JSON.parse(att?.steps_json ?? "[]");

  // ---- Stage 1: capture (URL submissions) --------------------------------
  if (item.input_type === "url" && (item.status === "queued" || item.status === "fetching")) {
    await setStatus(env, msg, ["queued", "fetching"], "fetching");
    await saveSteps(env, msg, "fetching", steps.slice(0, 1));
    const result = await captureUrlIsolated(env, item.submitted_url ?? "");
    if (!result.ok) {
      const outcome = `${result.code === "ACCESS_RESTRICTED" || result.code === "ROBOTS_DISALLOWED" ? "Stopped" : result.code === "DESTINATION_BLOCKED" ? "Blocked" : "Failed"} · ${result.message.split(" · ").slice(0, 2).join(" · ").replace(/^(Blocked|Stopped) · /, "")}`;
      if (result.retryable) {
        await saveSteps(env, msg, "fetching", result.steps);
        throw new RetryableError(result.code, result.message);
      }
      await logCapture(env, msg.tenantId, msg.itemId, item.submitted_url ?? "", result.finalUrl, outcome, false);
      await failItem(env, msg, result.code, result.message, result.steps);
      return "done";
    }
    steps = result.steps;
    const snap = await storeSnapshot(env, {
      tenantId: msg.tenantId,
      itemId: msg.itemId,
      attempt: msg.attempt,
      html: result.html,
      rawSha256: result.rawSha256,
      contentType: result.contentType,
      httpStatus: result.httpStatus,
      finalUrl: result.finalUrl,
      redirects: result.redirects,
      method: result.method,
      singleFile: result.singleFile.detected,
      retentionDays: settings.retention.snapshotDays,
    });
    const contentSha = await sha256Hex(`${result.article.headline}\n${result.article.bodyText}`.toLowerCase().replace(/\s+/g, " "));
    await env.DB.prepare(
      `UPDATE intelligence_items SET current_snapshot_id = ?1, final_url = ?2, outlet = COALESCE(?3, outlet), headline = ?4, body_text = ?5, publication_date = ?6,
              content_sha256 = ?7, model_warnings_json = ?8, updated_at = ?9 WHERE tenant_id = ?10 AND id = ?11`,
    )
      .bind(snap.id, result.finalUrl, result.article.siteName, result.article.headline, result.article.bodyText, result.article.publicationDate, contentSha, JSON.stringify(result.warnings), nowIso(), msg.tenantId, msg.itemId)
      .run();
    await logCapture(env, msg.tenantId, msg.itemId, item.submitted_url ?? "", result.finalUrl, "Captured · sent to Needs review", true);
    await saveSteps(env, msg, "extracting", steps);
    item = await getItemRow(env, msg.tenantId, msg.itemId);
  }

  // ---- Stage 2: extraction, policy and classification --------------------
  await setStatus(env, msg, ["queued", "fetching", "extracting"], "extracting");

  if (item.content_sha256) {
    const dup = await env.DB.prepare(
      "SELECT id, code FROM intelligence_items WHERE tenant_id = ?1 AND content_sha256 = ?2 AND id <> ?3 AND status NOT IN ('deleted', 'failed') ORDER BY received_at LIMIT 1",
    )
      .bind(msg.tenantId, item.content_sha256, item.id)
      .first<{ id: string; code: string }>();
    if (dup) {
      steps.push({ label: "Duplicate check", ok: false, detail: `Same article content as ${dup.code} · not processed again` });
      await failItem(env, msg, "DUPLICATE_CONTENT", `Duplicate of ${dup.code} (same article content)`, steps, { duplicateOf: dup.id });
      await audit(env, { tenantId: msg.tenantId, actorId: null, actorEmail: "system", action: "submission.duplicate", targetType: "item", targetId: item.id, details: { duplicateOf: dup.code, basis: "content" } });
      return "done";
    }
  }

  const headline = item.headline ?? "";
  const body = item.body_text ?? "";
  const policy = { version: REDACTION_POLICY_VERSION, ...settings.redaction };
  const redH = applyRedactionPolicy(headline, policy);
  const redB = applyRedactionPolicy(body, policy);
  if (redH.quarantine || redB.quarantine) {
    const category = redH.incidentCategory ?? redB.incidentCategory ?? "confidentiality_marking";
    await quarantine(env, msg, item, category, steps);
    return "done";
  }
  const redactedCount = [...redH.findings, ...redB.findings].reduce((a, f) => a + f.count, 0);
  const words = body ? body.split(/\s+/).length : 0;
  steps.push({
    label: "Minimum extraction to LLM",
    ok: true,
    detail: `Sent: headline, body text (${words} words), publication date, current taxonomy lists · Not sent: raw HTML, images, cookies, URL query${redactedCount ? ` · ${redactedCount} contact detail(s) redacted by policy` : ""}`,
  });
  await saveSteps(env, msg, "extracting", steps);

  let llm;
  try {
    llm = llmFromEnv(env);
  } catch (err) {
    const m = err instanceof LlmError ? err.message : "LLM provider not configured";
    steps.push({ label: "Schema-constrained classification", ok: false, detail: m });
    await failItem(env, msg, "LLM_NOT_CONFIGURED", m, steps);
    await alert(env, `LLM not configured: ${m}`, { tenant: msg.tenantId });
    return "done";
  }
  const input = buildExtractionInput(schema, { headline: redH.text, bodyText: redB.text, publicationDate: item.publication_date });
  let result;
  try {
    result = await llm.extract(input);
  } catch (err) {
    if (err instanceof LlmError) {
      if (err.retryable) throw new RetryableError(`LLM_${err.code}`, err.message);
      steps.push({ label: "Schema-constrained classification", ok: false, detail: err.message });
      await failItem(env, msg, `LLM_${err.code}`, err.message, steps);
      if (err.code === "AUTH" || err.code === "PERMISSION" || err.code === "NOT_CONFIGURED") {
        await alert(env, `Claude API ${err.code}: ${err.message}`, { tenant: msg.tenantId });
        await notifyAdmins(env, msg.tenantId, "llm_permission", `AI classification is failing: ${err.message}`);
      }
      return "done";
    }
    throw err;
  }

  // Check the AI response against the approved categories and data rules.
  const proposed: ItemValues = {};
  for (const [k, f] of Object.entries(result.output.fields)) proposed[k] = f.value;
  const { values, warnings: taxWarnings } = enforceTaxonomy(schema, proposed);
  const sourceText = `${headline}\n${body}`;
  const extraction: Record<string, ExtractedFieldView> = {};
  const provenance: Record<string, "source" | "ai" | "analyst" | null> = {};
  let fieldsWithWarnings = 0;
  for (const col of schema.columns) {
    const f = result.output.fields[col.key];
    const w: string[] = taxWarnings.filter((t) => t.key === col.key).map((t) => t.message);
    const v = values[col.key] ?? null;
    if (!col.aiAssist) {
      w.push("Null · analyst-owned field, not inferred");
    } else if (!f) {
      w.push("Not in extraction schema · analyst to complete");
    } else {
      if (v == null && f.nullReason && !w.length) w.push(`Null · ${f.nullReason}`);
      if (v != null && f.confidence != null && f.confidence < LOW_CONFIDENCE) w.push("Low confidence · verify against source");
      if (v != null && !evidenceSupported(f.evidence, sourceText)) w.push("Evidence excerpt not found in source · verify");
    }
    if (w.length) fieldsWithWarnings++;
    extraction[col.key] = {
      value: v,
      confidence: v == null ? null : (f?.confidence ?? null),
      evidence: f?.evidence ?? null,
      nullReason: v == null ? (f?.nullReason ?? null) : null,
      warnings: w,
    };
    provenance[col.key] =
      v == null
        ? null
        : col.key === CORE.date && item.publication_date === v
          ? "source"
          : col.key === CORE.title && v === headline
            ? "source"
            : "ai";
  }
  // Server-side data rules (non-approval mode: values must be valid, required-ness is checked at approval).
  const ruleErrors = validateValues(schema, values, { forApproval: false });
  for (const e of ruleErrors) {
    values[e.key] = null;
    const ex = extraction[e.key];
    if (ex) {
      ex.warnings.push(`${e.message} · set to null`);
      ex.value = null;
    }
  }
  const dropped = taxWarnings.length + ruleErrors.length;
  const nulls = schema.columns.filter((c) => values[c.key] == null).length;
  steps.push({
    label: "Schema-constrained classification",
    ok: true,
    detail: `Valid JSON against tracker schema · explicit nulls · evidence and confidence per field · ${dropped ? `${dropped} value(s) outside the taxonomy set to null` : "model cannot add taxonomy values"} · ${result.meta.model}`,
  });
  steps.push({ label: "Routed to Needs review", ok: true, detail: `${item.code} created in Inbox · never auto-published` });

  const now = nowIso();
  const modelWarnings = [...JSON.parse(item.model_warnings_json || "[]"), ...result.output.warnings].slice(0, 20);
  const seq = await env.DB.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM item_revisions WHERE item_id = ?1").bind(item.id).first<{ n: number }>();
  const batch = await env.DB.batch([
    env.DB.prepare(
      `UPDATE intelligence_items SET status = 'needs_review', draft_json = ?1, provenance_json = ?2, extraction_json = ?3, model_warnings_json = ?4, warnings_count = ?5,
              error_code = NULL, error_message = NULL, version = version + 1, updated_at = ?6
        WHERE tenant_id = ?7 AND id = ?8 AND attempts = ?9 AND status = 'extracting'`,
    ).bind(JSON.stringify(values), JSON.stringify(provenance), JSON.stringify(extraction), JSON.stringify(modelWarnings), fieldsWithWarnings, now, msg.tenantId, msg.itemId, msg.attempt),
    env.DB.prepare(
      `UPDATE processing_attempts SET status = 'succeeded', stage = 'needs_review', finished_at = ?1, steps_json = ?2, extraction_version = ?3, prompt_version = ?4, schema_version = ?5,
              redaction_version = ?6, provider = ?7, model = ?8, input_tokens = ?9, output_tokens = ?10
        WHERE tenant_id = ?11 AND item_id = ?12 AND attempt = ?13`,
    ).bind(now, JSON.stringify(steps), EXTRACTION_VERSION, result.meta.promptVersion, result.meta.schemaVersion, redB.policyVersion, result.meta.provider, result.meta.model, result.meta.inputTokens ?? null, result.meta.outputTokens ?? null, msg.tenantId, msg.itemId, msg.attempt),
    env.DB.prepare(
      `INSERT INTO item_revisions (id, tenant_id, item_id, seq, kind, values_json, provenance_json, changed_keys, created_by, created_at, note)
       SELECT ?1, ?2, ?3, ?4, 'llm_draft', ?5, ?6, '[]', NULL, ?7, ?8
        WHERE EXISTS (SELECT 1 FROM intelligence_items WHERE id = ?3 AND status = 'needs_review' AND attempts = ?9)`,
    ).bind(newId("rev"), msg.tenantId, item.id, seq?.n ?? 1, JSON.stringify(values), JSON.stringify(provenance), now, `LLM draft · attempt ${msg.attempt} · ${result.meta.model}`, msg.attempt),
  ]);
  if ((batch[0]?.meta.changes ?? 0) === 0) {
    log("info", "job_superseded", { item: item.id, attempt: msg.attempt });
    return "skipped";
  }
  await audit(env, {
    tenantId: msg.tenantId,
    actorId: null,
    actorEmail: "system",
    action: "item.classified",
    targetType: "item",
    targetId: item.id,
    details: { attempt: msg.attempt, provider: result.meta.provider, model: result.meta.model, promptVersion: result.meta.promptVersion, nulls, fieldsWithWarnings, dropped },
  });
  metric(env, "item_classified", 1, { tenant: msg.tenantId });
  if (result.meta.latencyMs) metric(env, "llm_latency_ms", result.meta.latencyMs, { tenant: msg.tenantId });
  return "done";
}

async function notifyAdmins(env: Env, tenantId: string, kind: string, message: string) {
  await env.DB.prepare("INSERT INTO notifications (id, tenant_id, audience, kind, message, created_at) VALUES (?1, ?2, 'admin', ?3, ?4, ?5)")
    .bind(newId("ntf"), tenantId, kind, message.slice(0, 300), nowIso())
    .run();
}

const CATEGORY_LABEL: Record<string, string> = {
  credential_or_secret: "credential or secret",
  payment_card: "payment card number",
  national_identifier: "national identifier",
  bank_account: "bank account number",
  confidentiality_marking: "confidentiality marking",
  tenant_marker: "tenant-defined restricted term",
  malicious_content: "malicious content",
};

/**
 * Content appears to violate the data policy: stop processing, quarantine,
 * record only a non-sensitive incident category + timestamp, notify admins
 * and apply the deletion procedure (stored copy and extracted text removed).
 */
async function quarantine(env: Env, msg: JobMessage, item: ItemRow, category: string, steps: CaptureStep[]) {
  const now = nowIso();
  steps.push({ label: "Minimum extraction to LLM", ok: false, detail: `Quarantined by data policy (${CATEGORY_LABEL[category] ?? category}) · nothing sent externally` });
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE intelligence_items SET status = 'failed', quarantined = 1, error_code = 'QUARANTINED', error_message = ?1, headline = NULL, body_text = NULL,
              draft_json = '{}', extraction_json = NULL, version = version + 1, updated_at = ?2
        WHERE tenant_id = ?3 AND id = ?4 AND attempts = ?5`,
    ).bind(`Quarantined by data policy: ${CATEGORY_LABEL[category] ?? category}. Processing stopped and the stored copy was deleted.`, now, msg.tenantId, msg.itemId, msg.attempt),
    env.DB.prepare("UPDATE processing_attempts SET status = 'failed', finished_at = ?1, error_code = 'QUARANTINED', steps_json = ?2 WHERE tenant_id = ?3 AND item_id = ?4 AND attempt = ?5").bind(
      now,
      JSON.stringify(steps),
      msg.tenantId,
      msg.itemId,
      msg.attempt,
    ),
    env.DB.prepare("INSERT INTO incidents (id, tenant_id, item_id, category, at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(newId("inc"), msg.tenantId, item.id, category, now),
  ]);
  await deleteSnapshots(env, msg.tenantId, item.id);
  await notifyAdmins(env, msg.tenantId, "quarantine", `${item.code} was quarantined (${CATEGORY_LABEL[category] ?? category}).`);
  await audit(env, { tenantId: msg.tenantId, actorId: null, actorEmail: "system", action: "item.quarantined", targetType: "item", targetId: item.id, details: { category } });
  await alert(env, `Item quarantined by data policy (category: ${category})`, { tenant: msg.tenantId });
  metric(env, "item_quarantined", 1, { tenant: msg.tenantId, code: category });
}
