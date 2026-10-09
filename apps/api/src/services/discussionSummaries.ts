/**
 * Request 43: the Primary Tracker's AI Summary of a discussion — an entry
 * with its earlier answers from the same source (Full Discussion, mode
 * "source") or with the same Insight Topic and KIQ too (KIQ Archive, mode
 * "kiq"), newest first.
 *
 * When the AI writer is connected (LLM_PROVIDER), a missing or out-of-date
 * summary is written when it is first asked for, following the instructions
 * set in Admin. Admins can write it by hand instead; a hand-written
 * summary is never replaced automatically (it is flagged once the discussion
 * changes), only when an admin asks the AI writer to write it again.
 */
import { CORE, FIELDS, plainText, type DiscussionSummary, type Signal, type TenantSettings, type TrackerSchema } from "@eradigm/shared";
import { createLlmProvider, LlmError, type SummaryEntry } from "@eradigm/llm";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { ApiError, notFound } from "../lib/errors.js";
import { nowIso } from "../lib/ids.js";
import { audit } from "./audit.js";
import { archivedResponses, signalRow } from "./query.js";

export type DiscussionMode = "source" | "kiq";

interface Row {
  text: string;
  source: "manual" | "ai";
  model: string | null;
  basis: string;
  entries: number;
  updated_at: string;
  updated_by: string | null;
}

const str = (s: Signal, k: string) => {
  const v = s.values[k];
  // The AI writer reads the text without its formatting markup (request 46).
  return plainText((Array.isArray(v) ? v.join(", ") : (v ?? "")).toString()).trim();
};

/** The discussion's answers, newest first (the entry itself, then its earlier answers). */
async function answers(env: Env, schema: TrackerSchema, tenantId: string, id: string, mode: DiscussionMode): Promise<Signal[]> {
  const cur = await signalRow(env, schema, tenantId, id);
  if (!cur || cur.stream !== "primary") throw notFound("Primary entry");
  const earlier = await archivedResponses(env, schema, tenantId, id, mode);
  return [cur, ...earlier.rows];
}

/** Which answers (and which revision of each) a summary was written from. */
async function basisOf(rows: Signal[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rows.map((r) => `${r.id}:${r.rev}`).join(",")));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const read = (env: Env, tenantId: string, id: string, mode: DiscussionMode) =>
  env.DB.prepare(
    "SELECT s.text, s.source, s.model, s.basis, s.entries, s.updated_at, (SELECT u.name FROM users u WHERE u.id = s.updated_by) AS updated_by FROM discussion_summaries s WHERE s.tenant_id = ?1 AND s.item_id = ?2 AND s.mode = ?3",
  )
    .bind(tenantId, id, mode)
    .first<Row>();

