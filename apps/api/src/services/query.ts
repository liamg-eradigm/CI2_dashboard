/**
 * Server-side queries over approved intelligence items.
 *
 * One `buildWhere` is used by the tracker, the KPIs, every chart and the
 * export, so dashboard totals reconcile with filtered tracker records by
 * construction. Only approved, non-deleted items are ever returned.
 */
import {
  ALL,
  CHART_SKIPS,
  CORE,
  bucket,
  computePeriodStats,
  baselinePeriod,
  evaluateTrend,
  filterableColumns,
  getColumn,
  levelOf,
  sortedColumns,
  subtrendsOf,
  type Bar,
  type DashboardData,
  type FilterState,
  type ItemValues,
  type Signal,
  type Stream,
  type TrackerSchema,
  type TrendConfig,
  type TrendResult,
} from "@eradigm/shared";
import type { Env } from "../env.js";
import { PHYSICAL, jsonPath } from "./schema.js";

const SEP = "\u001f";

export interface Where {
  sql: string;
  binds: unknown[];
}


/**
 * Which entries a view covers. The Dashboard covers every stream (no scope);
 * the Tracker one stream; Phantoms one stream, where Secondary entries only
 * count at or above the admin-set Impact (`impacts` = the qualifying values).
 */
export interface Scope {
  stream?: Stream;
  impacts?: string[];
  /** The table whose "deleted from this table only" entries are left out: Phantoms, else the Tracker (Dashboard, Trend Test). */
  table?: "tracker" | "phantoms";
}

/** Entries removed from one table only stay out of that table (see migration 0007). */
export const visibleIn = (table: "tracker" | "phantoms" = "tracker") => (table === "phantoms" ? "i.phantoms_hidden_at IS NULL" : "i.tracker_hidden_at IS NULL");

function scopeWhere(scope: Scope): Where {
  const parts: string[] = [visibleIn(scope.table)];
  const binds: unknown[] = [];
  if (scope.stream) {
    parts.push("i.stream = ?");
    binds.push(scope.stream);
  }
  if (scope.impacts) {
    parts.push(scope.impacts.length ? `i.impact IN (${scope.impacts.map(() => "?").join(",")})` : "0");
    binds.push(...scope.impacts);
  }
  return { sql: parts.join(" AND "), binds };
}

export function buildWhere(schema: TrackerSchema, tenantId: string, f: FilterState, skip: readonly string[] = [], scope: Scope = {}): Where {
  const parts = ["i.tenant_id = ?", "i.status = 'approved'", "i.deleted_at IS NULL", "i.pub_date >= ?", "i.pub_date <= ?"];
  const binds: unknown[] = [tenantId, f.from, f.to];
  const sc = scopeWhere(scope);
  if (sc.sql) {
    parts.push(sc.sql);
    binds.push(...sc.binds);
  }
  if (f.q) {
    // Case-insensitive substring match. instr() rather than LIKE: D1 rejects LIKE
    // patterns longer than 50 characters ("pattern too complex"), e.g. a pasted title.
    parts.push("(instr(lower(i.title), ?) > 0 OR instr(lower(i.body_text), ?) > 0)");
    // SQLite's lower() folds ASCII only; fold the query the same way.
    const needle = f.q.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
    binds.push(needle, needle);
  }
  for (const col of filterableColumns(schema)) {
    if (skip.includes(col.key)) continue;
    const v = f.values[col.key];
    if (!v || v === ALL) continue;
    if (col.type === "multi") {
      parts.push("EXISTS (SELECT 1 FROM item_competitors c WHERE c.item_id = i.id AND c.competitor = ?)");
      binds.push(v);
    } else if (PHYSICAL[col.key]) {
      parts.push(`i.${PHYSICAL[col.key]} = ?`);
      binds.push(v);
    } else {
      parts.push("json_extract(i.extra_json, ?) = ?");
      binds.push(jsonPath(col.key), v);
    }
  }
  return { sql: parts.join(" AND "), binds };
}

