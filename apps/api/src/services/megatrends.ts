/**
 * Megatrends: Tracker entries counted per Macrotrend and Subtrend (both
 * trackers, or one), the summary of each, and the entries for the timeline.
 *
 * Counts cover the same entries as the Tracker: approved, not deleted, not
 * deleted from the Tracker only. Summaries: a stored row (written by hand or
 * by the AI writer) overrides the built-in default.
 */
import {
  FIELDS,
  defaultSummary,
  type MegatrendEntry,
  type Megatrends,
  type Stream,
  type TrendLevel,
  type TrendSummary,
} from "@eradigm/shared";
import { createLlmProvider, LlmError, type SummaryEntry } from "@eradigm/llm";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { nowIso } from "../lib/ids.js";
import { audit } from "./audit.js";
import { jsonPath, loadSchema, loadSettings } from "./schema.js";

/** The timeline shows at most this many entries (the most recent). */
export const MEGATRENDS_MAX_ENTRIES = 5000;
/** The AI writer reads at most this many of the most recent entries of a trend. */
export const SUMMARY_MAX_ENTRIES = 40;
const DETAILS_CHARS = 600;

export interface MegatrendsQuery {
  stream: Stream | "all";
  from: string | null;
  to: string | null;
}

const BASE = "i.tenant_id = ?1 AND i.status = 'approved' AND i.deleted_at IS NULL AND i.tracker_hidden_at IS NULL AND i.macrotrend IS NOT NULL AND i.macrotrend <> ''";

function scope(q: MegatrendsQuery): { sql: string; binds: unknown[] } {
  const parts = [BASE];
  const binds: unknown[] = [];
  if (q.stream !== "all") {
    binds.push(q.stream);
    parts.push(`i.stream = ?${binds.length + 1}`);
  }
  if (q.from) {
    binds.push(q.from);
    parts.push(`i.pub_date >= ?${binds.length + 1}`);
  }
  if (q.to) {
    binds.push(q.to);
    parts.push(`i.pub_date <= ?${binds.length + 1}`);
  }
  return { sql: parts.join(" AND "), binds };
}

interface SummaryRow {
  level: TrendLevel;
  name: string;
  text: string;
  source: "manual" | "ai";
  model: string | null;
  window_days: number | null;
  entries: number | null;
  updated_at: string;
  updated_by: string | null;
}

const toSummary = (r: SummaryRow): TrendSummary => ({
  text: r.text,
  source: r.source,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
  model: r.model,
  windowDays: r.window_days,
  entries: r.entries,
});

const fallback = (level: TrendLevel, name: string): TrendSummary | null => {
  const text = defaultSummary(level, name);
  return text ? { text, source: "default", updatedAt: null, updatedBy: null, model: null, windowDays: null, entries: null } : null;
};

const SUMMARY_SELECT =
  "SELECT s.level, s.name, s.text, s.source, s.model, s.window_days, s.entries, s.updated_at, (SELECT u.name FROM users u WHERE u.id = s.updated_by) AS updated_by FROM trend_summaries s WHERE s.tenant_id = ?1";

