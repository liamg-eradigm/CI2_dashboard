/**
 * Trend Analyses (request 29, contract 1.18).
 *
 * An analysis of a Macrotrend, Subtrend or competitor submitted on the Input
 * page, one at a time or from a spreadsheet. Submitting one writes the trend's
 * summary (trend_summaries, shown on the Trend analysis subtab and in the
 * knowledge graph) and keeps the submission in trend_analyses (migration 0018)
 * for the Trend Analyses tracker, where each is a Markdown file.
 */
import {
  CORE,
  IMPORT_CHUNK_ROWS,
  TREND_ANALYSIS_COLUMNS,
  TREND_LEVEL_LABEL,
  categoryOfLevel,
  isPlaceholderCompetitor,
  parseTrendCategory,
  parseTrendLevel,
  trendAnalysisFileName,
  trendAnalysisMarkdown,
  type TrackerSchema,
  type TrendAnalysis,
  type TrendAnalysisSource,
  type TrendLevel,
} from "@eradigm/shared";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { ApiError, badRequest, notFound } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { audit } from "./audit.js";
import { upsertStatement } from "./megatrends.js";
import type { Schemas } from "./schema.js";

interface Row {
  id: string;
  level: TrendLevel;
  name: string;
  parent: string | null;
  text: string;
  source: TrendAnalysisSource;
  file_name: string | null;
  submitted_at: string;
  submitted_by: string | null;
}

const SELECT = `SELECT a.id, a.level, a.name, a.parent, a.text, a.source, a.file_name, a.submitted_at,
  (SELECT u.name FROM users u WHERE u.id = a.submitted_by) AS submitted_by FROM trend_analyses a WHERE a.tenant_id = ?1`;

const toAnalysis = (r: Row): TrendAnalysis => ({
  id: r.id,
  category: categoryOfLevel(r.level),
  level: r.level,
  name: r.name,
  parent: r.parent,
  text: r.text,
  submittedAt: r.submitted_at,
  submittedBy: r.submitted_by ?? "—",
  source: r.source,
  fileName: r.file_name,
});

/** Every submission, newest first. */
export async function listTrendAnalyses(env: Env, tenantId: string): Promise<TrendAnalysis[]> {
  const { results } = await env.DB.prepare(`${SELECT} ORDER BY a.submitted_at DESC, a.rowid DESC LIMIT 5000`).bind(tenantId).all<Row>();
  return (results ?? []).map(toAnalysis);
}

// ---------------------------------------------------------------------------
// Which trend a submission is for
// ---------------------------------------------------------------------------

/** The names the trackers know (taxonomy and Competitors options), by lower case. */
interface Known {
  macros: Map<string, string>;
  /** Subtrend → its Macrotrends (a Subtrend name can sit under more than one). */
  subs: Map<string, { name: string; parent: string }[]>;
  comps: Map<string, string>;
}

const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function knownNames(schemas: Schemas): Known {
  const k: Known = { macros: new Map(), subs: new Map(), comps: new Map() };
  for (const sch of [schemas.primary, schemas.secondary] as TrackerSchema[]) {
    for (const g of sch.taxonomy) {
      if (!k.macros.has(key(g.name))) k.macros.set(key(g.name), g.name);
      for (const s of g.subtrends) {
        const list = k.subs.get(key(s)) ?? k.subs.set(key(s), []).get(key(s))!;
        if (!list.some((x) => x.parent === g.name)) list.push({ name: s, parent: g.name });
      }
    }
    for (const o of sch.columns.find((c) => c.key === CORE.competitors)?.options ?? []) if (!k.comps.has(key(o))) k.comps.set(key(o), o);
  }
  return k;
}

type Resolved = { ok: true; level: TrendLevel; name: string; parent: string | null } | { ok: false; column: string; message: string };

/**
 * The trend a submission names, spelt as the trackers spell it. Names in the
 * taxonomy or the Competitors options match in any case; a name only Tracker
 * entries still carry (since removed from the dropdowns) matches exactly.
 */
