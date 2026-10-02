/**
 * Tenant tracker schema: columns, dropdown options and the macrotrend →
 * subtrend taxonomy. Renames propagate to published signals, pending drafts
 * and (on the dashboard) active filters. Deleting an option is blocked while
 * any published signal uses it.
 */
import {
  ALL,
  MAX_TEXT_LENGTH,
  TYPE_LABEL,
  CORE,
  DEFAULT_NAV_ORDER,
  DEFAULT_TREND_THRESHOLDS,
  STREAMS,
  checkColumnLabel,
  checkOptionName,
  defaultSchema,
  defaultSummary,
  getColumn,
  hasOptions,
  normaliseNavOrder,
  splitMulti,
  tableColumns,
  type CreatableColumnType,
  type TableName,
  type Stream,
  type TenantSettings,
  type TrackerColumn,
  type TrackerSchema,
  type TrendLevel,
} from "@eradigm/shared";
import type { Env } from "../env.js";
import { ApiError, badRequest, notFound } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { renamePhantomOption } from "./phantoms.js";

/** Core columns stored as physical columns on intelligence_items (published projection). */
export const PHYSICAL: Record<string, string> = {
  [CORE.date]: "pub_date",
  [CORE.title]: "title",
  [CORE.macrotrend]: "macrotrend",
  [CORE.subtrend]: "subtrend",
  [CORE.growth]: "growth",
  [CORE.impact]: "impact",
  // The analyst-entered ID (unique among tracker entries of a tenant).
  record_id: "record_id",
};

export function jsonPath(key: string): string {
  return `$."${key}"`;
}

interface ColumnRow {
  key: string;
  label: string;
  type: TrackerColumn["type"];
  core: number;
  required: number;
  ai_assist: number;
  in_tracker: number;
  position: number;
  tracker_position: number;
  in_phantoms: number;
  phantoms_position: number;
}
interface OptionRow {
  column_key: string;
  value: string;
  parent: string | null;
  position: number;
}

/** A stream's column set (each stream has its own, edited independently). */
export async function loadSchema(env: Env, tenantId: string, stream: Stream = "primary"): Promise<TrackerSchema> {
  const [meta, cols, opts] = await env.DB.batch([
    env.DB.prepare("SELECT revision FROM schema_meta WHERE tenant_id = ?1").bind(tenantId),
    env.DB.prepare(
      "SELECT key, label, type, core, required, ai_assist, in_tracker, position, tracker_position, in_phantoms, phantoms_position FROM tracker_columns WHERE tenant_id = ?1 AND stream = ?2 AND deleted_at IS NULL ORDER BY position",
    ).bind(tenantId, stream),
    env.DB.prepare("SELECT column_key, value, parent, position FROM column_options WHERE tenant_id = ?1 AND stream = ?2 ORDER BY position, value").bind(tenantId, stream),
  ]);
  const options = (opts?.results ?? []) as unknown as OptionRow[];
  const columns: TrackerColumn[] = ((cols?.results ?? []) as unknown as ColumnRow[]).map((c) => {
    const col: TrackerColumn = {
      key: c.key,
      label: c.label,
      type: c.type,
      core: !!c.core,
      required: !!c.required,
      position: c.position,
      aiAssist: !!c.ai_assist,
      inTracker: !!c.in_tracker,
      trackerPosition: c.tracker_position,
      inPhantoms: !!c.in_phantoms,
      phantomsPosition: c.phantoms_position,
    };
    if (c.type === "select" || c.type === "multi") col.options = options.filter((o) => o.column_key === c.key).map((o) => o.value);
    return col;
  });
  const macros = options.filter((o) => o.column_key === CORE.macrotrend);
  const subs = options.filter((o) => o.column_key === CORE.subtrend);
  const revision = ((meta?.results ?? [])[0] as { revision?: number } | undefined)?.revision ?? 1;
  return {
    revision,
    columns,
    taxonomy: macros.map((m) => ({ name: m.value, subtrends: subs.filter((s) => s.parent === m.value).map((s) => s.value) })),
  };
}

export type Schemas = Record<Stream, TrackerSchema>;