export async function megatrends(env: Env, tenantId: string, q: MegatrendsQuery, aiConnected: boolean): Promise<Megatrends> {
  const streams: Stream[] = q.stream === "all" ? ["primary", "secondary"] : [q.stream];
  const schemas = await Promise.all(streams.map((s) => loadSchema(env, tenantId, s)));
  const w = scope(q);
  const [counts, rows, sums] = await env.DB.batch([
    env.DB.prepare(`SELECT i.macrotrend AS macro, i.subtrend AS sub, COUNT(*) AS n FROM intelligence_items i WHERE ${w.sql} GROUP BY i.macrotrend, i.subtrend`).bind(tenantId, ...w.binds),
    env.DB.prepare(
      `SELECT i.id, i.signal_code, i.record_id, i.stream, i.pub_date, i.title, i.macrotrend, i.subtrend, i.impact FROM intelligence_items i WHERE ${w.sql}
        ORDER BY i.pub_date DESC, i.signal_code DESC LIMIT ${MEGATRENDS_MAX_ENTRIES + 1}`,
    ).bind(tenantId, ...w.binds),
    env.DB.prepare(SUMMARY_SELECT).bind(tenantId),
  ]);

  // The taxonomy of the trackers covered, in order (Primary first), plus any value only entries still carry.
  const order = new Map<string, string[]>();
  const addMacro = (m: string) => order.get(m) ?? order.set(m, []).get(m)!;
  const addSub = (m: string, s: string) => {
    const list = addMacro(m);
    if (!list.includes(s)) list.push(s);
  };
  for (const sch of schemas) {
    for (const g of sch.taxonomy) {
      addMacro(g.name);
      for (const s of g.subtrends) addSub(g.name, s);
    }
  }
  const macroN = new Map<string, number>();
  const subN = new Map<string, number>();
  for (const r of (counts?.results ?? []) as { macro: string; sub: string | null; n: number }[]) {
    macroN.set(r.macro, (macroN.get(r.macro) ?? 0) + r.n);
    if (r.sub) {
      addSub(r.macro, r.sub);
      subN.set(`${r.macro}\u001f${r.sub}`, (subN.get(`${r.macro}\u001f${r.sub}`) ?? 0) + r.n);
    } else addMacro(r.macro);
  }
  const stored = new Map(((sums?.results ?? []) as unknown as SummaryRow[]).map((r) => [`${r.level}\u001f${r.name}`, r]));
  const summaryOf = (level: TrendLevel, name: string) => {
    const r = stored.get(`${level}\u001f${name}`);
    return r ? toSummary(r) : fallback(level, name);
  };

  const list = (rows?.results ?? []) as {
    id: string;
    signal_code: string;
    record_id: string | null;
    stream: Stream;
    pub_date: string;
    title: string | null;
    macrotrend: string;
    subtrend: string | null;
    impact: string | null;
  }[];
  const truncated = list.length > MEGATRENDS_MAX_ENTRIES;
  const entries: MegatrendEntry[] = list
    .slice(0, MEGATRENDS_MAX_ENTRIES)
    .reverse()
    .map((r) => ({
      id: r.id,
      code: r.signal_code,
      recordId: r.record_id,
      stream: r.stream,
      date: r.pub_date,
      title: r.title ?? "",
      macrotrend: r.macrotrend,
      subtrend: r.subtrend || null,
      impact: r.impact,
    }));

  return {
    stream: q.stream,
    from: q.from,
    to: q.to,
    aiConnected,
    macrotrends: [...order].map(([name, subs]) => ({
      name,
      count: macroN.get(name) ?? 0,
      summary: summaryOf("macro", name),
      subtrends: subs.map((s) => ({ name: s, count: subN.get(`${name}\u001f${s}`) ?? 0, summary: summaryOf("sub", s) })),
    })),
    entries,
    truncated,
  };
}

async function readSummary(env: Env, tenantId: string, level: TrendLevel, name: string): Promise<TrendSummary | null> {
  const r = await env.DB.prepare(`${SUMMARY_SELECT} AND s.level = ?2 AND s.name = ?3`).bind(tenantId, level, name).first<SummaryRow>();
  return r ? toSummary(r) : fallback(level, name);
}

const EMPTY: TrendSummary = { text: "", source: "default", updatedAt: null, updatedBy: null, model: null, windowDays: null, entries: null };

/** Write a summary by hand; empty text goes back to the default. */
export async function writeSummary(env: Env, p: Principal, b: { level: TrendLevel; name: string; parent?: string; text: string }): Promise<TrendSummary> {
  if (!b.text) {
    await env.DB.prepare("DELETE FROM trend_summaries WHERE tenant_id = ?1 AND level = ?2 AND name = ?3").bind(p.tenantId, b.level, b.name).run();
  } else {
    await upsert(env, p, { ...b, source: "manual", model: null, windowDays: null, entries: null });
  }
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "summary.changed", targetType: "trend", targetId: `${b.level}:${b.name}`, details: { source: b.text ? "manual" : "default" } });
  return (await readSummary(env, p.tenantId, b.level, b.name)) ?? EMPTY;
}