async function resolve(env: Env, tenantId: string, known: Known, level: TrendLevel, rawName: string, rawParent?: string | null): Promise<Resolved> {
  const name = rawName.replace(/\s+/g, " ").trim();
  const col = TREND_ANALYSIS_COLUMNS.name;
  if (!name)
    return {
      ok: false,
      column: col,
      message: `Give the name of the ${TREND_LEVEL_LABEL[level]}.`,
    };
  if (level === "macro") {
    const hit = known.macros.get(key(name));
    if (hit) return { ok: true, level, name: hit, parent: null };
    const row = await env.DB.prepare("SELECT macrotrend FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved' AND macrotrend = ?2 LIMIT 1")
      .bind(tenantId, name)
      .first<{ macrotrend: string }>();
    if (row) return { ok: true, level, name: row.macrotrend, parent: null };
    return {
      ok: false,
      column: col,
      message: `There is no Macrotrend named “${name}”.`,
    };
  }
  if (level === "sub") {
    const parent = rawParent?.replace(/\s+/g, " ").trim() || null;
    const hits = known.subs.get(key(name)) ?? [];
    const hit = (parent ? hits.find((h) => key(h.parent) === key(parent)) : null) ?? hits[0];
    if (hit) return { ok: true, level, name: hit.name, parent: hit.parent };
    const row = parent
      ? await env.DB.prepare("SELECT macrotrend, subtrend FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved' AND macrotrend = ?2 AND subtrend = ?3 LIMIT 1")
          .bind(tenantId, parent, name)
          .first<{ macrotrend: string; subtrend: string }>()
      : await env.DB.prepare("SELECT macrotrend, subtrend FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved' AND subtrend = ?2 LIMIT 1")
          .bind(tenantId, name)
          .first<{ macrotrend: string; subtrend: string }>();
    if (row) return { ok: true, level, name: row.subtrend, parent: row.macrotrend };
    return {
      ok: false,
      column: col,
      message: `There is no Subtrend named “${name}”.`,
    };
  }
  if (isPlaceholderCompetitor(name))
    return {
      ok: false,
      column: col,
      message: `“${name}” is not a competitor.`,
    };
  const hit = known.comps.get(key(name));
  if (hit) return { ok: true, level, name: hit, parent: null };
  const row = await env.DB.prepare("SELECT competitor FROM item_competitors WHERE tenant_id = ?1 AND competitor = ?2 LIMIT 1").bind(tenantId, name).first<{ competitor: string }>();
  if (row) return { ok: true, level, name: row.competitor, parent: null };
  return {
    ok: false,
    column: col,
    message: `There is no competitor named “${name}” (it must be a Competitors option or named by a Tracker entry).`,
  };
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

interface Submission {
  level: TrendLevel;
  name: string;
  parent: string | null;
  text: string;
}

/** Stores the submissions and makes each the analysis of its trend (later ones win). */
async function store(env: Env, p: Principal, list: Submission[], source: TrendAnalysisSource, fileName: string | null): Promise<TrendAnalysis[]> {
  const at = nowIso();
  const made: TrendAnalysis[] = list.map((s) => ({
    id: newId("ta"),
    category: categoryOfLevel(s.level),
    level: s.level,
    name: s.name,
    parent: s.parent,
    text: s.text,
    submittedAt: at,
    submittedBy: p.name,
    source,
    fileName,
  }));
  await env.DB.batch(
    made.flatMap((a) => [
      env.DB.prepare("INSERT INTO trend_analyses (id, tenant_id, level, name, parent, text, source, file_name, submitted_by, submitted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)").bind(
        a.id,
        p.tenantId,
        a.level,
        a.name,
        a.parent,
        a.text,
        source,
        fileName,
        p.userId,
        at,
      ),
      upsertStatement(env, p, {
        level: a.level,
        name: a.name,
        parent: a.parent,
        text: a.text,
        source: "manual",
        model: null,
        windowDays: null,
        entries: null,
      }),
    ]),
  );
  return made;
}

/** One analysis from the Input page form. */
export async function createTrendAnalysis(env: Env, p: Principal, schemas: Schemas, b: { level: TrendLevel; name: string; parent?: string; text: string }): Promise<TrendAnalysis> {
  const r = await resolve(env, p.tenantId, knownNames(schemas), b.level, b.name, b.parent);
  if (!r.ok) throw badRequest(r.message);
  const [made] = await store(env, p, [{ level: r.level, name: r.name, parent: r.parent, text: b.text.trim() }], "form", null);
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "trend_analysis.submitted",
    targetType: "trend",
    targetId: `${r.level}:${r.name}`,
    details: { id: made!.id, chars: made!.text.length },
  });
  return made!;
}

type ImportError = { row: number; column: string | null; message: string };