/** Both streams' column sets (items of either stream are read with their own). */
export async function loadSchemas(env: Env, tenantId: string): Promise<Schemas> {
  const [primary, secondary] = await Promise.all([loadSchema(env, tenantId, "primary"), loadSchema(env, tenantId, "secondary")]);
  return { primary, secondary };
}

export const DEFAULT_SETTINGS: TenantSettings = {
  timezone: "Europe/London",
  trendDefaults: DEFAULT_TREND_THRESHOLDS,
  retention: { snapshotDays: 730, rejectedDays: 90, deletedDays: 30 },
  redaction: { redactEmails: true, redactPhones: true, quarantineMarkers: [] },
  phantoms: { secondaryMinImpact: "Low" },
  navOrder: [...DEFAULT_NAV_ORDER],
  megatrends: { summaryDays: 90, summarySentences: 2, model: "claude-opus-5-5", perspective: "AbbVie" },
};

export async function loadSettings(env: Env, tenantId: string): Promise<TenantSettings> {
  const row = await env.DB.prepare("SELECT settings_json FROM tenant_settings WHERE tenant_id = ?1").bind(tenantId).first<{ settings_json: string }>();
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const s = JSON.parse(row.settings_json) as Partial<TenantSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    trendDefaults: { ...DEFAULT_SETTINGS.trendDefaults, ...s.trendDefaults },
    retention: { ...DEFAULT_SETTINGS.retention, ...s.retention },
    redaction: { ...DEFAULT_SETTINGS.redaction, ...s.redaction },
    phantoms: { ...DEFAULT_SETTINGS.phantoms, ...s.phantoms },
    navOrder: normaliseNavOrder(s.navOrder),
    megatrends: { ...DEFAULT_SETTINGS.megatrends, ...s.megatrends },
  };
}

export async function saveSettings(env: Env, tenantId: string, settings: TenantSettings, userId: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tenant_settings (tenant_id, settings_json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (tenant_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  )
    .bind(tenantId, JSON.stringify(settings), nowIso(), userId)
    .run();
}

/** Statements that create a tenant with the default schema, taxonomy and settings. */
export function tenantBootstrapStatements(env: Env, tenant: { id: string; name: string; slug: string }): D1PreparedStatement[] {
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO tenants (id, name, slug, created_at) VALUES (?1, ?2, ?3, ?4)").bind(tenant.id, tenant.name, tenant.slug, now),
    env.DB.prepare("INSERT INTO schema_meta (tenant_id, revision) VALUES (?1, 1)").bind(tenant.id),
    env.DB.prepare("INSERT INTO tenant_settings (tenant_id, settings_json, updated_at) VALUES (?1, ?2, ?3)").bind(tenant.id, JSON.stringify(DEFAULT_SETTINGS), now),
    env.DB.prepare("INSERT INTO counters (tenant_id, name, value) VALUES (?1, 'inbox', 2200), (?1, 'signal', 1100)").bind(tenant.id),
  ];
  for (const stream of STREAMS) {
    const s = defaultSchema(stream);
    for (const c of s.columns) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position, tracker_position, in_phantoms, phantoms_position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        ).bind(tenant.id, stream, c.key, c.label, c.type, c.core ? 1 : 0, c.required ? 1 : 0, c.aiAssist ? 1 : 0, c.inTracker ? 1 : 0, c.position, c.trackerPosition, c.inPhantoms ? 1 : 0, c.phantomsPosition),
      );
      (c.options ?? []).forEach((o, i) => stmts.push(optionInsert(env, tenant.id, stream, c.key, o, null, i)));
    }
    s.taxonomy.forEach((g, i) => {
      stmts.push(optionInsert(env, tenant.id, stream, CORE.macrotrend, g.name, null, i));
      g.subtrends.forEach((sub, j) => stmts.push(optionInsert(env, tenant.id, stream, CORE.subtrend, sub, g.name, j)));
    });
  }
  return stmts;
}

function optionInsert(env: Env, tenantId: string, stream: Stream, key: string, value: string, parent: string | null, position: number) {
  return env.DB.prepare("INSERT INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(
    newId("opt"),
    tenantId,
    stream,
    key,
    value,
    parent,
    position,
    nowIso(),
  );
}

function bump(env: Env, tenantId: string) {
  return env.DB.prepare("UPDATE schema_meta SET revision = revision + 1 WHERE tenant_id = ?1").bind(tenantId);
}