function upsert(
  env: Env,
  p: Principal,
  r: { level: TrendLevel; name: string; parent?: string; text: string; source: "manual" | "ai"; model: string | null; windowDays: number | null; entries: number | null },
) {
  return env.DB.prepare(
    `INSERT INTO trend_summaries (tenant_id, level, name, parent, text, source, model, window_days, entries, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT (tenant_id, level, name) DO UPDATE SET parent = excluded.parent, text = excluded.text, source = excluded.source, model = excluded.model,
       window_days = excluded.window_days, entries = excluded.entries, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(p.tenantId, r.level, r.name, r.parent ?? null, r.text, r.source, r.model, r.windowDays, r.entries, p.userId, nowIso())
    .run();
}

/** A date `days` before `today` (YYYY-MM-DD). */
export const daysBefore = (today: string, days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Write a summary with the AI writer from the trend's entries of the last
 * `summaryDays` days (Settings → Megatrends). Both trackers are read.
 */
export async function generateSummary(env: Env, p: Principal, b: { level: TrendLevel; name: string; parent?: string }, today: string): Promise<TrendSummary> {
  const { megatrends: cfg } = await loadSettings(env, p.tenantId);
  const since = daysBefore(today, cfg.summaryDays);
  const col = b.level === "macro" ? "i.macrotrend" : "i.subtrend";
  const parentSql = b.level === "sub" && b.parent ? " AND i.macrotrend = ?4" : "";
  const res = await env.DB.prepare(
    `SELECT i.pub_date, i.title, json_extract(i.extra_json, ?5) AS details,
            (SELECT group_concat(c.competitor, '\u001f') FROM item_competitors c WHERE c.item_id = i.id) AS competitors
       FROM intelligence_items i
      WHERE i.tenant_id = ?1 AND i.status = 'approved' AND i.deleted_at IS NULL AND i.tracker_hidden_at IS NULL AND ${col} = ?2 AND i.pub_date >= ?3${parentSql}
      ORDER BY i.pub_date DESC, i.signal_code DESC LIMIT ${SUMMARY_MAX_ENTRIES}`,
  )
    .bind(p.tenantId, b.name, since, b.parent ?? null, jsonPath(FIELDS.keyDetails))
    .all<{ pub_date: string; title: string | null; details: string | null; competitors: string | null }>();
  const rows = (res.results ?? []).reverse();
  if (!rows.length) throw new ApiError("CONFLICT", `No ${b.name} entries in the last ${cfg.summaryDays} days to summarise. Widen the time frame in Administration → Megatrends.`);
  const entries: SummaryEntry[] = rows.map((r) => ({
    date: r.pub_date,
    title: r.title ?? "",
    ...(r.competitors ? { competitors: r.competitors.split("\u001f") } : {}),
    ...(r.details ? { details: r.details.length > DETAILS_CHARS ? `${r.details.slice(0, DETAILS_CHARS - 1)}…` : r.details } : {}),
  }));

  let result;
  try {
    const llm = createLlmProvider({ provider: env.LLM_PROVIDER, apiKey: env.ANTHROPIC_API_KEY, timeoutMs: 60_000 });
    result = await llm.summarize(
      { level: b.level, name: b.name, parent: b.parent, sentences: cfg.summarySentences, perspective: cfg.perspective, windowDays: cfg.summaryDays, entries },
      { model: cfg.model },
    );
  } catch (err) {
    if (err instanceof LlmError) throw new ApiError(err.code === "NOT_CONFIGURED" ? "CONFLICT" : "MISCONFIGURED", `The AI writer could not write this summary: ${err.message}`);
    throw err;
  }
  await upsert(env, p, { level: b.level, name: b.name, parent: b.parent, text: result.text, source: "ai", model: result.meta.model, windowDays: cfg.summaryDays, entries: entries.length });
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "summary.generated",
    targetType: "trend",
    targetId: `${b.level}:${b.name}`,
    details: { model: result.meta.model, entries: entries.length, windowDays: cfg.summaryDays, inputTokens: result.meta.inputTokens ?? null, outputTokens: result.meta.outputTokens ?? null },
  });
  return (await readSummary(env, p.tenantId, b.level, b.name)) ?? EMPTY;
}