function upsert(env: Env, tenantId: string, id: string, mode: DiscussionMode, r: { text: string; source: "manual" | "ai"; model: string | null; basis: string; entries: number; by: string | null }) {
  return env.DB.prepare(
    `INSERT INTO discussion_summaries (tenant_id, item_id, mode, text, source, model, basis, entries, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT (tenant_id, item_id, mode) DO UPDATE SET text = excluded.text, source = excluded.source, model = excluded.model, basis = excluded.basis,
       entries = excluded.entries, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(tenantId, id, mode, r.text, r.source, r.model, r.basis, r.entries, r.by, nowIso())
    .run();
}

function toSummary(id: string, mode: DiscussionMode, row: Row | null, basis: string, count: number, aiConnected: boolean, error: string | null = null): DiscussionSummary {
  return {
    itemId: id,
    mode,
    text: row?.text ?? null,
    source: row?.source ?? null,
    model: row?.model ?? null,
    entries: row?.entries ?? count,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
    stale: !!row && row.basis !== basis,
    aiConnected,
    error,
  };
}

/** The answers as the AI writer reads them. */
function summaryEntries(rows: Signal[]): SummaryEntry[] {
  return rows.map((r) => {
    const source = [str(r, FIELDS.sourceRole), str(r, FIELDS.sourceCompany)].filter(Boolean).join(" at ");
    return {
      date: str(r, CORE.date),
      title: str(r, FIELDS.keyQuestion) || str(r, CORE.title) || r.code,
      ...(source ? { source } : {}),
      ...(str(r, FIELDS.insightTopic) ? { topic: str(r, FIELDS.insightTopic) } : {}),
      ...(str(r, FIELDS.keyQuestion) ? { question: str(r, FIELDS.keyQuestion) } : {}),
      ...(str(r, FIELDS.keyDetails) ? { details: str(r, FIELDS.keyDetails).slice(0, 4000) } : {}),
      ...(str(r, FIELDS.keyMetrics) ? { metrics: str(r, FIELDS.keyMetrics).slice(0, 2000) } : {}),
    };
  });
}

function discussionName(rows: Signal[], mode: DiscussionMode): string {
  const cur = rows[0]!;
  const source = [str(cur, FIELDS.sourceRole), str(cur, FIELDS.sourceCompany)].filter(Boolean).join(", ");
  return mode === "kiq"
    ? `KIQ Archive: ${source} · Insight Topic: ${str(cur, FIELDS.insightTopic)} · Key Intelligence Question: ${str(cur, FIELDS.keyQuestion)}`
    : `Full Discussion: ${source}, on ${str(cur, CORE.date)}`;
}

async function writeAi(env: Env, tenantId: string, id: string, mode: DiscussionMode, rows: Signal[], basis: string, settings: TenantSettings, by: Principal | null) {
  const llm = createLlmProvider({ provider: env.LLM_PROVIDER, apiKey: env.ANTHROPIC_API_KEY, timeoutMs: 60_000 });
  const result = await llm.summarize(
    {
      level: "discussion",
      name: discussionName(rows, mode),
      sentences: 6,
      perspective: settings.megatrends.perspective,
      windowDays: 0,
      entries: summaryEntries(rows),
      instructions: settings.discussionSummary.instructions,
    },
    { model: settings.megatrends.model },
  );
  await upsert(env, tenantId, id, mode, { text: result.text, source: "ai", model: result.meta.model, basis, entries: rows.length, by: by?.userId ?? null });
  await audit(env, {
    tenantId,
    actorId: by?.userId ?? null,
    actorEmail: by?.email ?? null,
    action: "summary.generated",
    targetType: "discussion",
    targetId: `${mode}:${id}`,
    details: { model: result.meta.model, entries: rows.length, inputTokens: result.meta.inputTokens ?? null, outputTokens: result.meta.outputTokens ?? null },
  });
}

/**
 * The summary of a discussion. With the AI writer connected, one that is
 * missing (or written by it from answers that have since changed) is written
 * now; if that fails, the reason is returned with whatever is stored.
 */
export async function getDiscussionSummary(env: Env, p: Principal, schema: TrackerSchema, settings: TenantSettings, id: string, mode: DiscussionMode, aiConnected: boolean): Promise<DiscussionSummary> {
  const rows = await answers(env, schema, p.tenantId, id, mode);
  const basis = await basisOf(rows);
  let row = await read(env, p.tenantId, id, mode);
  if (aiConnected && (!row || (row.source === "ai" && row.basis !== basis))) {
    try {
      await writeAi(env, p.tenantId, id, mode, rows, basis, settings, null);
      row = await read(env, p.tenantId, id, mode);
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      return toSummary(id, mode, row, basis, rows.length, aiConnected, `The AI writer could not write this summary: ${err.message}`);
    }
  }
  return toSummary(id, mode, row, basis, rows.length, aiConnected);
}

/** Admins write the summary by hand; empty text removes it (the AI writer, when connected, writes a new one). */
export async function writeDiscussionSummary(env: Env, p: Principal, schema: TrackerSchema, id: string, mode: DiscussionMode, text: string, aiConnected: boolean): Promise<DiscussionSummary> {
  const rows = await answers(env, schema, p.tenantId, id, mode);
  const basis = await basisOf(rows);
  if (!text) await env.DB.prepare("DELETE FROM discussion_summaries WHERE tenant_id = ?1 AND item_id = ?2 AND mode = ?3").bind(p.tenantId, id, mode).run();
  else await upsert(env, p.tenantId, id, mode, { text, source: "manual", model: null, basis, entries: rows.length, by: p.userId });
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "summary.changed", targetType: "discussion", targetId: `${mode}:${id}`, details: { source: text ? "manual" : "removed" } });
  return toSummary(id, mode, await read(env, p.tenantId, id, mode), basis, rows.length, aiConnected);
}

/** Admins have the AI writer write the summary again (replacing a hand-written one). */
export async function regenerateDiscussionSummary(env: Env, p: Principal, schema: TrackerSchema, settings: TenantSettings, id: string, mode: DiscussionMode): Promise<DiscussionSummary> {
  const rows = await answers(env, schema, p.tenantId, id, mode);
  const basis = await basisOf(rows);
  try {
    await writeAi(env, p.tenantId, id, mode, rows, basis, settings, p);
  } catch (err) {
    if (err instanceof LlmError) throw new ApiError(err.code === "NOT_CONFIGURED" ? "CONFLICT" : "MISCONFIGURED", `The AI writer could not write this summary: ${err.message}`);
    throw err;
  }
  return toSummary(id, mode, await read(env, p.tenantId, id, mode), basis, rows.length, true);
}