function requireColumn(schema: TrackerSchema, key: string): TrackerColumn {
  const c = getColumn(schema, key);
  if (!c) throw notFound("Column");
  return c;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export async function addColumn(env: Env, tenantId: string, stream: Stream, label: string, type: CreatableColumnType): Promise<{ key: string; label: string }> {
  const schema = await loadSchema(env, tenantId, stream);
  const chk = checkColumnLabel(schema, label);
  if (!chk.ok) throw new ApiError("CONFLICT", chk.error);
  const slug = chk.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "col";
  const key = `x_${slug}_${Math.random().toString(36).slice(2, 7)}`;
  const position = Math.max(-1, ...schema.columns.map((c) => c.position)) + 1;
  // A new column is an Inbox column only; add it to the Tracker or Phantoms table separately.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position, tracker_position, in_phantoms, phantoms_position) VALUES (?1, ?6, ?2, ?3, ?4, 0, 0, 1, 0, ?5, ?5, 0, ?5)",
    ).bind(tenantId, key, chk.value, type, position, stream),
    bump(env, tenantId),
  ]);
  return { key, label: chk.value };
}

export async function updateColumn(
  env: Env,
  tenantId: string,
  stream: Stream,
  key: string,
  patch: { label?: string; required?: boolean; inTracker?: boolean; inPhantoms?: boolean; type?: "text" | "long" },
) {
  const schema = await loadSchema(env, tenantId, stream);
  const col = requireColumn(schema, key);
  const stmts: D1PreparedStatement[] = [];
  // Text ⇄ Long text: the only type change allowed (same values, a different box and limit).
  const type = patch.type ?? col.type;
  if (patch.type && patch.type !== col.type) {
    if (col.type !== "text" && col.type !== "long") throw new ApiError("CONFLICT", `${col.label} is a ${TYPE_LABEL[col.type]} column: only Text and Long text columns can switch type`);
    if (patch.type === "text") await assertFitsShortText(env, tenantId, stream, col);
  }
  let label = col.label;
  if (patch.label !== undefined) {
    const chk = checkColumnLabel(schema, patch.label, key);
    if (!chk.ok) throw new ApiError("CONFLICT", chk.error);
    label = chk.value;
  }
  // Added to a table → placed at the end of that table.
  const end = (t: TableName) => Math.max(-1, ...tableColumns(schema, t).map((c) => (t === "tracker" ? c.trackerPosition : c.phantomsPosition))) + 1;
  const trackerPosition = patch.inTracker && !col.inTracker ? end("tracker") : col.trackerPosition;
  const phantomsPosition = patch.inPhantoms && !col.inPhantoms ? end("phantoms") : col.phantomsPosition;
  stmts.push(
    env.DB.prepare(
      "UPDATE tracker_columns SET label = ?1, required = ?2, in_tracker = ?5, tracker_position = ?7, in_phantoms = ?8, phantoms_position = ?9, type = ?10 WHERE tenant_id = ?3 AND key = ?4 AND stream = ?6",
    ).bind(
      label,
      (patch.required ?? col.required) ? 1 : 0,
      tenantId,
      key,
      (patch.inTracker ?? col.inTracker) ? 1 : 0,
      stream,
      trackerPosition,
      (patch.inPhantoms ?? col.inPhantoms) ? 1 : 0,
      phantomsPosition,
      type,
    ),
    bump(env, tenantId),
  );
  await env.DB.batch(stmts);
  return {
    before: { label: col.label, required: col.required, inTracker: col.inTracker, inPhantoms: col.inPhantoms, type: col.type },
    after: { label, required: patch.required ?? col.required, inTracker: patch.inTracker ?? col.inTracker, inPhantoms: patch.inPhantoms ?? col.inPhantoms, type },
  };
}