/** ORDER BY for a column: dropdowns sort by option order, multi by first competitor. */
function orderBy(schema: TrackerSchema, key: string, dir: "asc" | "desc"): Where {
  const col = getColumn(schema, key) ?? getColumn(schema, CORE.date);
  const d = dir === "asc" ? "ASC" : "DESC";
  const tie = "i.pub_date DESC, i.signal_code DESC";
  if (!col) return { sql: tie, binds: [] };
  const expr = PHYSICAL[col.key] ? `i.${PHYSICAL[col.key]}` : col.type === "multi" ? "(SELECT MIN(c.competitor) FROM item_competitors c WHERE c.item_id = i.id)" : "json_extract(i.extra_json, ?)";
  const binds: unknown[] = PHYSICAL[col.key] || col.type === "multi" ? [] : [jsonPath(col.key)];
  if (col.type === "select" && col.options?.length) {
    const cases = col.options.map(() => "WHEN ? THEN ?").join(" ");
    const caseBinds: unknown[] = [...binds];
    col.options.forEach((o, idx) => caseBinds.push(o, idx));
    return { sql: `CASE ${expr} ${cases} ELSE 999 END ${d}, ${tie}`, binds: caseBinds };
  }
  if (col.type === "date") return { sql: `${expr} ${d}, i.signal_code ${d}`, binds };
  return { sql: `lower(${expr}) ${d}, ${tie}`, binds };
}

interface SignalRow {
  id: string;
  signal_code: string;
  stream: Stream;
  record_id: string | null;
  pub_date: string;
  title: string | null;
  macrotrend: string | null;
  subtrend: string | null;
  growth: string | null;
  impact: string | null;
  extra_json: string;
  competitors: string | null;
  body_text: string | null;
  final_url: string | null;
  published_rev: number;
  approved_at: string;
  approved_by_name: string | null;
  has_snapshot: number | null;
}

const SIGNAL_COLUMNS = `i.id, i.signal_code, i.stream, i.record_id, i.pub_date, i.title, i.macrotrend, i.subtrend, i.growth, i.impact, i.extra_json,
  (SELECT group_concat(c.competitor, '${SEP}') FROM item_competitors c WHERE c.item_id = i.id) AS competitors,
  substr(i.body_text, 1, 600) AS body_text, i.final_url, i.published_rev, i.approved_at,
  (SELECT u.name FROM users u WHERE u.id = i.approved_by) AS approved_by_name,
  (SELECT s.retention_status = 'active' FROM source_snapshots s WHERE s.id = i.current_snapshot_id) AS has_snapshot`;

export function rowValues(
  schema: TrackerSchema,
  r: Pick<SignalRow, "pub_date" | "title" | "macrotrend" | "subtrend" | "growth" | "impact" | "extra_json" | "competitors"> & { record_id?: string | null },
): ItemValues {
  const extra = JSON.parse(r.extra_json || "{}") as ItemValues;
  const out: ItemValues = {};
  for (const col of schema.columns) {
    if (col.key === CORE.date) out[col.key] = r.pub_date;
    else if (col.key === CORE.competitors) out[col.key] = r.competitors ? r.competitors.split(SEP).sort() : [];
    else if (PHYSICAL[col.key]) out[col.key] = (r as unknown as Record<string, string | null>)[PHYSICAL[col.key] as string] ?? null;
    else out[col.key] = extra[col.key] ?? null;
  }
  return out;
}

function toSignal(schema: TrackerSchema, r: SignalRow): Signal {
  return {
    id: r.id,
    code: r.signal_code,
    stream: r.stream,
    values: rowValues(schema, r),
    text: r.body_text ?? "",
    url: r.final_url,
    rev: r.published_rev,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by_name ?? "—",
    hasSnapshot: !!r.has_snapshot,
  };
}