/**
 * Spreadsheet rows keyed by the four column names. A dry run checks up to 200
 * rows and writes nothing; otherwise at most IMPORT_CHUNK_ROWS rows, all or
 * none.
 */
export async function importTrendAnalyses(
  env: Env,
  p: Principal,
  schemas: Schemas,
  b: {
    fileName: string;
    rows: { row: number; values: Record<string, string> }[];
    dryRun?: boolean;
  },
): Promise<{ ok: boolean; imported: number; errors: ImportError[] }> {
  if (!b.dryRun && b.rows.length > IMPORT_CHUNK_ROWS) throw badRequest(`Send at most ${IMPORT_CHUNK_ROWS} rows at a time (or a dry run of up to 200).`);
  const known = knownNames(schemas);
  const C = TREND_ANALYSIS_COLUMNS;
  const errors: ImportError[] = [];
  const ok: Submission[] = [];
  for (const { row, values } of b.rows) {
    const v = (k: keyof typeof C) => (values[C[k]] ?? "").trim();
    const category = parseTrendCategory(v("category"));
    const level = parseTrendLevel(v("level"));
    const text = v("text");
    const before = errors.length;
    if (!category)
      errors.push({
        row,
        column: C.category,
        message: `Write “Macrotrend” or “Competitor”${v("category") ? ` (not “${v("category")}”)` : ""}.`,
      });
    if (!level)
      errors.push({
        row,
        column: C.level,
        message: `Write “Competitor”, “Macrotrend” or “Subtrend”${v("level") ? ` (not “${v("level")}”)` : ""}.`,
      });
    else if (category && categoryOfLevel(level) !== category)
      errors.push({
        row,
        column: C.level,
        message: category === "competitor" ? "A Competitor row must say “Competitor” here." : "A Macrotrend row must say “Macrotrend” or “Subtrend” here.",
      });
    if (!text)
      errors.push({
        row,
        column: C.text,
        message: "The trend analysis is empty.",
      });
    else if (text.length > 10_000)
      errors.push({
        row,
        column: C.text,
        message: `The trend analysis is ${text.length.toLocaleString("en-GB")} characters; the most is 10,000.`,
      });
    // The name is only looked up once the row says what it names.
    if (!level || (category && categoryOfLevel(level) !== category)) {
      if (!v("name")) errors.push({ row, column: C.name, message: "Give the name." });
      continue;
    }
    const r = await resolve(env, p.tenantId, known, level, v("name"));
    if (!r.ok) errors.push({ row, column: r.column, message: r.message });
    if (errors.length === before && r.ok) ok.push({ level: r.level, name: r.name, parent: r.parent, text });
  }
  if (errors.length || b.dryRun) return { ok: !errors.length, imported: 0, errors };
  await store(env, p, ok, "import", b.fileName);
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "trend_analysis.imported",
    targetType: "trend",
    targetId: b.fileName,
    details: { rows: ok.length, trends: ok.map((s) => `${s.level}:${s.name}`) },
  });
  return { ok: true, imported: ok.length, errors: [] };
}

async function one(env: Env, tenantId: string, id: string): Promise<TrendAnalysis> {
  const r = await env.DB.prepare(`${SELECT} AND a.id = ?2`).bind(tenantId, id).first<Row>();
  if (!r) throw notFound("Trend analysis");
  return toAnalysis(r);
}

/** A submission as its Markdown file. */
export async function trendAnalysisFile(env: Env, tenantId: string, id: string): Promise<{ markdown: string; fileName: string; analysis: TrendAnalysis }> {
  const a = await one(env, tenantId, id);
  return {
    markdown: trendAnalysisMarkdown(a),
    fileName: trendAnalysisFileName(a),
    analysis: a,
  };
}

/** Removes a submission from the tracker; the trend keeps the analysis it shows now. */
export async function deleteTrendAnalysis(env: Env, p: Principal, id: string): Promise<void> {
  const a = await one(env, p.tenantId, id);
  const r = await env.DB.prepare("DELETE FROM trend_analyses WHERE tenant_id = ?1 AND id = ?2").bind(p.tenantId, id).run();
  if (!r.meta.changes) throw new ApiError("NOT_FOUND", "Trend analysis not found");
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "trend_analysis.deleted",
    targetType: "trend",
    targetId: `${a.level}:${a.name}`,
    details: { id },
  });
}