/** Long text → Text only when no entry (draft or published) is longer than Text allows. */
async function assertFitsShortText(env: Env, tenantId: string, stream: Stream, col: TrackerColumn): Promise<void> {
  const published = PHYSICAL[col.key] ?? `json_extract(extra_json, '${jsonPath(col.key)}')`;
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM intelligence_items WHERE tenant_id = ?1 AND stream = ?2 AND status != 'deleted'
        AND (length(json_extract(draft_json, ?3)) > ?4 OR length(${published}) > ?4)`,
  )
    .bind(tenantId, stream, jsonPath(col.key), MAX_TEXT_LENGTH)
    .first<{ n: number }>();
  const n = r?.n ?? 0;
  if (n) throw new ApiError("CONFLICT", `${n} entr${n === 1 ? "y has" : "ies have"} more than ${MAX_TEXT_LENGTH} characters in ${col.label}, so it must stay Long text`);
}

/**
 * Set the order of a table's columns at once: the Inbox (every column), or
 * the Tracker / Phantoms table (its columns only). `keys` must list each of
 * that table's current columns exactly once.
 */
export async function reorderColumns(env: Env, tenantId: string, stream: Stream, keys: string[], table: "inbox" | TableName = "inbox"): Promise<void> {
  const schema = await loadSchema(env, tenantId, stream);
  const current = new Set((table === "inbox" ? schema.columns : tableColumns(schema, table)).map((c) => c.key));
  if (keys.length !== current.size || new Set(keys).size !== keys.length || !keys.every((k) => current.has(k))) {
    throw new ApiError("CONFLICT", "The columns changed while you were reordering them. Reload and try again.");
  }
  const col = table === "inbox" ? "position" : table === "tracker" ? "tracker_position" : "phantoms_position";
  await env.DB.batch([
    ...keys.map((k, i) => env.DB.prepare(`UPDATE tracker_columns SET ${col} = ?1 WHERE tenant_id = ?2 AND key = ?3 AND stream = ?4 AND deleted_at IS NULL`).bind(i, tenantId, k, stream)),
    bump(env, tenantId),
  ]);
}

export async function deleteColumn(env: Env, tenantId: string, stream: Stream, key: string) {
  const schema = await loadSchema(env, tenantId, stream);
  const col = requireColumn(schema, key);
  if (col.core) throw new ApiError("CONFLICT", `“${col.label}” is used by the Dashboard charts or the Phantoms Markdown, so it can be renamed but not deleted`);
  await env.DB.batch([
    env.DB.prepare("UPDATE tracker_columns SET deleted_at = ?1 WHERE tenant_id = ?2 AND key = ?3 AND stream = ?4").bind(nowIso(), tenantId, key, stream),
    env.DB.prepare("DELETE FROM column_options WHERE tenant_id = ?1 AND column_key = ?2 AND stream = ?3").bind(tenantId, key, stream),
    bump(env, tenantId),
  ]);
  return col;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Number of published signals using an option. */
export async function optionUsage(env: Env, tenantId: string, stream: Stream, col: TrackerColumn, value: string): Promise<number> {
  let sql: string;
  let binds: unknown[];
  if (col.type === "multi") {
    sql = "SELECT COUNT(*) AS n FROM item_competitors c JOIN intelligence_items i ON i.id = c.item_id WHERE c.tenant_id = ?1 AND c.competitor = ?2 AND i.status = 'approved' AND i.stream = ?3";
    binds = [tenantId, value, stream];
  } else if (PHYSICAL[col.key]) {
    sql = `SELECT COUNT(*) AS n FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved' AND stream = ?3 AND ${PHYSICAL[col.key]} = ?2`;
    binds = [tenantId, value, stream];
  } else {
    sql = "SELECT COUNT(*) AS n FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved' AND stream = ?4 AND json_extract(extra_json, ?3) = ?2";
    binds = [tenantId, value, jsonPath(col.key), stream];
  }
  const r = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function optionUsageMap(env: Env, tenantId: string, stream: Stream, schema: TrackerSchema): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  const stmts: D1PreparedStatement[] = [];
  const keys: string[] = [];
  for (const col of schema.columns) {
    if (col.type === "multi") {
      stmts.push(
        env.DB.prepare(
          "SELECT c.competitor AS v, COUNT(*) AS n FROM item_competitors c JOIN intelligence_items i ON i.id = c.item_id WHERE c.tenant_id = ?1 AND i.status = 'approved' AND i.stream = ?2 GROUP BY c.competitor",
        ).bind(tenantId, stream),
      );
    } else if (PHYSICAL[col.key] && (col.type === "select" || col.type === "macro" || col.type === "sub")) {
      stmts.push(env.DB.prepare(`SELECT ${PHYSICAL[col.key]} AS v, COUNT(*) AS n FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved' AND stream = ?2 GROUP BY 1`).bind(tenantId, stream));
    } else if (col.type === "select") {
      stmts.push(
        env.DB.prepare("SELECT json_extract(extra_json, ?2) AS v, COUNT(*) AS n FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved' AND stream = ?3 GROUP BY 1").bind(
          tenantId,
          jsonPath(col.key),
          stream,
        ),
      );
    } else continue;
    keys.push(col.key);
  }
  const results = stmts.length ? await env.DB.batch(stmts) : [];
  results.forEach((r, i) => {
    const m: Record<string, number> = {};
    for (const row of (r.results ?? []) as { v: string | null; n: number }[]) if (row.v != null) m[row.v] = row.n;
    out[keys[i] as string] = m;
  });
  return out;
}