async function countPublished(env: Env, tenantId: string, scope: Scope = {}): Promise<number> {
  const sc = scopeWhere(scope);
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM intelligence_items i WHERE i.tenant_id = ? AND i.status = 'approved' AND i.deleted_at IS NULL${sc.sql ? ` AND ${sc.sql}` : ""}`)
    .bind(tenantId, ...sc.binds)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function trackerPage(
  env: Env,
  schema: TrackerSchema,
  tenantId: string,
  f: FilterState,
  sort: { key: string; dir: "asc" | "desc" },
  page: number,
  pageSize: number,
  scope: Scope = {},
) {
  const w = buildWhere(schema, tenantId, f, [], scope);
  const o = orderBy(schema, sort.key, sort.dir);
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`SELECT ${SIGNAL_COLUMNS} FROM intelligence_items i WHERE ${w.sql} ORDER BY ${o.sql} LIMIT ? OFFSET ?`).bind(...w.binds, ...o.binds, pageSize, page * pageSize),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM intelligence_items i WHERE ${w.sql}`).bind(...w.binds),
  ]);
  return {
    rows: ((rows?.results ?? []) as unknown as SignalRow[]).map((r) => toSignal(schema, r)),
    total: ((count?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0,
    totalPublished: await countPublished(env, tenantId, scope),
    page,
    pageSize,
  };
}

export const EXPORT_MAX_ROWS = 50_000;

export async function exportRows(env: Env, schema: TrackerSchema, tenantId: string, f: FilterState | null, sort: { key: string; dir: "asc" | "desc" }, scope: Scope = {}) {
  const sc = scopeWhere(scope);
  const w = f
    ? buildWhere(schema, tenantId, f, [], scope)
    : { sql: `i.tenant_id = ? AND i.status = 'approved' AND i.deleted_at IS NULL${sc.sql ? ` AND ${sc.sql}` : ""}`, binds: [tenantId, ...sc.binds] };
  const o = orderBy(schema, sort.key, sort.dir);
  const res = await env.DB.prepare(`SELECT ${SIGNAL_COLUMNS} FROM intelligence_items i WHERE ${w.sql} ORDER BY ${o.sql} LIMIT ${EXPORT_MAX_ROWS}`)
    .bind(...w.binds, ...o.binds)
    .all<SignalRow>();
  return (res.results ?? []).map((r) => ({ signalId: r.signal_code, values: rowValues(schema, r) }));
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const TIMELINE_LIMIT = 2000;

export async function dashboard(env: Env, schema: TrackerSchema, tenantId: string, f: FilterState): Promise<DashboardData> {
  const impactCol = getColumn(schema, CORE.impact);
  const compCol = getColumn(schema, CORE.competitors);
  const iOpts = impactCol?.options ?? [];
  const full = buildWhere(schema, tenantId, f);
  const wMacro = buildWhere(schema, tenantId, f, CHART_SKIPS.macrotrend);
  const wSub = buildWhere(schema, tenantId, f, CHART_SKIPS.subtrend);
  const wComp = buildWhere(schema, tenantId, f, CHART_SKIPS.competitor);
  const sourcePath = jsonPath("source");

  const results = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM intelligence_items i WHERE ${full.sql}`).bind(...full.binds),
    env.DB.prepare(`SELECT i.impact AS k, COUNT(*) AS n FROM intelligence_items i WHERE ${full.sql} GROUP BY i.impact`).bind(...full.binds),
    env.DB.prepare(`SELECT COUNT(DISTINCT c.competitor) AS n FROM item_competitors c JOIN intelligence_items i ON i.id = c.item_id WHERE ${full.sql}`).bind(...full.binds),
    env.DB.prepare(
      `SELECT i.id, i.signal_code, i.pub_date, i.title, i.growth, i.impact, json_extract(i.extra_json, ?) AS source,
              (SELECT group_concat(c.competitor, '${SEP}') FROM item_competitors c WHERE c.item_id = i.id) AS competitors
         FROM intelligence_items i WHERE ${full.sql} ORDER BY i.pub_date DESC LIMIT ${TIMELINE_LIMIT + 1}`,
    ).bind(sourcePath, ...full.binds),
    env.DB.prepare(`SELECT i.macrotrend AS label, i.impact AS k, COUNT(*) AS n FROM intelligence_items i WHERE ${wMacro.sql} GROUP BY 1, 2`).bind(...wMacro.binds),
    env.DB.prepare(`SELECT i.subtrend AS label, i.impact AS k, COUNT(*) AS n FROM intelligence_items i WHERE ${wSub.sql} GROUP BY 1, 2`).bind(...wSub.binds),
    env.DB.prepare(
      `SELECT c.competitor AS label, i.impact AS k, COUNT(*) AS n FROM item_competitors c JOIN intelligence_items i ON i.id = c.item_id WHERE ${wComp.sql} GROUP BY 1, 2`,
    ).bind(...wComp.binds),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM intelligence_items i WHERE ${wComp.sql}`).bind(...wComp.binds),
  ]);
  const rs = <T>(i: number) => (results[i]?.results ?? []) as unknown as T[];
  const approved = rs<{ n: number }>(0)[0]?.n ?? 0;
  const byImpact = new Map(rs<{ k: string | null; n: number }>(1).map((r) => [r.k, r.n]));
  const timelineRows = rs<{ id: string; signal_code: string; pub_date: string; title: string | null; growth: string | null; impact: string | null; source: string | null; competitors: string | null }>(3);

  const bars = (labels: string[], rows: { label: string | null; k: string | null; n: number }[]): Bar[] => {
    const m = new Map<string, Bar>(labels.map((l) => [l, { label: l, n: 0, high: 0, medium: 0, low: 0 }]));
    for (const r of rows) {
      if (r.label == null) continue;
      const b = m.get(r.label);
      if (!b) continue; // value no longer in taxonomy (should not happen)
      b.n += r.n;
      const bk = bucket(iOpts.indexOf(r.k ?? ""), iOpts.length);
      if (r.k == null || iOpts.indexOf(r.k) < 0) continue;
      if (bk === 2) b.high += r.n;
      else if (bk === 1) b.medium += r.n;
      else b.low += r.n;
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  };

  const macroBars = bars(schema.taxonomy.map((g) => g.name), rs(4));
  const subLabels = subtrendsOf(schema, f.values[CORE.macrotrend] ?? ALL);
  const subBars = bars(subLabels, rs(5));
  const compBars = bars(compCol?.options ?? [], rs(6));

  return {
    kpis: {
      approved,
      totalPublished: await countPublished(env, tenantId),
      competitorsInvolved: rs<{ n: number }>(2)[0]?.n ?? 0,
      competitorsTracked: compCol?.options?.length ?? 0,
      high: iOpts.length ? (byImpact.get(iOpts[iOpts.length - 1] as string) ?? 0) : 0,
      low: iOpts.length ? (byImpact.get(iOpts[0] as string) ?? 0) : 0,
    },
    timeline: timelineRows.slice(0, TIMELINE_LIMIT).map((r) => ({
      id: r.id,
      code: r.signal_code,
      date: r.pub_date,
      title: r.title ?? "",
      competitors: r.competitors ? r.competitors.split(SEP).sort() : [],
      growth: r.growth,
      impact: r.impact,
      source: r.source,
    })),
    timelineTruncated: timelineRows.length > TIMELINE_LIMIT,
    macroBars,
    subBars,
    compBars,
    compSum: compBars.reduce((a, b) => a + b.n, 0),
    compItems: rs<{ n: number }>(7)[0]?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Trend Test
// ---------------------------------------------------------------------------

export async function trendTest(env: Env, schema: TrackerSchema, tenantId: string, cfg: TrendConfig): Promise<TrendResult & { counts: { current: number; baseline: number } }> {
  const { current, baseline } = baselinePeriod(cfg.from, cfg.to);
  const impactCol = getColumn(schema, CORE.impact);
  const growthCol = getColumn(schema, CORE.growth);
  const load = async (from: string, to: string) => {
    const parts = ["i.tenant_id = ?", "i.status = 'approved'", "i.deleted_at IS NULL", visibleIn("tracker"), "i.pub_date >= ?", "i.pub_date <= ?"];
    const binds: unknown[] = [tenantId, from, to];
    if (cfg.macrotrend && cfg.macrotrend !== ALL) {
      parts.push("i.macrotrend = ?");
      binds.push(cfg.macrotrend);
    }
    if (cfg.subtrend && cfg.subtrend !== ALL) {
      parts.push("i.subtrend = ?");
      binds.push(cfg.subtrend);
    }
    if (cfg.growth && cfg.growth !== ALL) {
      parts.push("i.growth = ?");
      binds.push(cfg.growth);
    }
    if (cfg.competitors.length) {
      parts.push(`EXISTS (SELECT 1 FROM item_competitors c WHERE c.item_id = i.id AND c.competitor IN (${cfg.competitors.map(() => "?").join(",")}))`);
      binds.push(...cfg.competitors);
    }
    const res = await env.DB.prepare(
      `SELECT i.impact, i.growth, (SELECT group_concat(c.competitor, '${SEP}') FROM item_competitors c WHERE c.item_id = i.id) AS competitors
         FROM intelligence_items i WHERE ${parts.join(" AND ")}`,
    )
      .bind(...binds)
      .all<{ impact: string | null; growth: string | null; competitors: string | null }>();
    return (res.results ?? []).map((r) => {
      let comps = r.competitors ? r.competitors.split(SEP) : [];
      if (cfg.competitors.length) comps = comps.filter((c) => cfg.competitors.includes(c));
      return { competitors: comps, impactIndex: levelOf(impactCol, r.impact), growthIndex: levelOf(growthCol, r.growth) };
    });
  };
  const [cur, base] = await Promise.all([load(current.from, current.to), load(baseline.from, baseline.to)]);
  const result = evaluateTrend(cfg, computePeriodStats(cur), computePeriodStats(base));
  return { ...result, counts: { current: cur.length, baseline: base.length } };
}

export { sortedColumns };