export async function addOption(env: Env, tenantId: string, stream: Stream, key: string, value: string, parent?: string) {
  const schema = await loadSchema(env, tenantId, stream);
  const col = requireColumn(schema, key);
  if (!(col.type === "select" || col.type === "multi" || col.type === "macro" || col.type === "sub")) throw badRequest(`“${col.label}” has no dropdown options`);
  const chk = checkOptionName(schema, col, value);
  if (!chk.ok) throw new ApiError("CONFLICT", chk.error);
  let parentValue: string | null = null;
  let position: number;
  if (col.type === "sub") {
    if (!parent || !schema.taxonomy.some((g) => g.name === parent)) throw badRequest("Choose the macrotrend this subtrend belongs to");
    parentValue = parent;
    position = schema.taxonomy.find((g) => g.name === parent)?.subtrends.length ?? 0;
  } else if (col.type === "macro") {
    position = schema.taxonomy.length;
  } else {
    position = col.options?.length ?? 0;
  }
  await env.DB.batch([optionInsert(env, tenantId, stream, key, chk.value, parentValue, position), bump(env, tenantId)]);
  return chk.value;
}

/**
 * Set the order of a column's options. `values` must list every current option
 * exactly once (for Subtrend: every subtrend of `parent`). Order is meaningful:
 * it is the order shown in every dropdown, and for Growth intensity and Impact
 * it is also the level (first = lowest) used by the charts and the Trend Test.
 */
export async function reorderOptions(env: Env, tenantId: string, stream: Stream, key: string, values: string[], parent?: string): Promise<void> {
  const schema = await loadSchema(env, tenantId, stream);
  const col = requireColumn(schema, key);
  if (!hasOptions(col)) throw badRequest(`“${col.label}” has no dropdown options`);
  let current: string[];
  if (col.type === "sub") {
    const g = schema.taxonomy.find((x) => x.name === parent);
    if (!g) throw badRequest("Choose the macrotrend whose subtrends you are reordering");
    current = g.subtrends;
  } else current = col.type === "macro" ? schema.taxonomy.map((g) => g.name) : (col.options ?? []);
  const cur = new Set(current);
  if (values.length !== cur.size || new Set(values).size !== values.length || !values.every((v) => cur.has(v))) {
    throw new ApiError("CONFLICT", "The options changed while you were reordering them. Reload and try again.");
  }
  await env.DB.batch([
    ...values.map((v, i) => env.DB.prepare("UPDATE column_options SET position = ?1 WHERE tenant_id = ?2 AND column_key = ?3 AND value = ?4 AND stream = ?5").bind(i, tenantId, key, v, stream)),
    bump(env, tenantId),
  ]);
}

/**
 * A renamed Macrotrend / Subtrend keeps its Megatrends summary (stored, else
 * the default text). The old name keeps its own too: the other tracker may
 * still use it.
 */
function summaryRename(env: Env, tenantId: string, type: string, from: string, to: string): D1PreparedStatement[] {
  const level: TrendLevel | null = type === "macro" ? "macro" : type === "sub" ? "sub" : null;
  if (!level) return [];
  const stmts = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO trend_summaries (tenant_id, level, name, parent, text, source, model, window_days, entries, updated_by, updated_at)
       SELECT tenant_id, level, ?4, parent, text, source, model, window_days, entries, updated_by, updated_at FROM trend_summaries WHERE tenant_id = ?1 AND level = ?2 AND name = ?3`,
    ).bind(tenantId, level, from, to),
  ];
  const text = defaultSummary(level, from);
  if (text) {
    stmts.push(
      env.DB.prepare("INSERT OR IGNORE INTO trend_summaries (tenant_id, level, name, text, source, updated_at) VALUES (?1, ?2, ?3, ?4, 'manual', ?5)").bind(tenantId, level, to, text, nowIso()),
    );
  }
  return stmts;
}

export async function renameOption(env: Env, tenantId: string, stream: Stream, key: string, from: string, to: string) {
  const schema = await loadSchema(env, tenantId, stream);
  const col = requireColumn(schema, key);
  const current = col.type === "macro" ? schema.taxonomy.map((g) => g.name) : col.type === "sub" ? schema.taxonomy.flatMap((g) => g.subtrends) : (col.options ?? []);
  if (!current.includes(from)) throw notFound("Option");
  const chk = checkOptionName(schema, col, to, from);
  if (!chk.ok) throw new ApiError("CONFLICT", chk.error);
  const v = chk.value;
  if (v === from) return v;
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("UPDATE column_options SET value = ?1 WHERE tenant_id = ?2 AND column_key = ?3 AND value = ?4 AND stream = ?5").bind(v, tenantId, key, from, stream),
    bump(env, tenantId),
    ...summaryRename(env, tenantId, col.type, from, v),
  ];
  if (col.type === "macro") {
    stmts.push(env.DB.prepare("UPDATE column_options SET parent = ?1 WHERE tenant_id = ?2 AND column_key = ?3 AND parent = ?4 AND stream = ?5").bind(v, tenantId, CORE.subtrend, from, stream));
  }
  // Phantoms keep their content, but take the new name of an option.
  if (col.type === "multi" || col.type === "select" || col.type === "macro" || col.type === "sub") {
    stmts.push(renamePhantomOption(env, tenantId, stream, col.type === "multi" ? { multi: true } : PHYSICAL[key] ? { physical: PHYSICAL[key] } : { extraPath: jsonPath(key) }, from, v));
  }
  // Published signals (of this stream only: the other stream has its own options).
  if (col.type === "multi") {
    stmts.push(
      env.DB.prepare(
        "UPDATE item_competitors SET competitor = ?1 WHERE tenant_id = ?2 AND competitor = ?3 AND item_id IN (SELECT id FROM intelligence_items WHERE tenant_id = ?2 AND stream = ?4)",
      ).bind(v, tenantId, from, stream),
    );
  } else if (PHYSICAL[key]) {
    stmts.push(
      env.DB.prepare(`UPDATE intelligence_items SET ${PHYSICAL[key]} = ?1, updated_at = ?4 WHERE tenant_id = ?2 AND stream = ?5 AND ${PHYSICAL[key]} = ?3`).bind(v, tenantId, from, now, stream),
    );
  } else {
    stmts.push(
      env.DB.prepare(
        "UPDATE intelligence_items SET extra_json = json_set(extra_json, ?1, ?2), updated_at = ?5 WHERE tenant_id = ?3 AND stream = ?6 AND json_extract(extra_json, ?1) = ?4",
      ).bind(jsonPath(key), v, tenantId, from, now, stream),
    );
  }
  // Drafts (single-valued): rewrite in SQL.
  if (col.type !== "multi") {
    stmts.push(
      env.DB.prepare(
        "UPDATE intelligence_items SET draft_json = json_set(draft_json, ?1, ?2), updated_at = ?5 WHERE tenant_id = ?3 AND stream = ?6 AND json_extract(draft_json, ?1) = ?4",
      ).bind(jsonPath(key), v, tenantId, from, now, stream),
    );
  }
  await env.DB.batch(stmts);
  // Drafts (multi-valued): rewrite arrays in code.
  if (col.type === "multi") {
    const rows = await env.DB.prepare(
      "SELECT id, draft_json FROM intelligence_items WHERE tenant_id = ?1 AND stream = ?4 AND EXISTS (SELECT 1 FROM json_each(draft_json, ?2) WHERE value = ?3)",
    )
      .bind(tenantId, jsonPath(key), from, stream)
      .all<{ id: string; draft_json: string }>();
    const upd = (rows.results ?? []).map((r) => {
      const d = JSON.parse(r.draft_json) as Record<string, unknown>;
      d[key] = splitMulti(d[key] as string[]).map((x) => (x === from ? v : x));
      return env.DB.prepare("UPDATE intelligence_items SET draft_json = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4").bind(JSON.stringify(d), now, r.id, tenantId);
    });
    if (upd.length) await env.DB.batch(upd);
  }
  // Keep the Phantoms threshold pointing at the renamed Secondary Impact option.
  if (stream === "secondary" && key === CORE.impact) {
    const settings = await loadSettings(env, tenantId);
    if (settings.phantoms.secondaryMinImpact === from) await saveSettings(env, tenantId, { ...settings, phantoms: { secondaryMinImpact: v } }, null);
  }
  return v;
}

export async function deleteOption(env: Env, tenantId: string, stream: Stream, key: string, value: string) {
  const schema = await loadSchema(env, tenantId, stream);
  const col = requireColumn(schema, key);
  if (value === ALL) throw badRequest("“All” is not a stored option");
  const now = nowIso();
  if (col.type === "macro") {
    const subs = schema.taxonomy.find((g) => g.name === value)?.subtrends;
    if (!subs) throw notFound("Macrotrend");
    const used = await optionUsage(env, tenantId, stream, col, value);
    if (used > 0) throw new ApiError("CONFLICT", `In use by ${used} published signal${used === 1 ? "" : "s"} · reassign them first`);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM column_options WHERE tenant_id = ?1 AND stream = ?5 AND ((column_key = ?2 AND value = ?3) OR (column_key = ?4 AND parent = ?3))").bind(
        tenantId,
        CORE.macrotrend,
        value,
        CORE.subtrend,
        stream,
      ),
      env.DB.prepare(
        "UPDATE intelligence_items SET draft_json = json_set(draft_json, ?1, NULL, ?2, NULL), updated_at = ?5 WHERE tenant_id = ?3 AND stream = ?6 AND status <> 'approved' AND json_extract(draft_json, ?1) = ?4",
      ).bind(jsonPath(CORE.macrotrend), jsonPath(CORE.subtrend), tenantId, value, now, stream),
      bump(env, tenantId),
    ]);
    return;
  }
  const exists =
    col.type === "sub" ? schema.taxonomy.some((g) => g.subtrends.includes(value)) : (col.options ?? []).includes(value);
  if (!exists) throw notFound("Option");
  const used = await optionUsage(env, tenantId, stream, col, value);
  if (used > 0) throw new ApiError("CONFLICT", `In use by ${used} published signal${used === 1 ? "" : "s"} · reassign them first`);
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM column_options WHERE tenant_id = ?1 AND column_key = ?2 AND value = ?3 AND stream = ?4").bind(tenantId, key, value, stream),
    bump(env, tenantId),
  ];
  if (col.type !== "multi") {
    stmts.push(
      env.DB.prepare(
        "UPDATE intelligence_items SET draft_json = json_set(draft_json, ?1, NULL), updated_at = ?4 WHERE tenant_id = ?2 AND stream = ?5 AND status <> 'approved' AND json_extract(draft_json, ?1) = ?3",
      ).bind(jsonPath(key), tenantId, value, now, stream),
    );
  }
  await env.DB.batch(stmts);
  if (col.type === "multi") {
    const rows = await env.DB.prepare(
      "SELECT id, draft_json FROM intelligence_items WHERE tenant_id = ?1 AND stream = ?4 AND status <> 'approved' AND EXISTS (SELECT 1 FROM json_each(draft_json, ?2) WHERE value = ?3)",
    )
      .bind(tenantId, jsonPath(key), value, stream)
      .all<{ id: string; draft_json: string }>();
    const upd = (rows.results ?? []).map((r) => {
      const d = JSON.parse(r.draft_json) as Record<string, unknown>;
      const list = splitMulti(d[key] as string[]).filter((x) => x !== value);
      d[key] = list.length ? list : null;
      return env.DB.prepare("UPDATE intelligence_items SET draft_json = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4").bind(JSON.stringify(d), now, r.id, tenantId);
    });
    if (upd.length) await env.DB.batch(upd);
  }
}
