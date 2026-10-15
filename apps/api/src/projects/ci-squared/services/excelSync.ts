/**
 * Request 55: the Test tab's test space, kept in step with the SharePoint
 * workbook.
 *
 * A workspace's test space is a workspace of its own (a row in tenants that
 * nobody is a member of), so every page and endpoint works on it unchanged:
 * admins' requests that carry `x-eradigm-space: test` are answered from it
 * (app.ts). It starts with a copy of the live workspace's columns, dropdown
 * options and settings (copied again at the start of every sync), and holds
 * only what the workbook says:
 *
 *   - Primary / Secondary: one Tracker entry per row, matched by its ID. A new
 *     row is published (as the spreadsheet import does), a changed row edits
 *     its entry (its Phantom, Markdown and alert follow: in the test space they
 *     show the workbook as it is now), a removed row deletes its entry.
 *   - Competitor Trend Analysis: each competitor's Company Profile.
 *   - Macrotrend Analysis: each Macrotrend's sections.
 *
 * The workbook is the master: whatever it no longer has goes. Rows with a
 * problem (an unknown dropdown value, a missing required field…) are left
 * out and listed with the reason; the rest are applied.
 *
 * A run checks the file's version (one Graph call) and reads it only when it
 * changed (or when asked to). The Workers Free plan allows 50 database
 * queries per run, so a large change is applied a few rows at a time over
 * several runs (the every-minute cron, or Sync now calling again while `more`).
 */
import {
  COMPETITOR_COLUMNS,
  EXCEL_SHEETS,
  EXCEL_WORKBOOK_NAME,
  FIELDS,
  MACROTREND_COLUMNS,
  MACRO_SECTION_KEYS,
  columnIs,
  normaliseValues,
  sheetKindOf,
  type ExcelIssue,
  type ExcelSheetKind,
  type ExcelSyncStatus,
  type Grid,
  type ItemValues,
  type MacroSectionKey,
  type Stream,
} from "@eradigm/shared";
import type { Principal } from "../../../auth/context.js";
import type { Env } from "../../../env.js";
import { bumpDataVersion } from "../../../lib/cache.js";
import { sha256Hex } from "../../../lib/crypto.js";
import { newId, nowIso } from "../../../lib/ids.js";
import { log } from "../../../lib/log.js";
import { audit } from "../../../services/audit.js";
import { insertRows, prepareRows, type PreparedRow } from "./imports.js";
import { snapshotPhantom } from "./phantoms.js";
import { revise } from "./review.js";
import { loadSchemas, type Schemas } from "./schema.js";
import { GraphError, downloadWorkbook, headerRow, missingSecrets, readWorkbook, workbookFile, type WorkbookFile } from "../../../services/sharepoint.js";
import { joined, knownNames, resolve, sectionUpsert, store } from "./trendAnalyses.js";

interface SyncRow {
  tenant_id: string;
  test_tenant_id: string;
  created_by: string | null;
  status: ExcelSyncStatus["status"];
  message: string | null;
  version: string | null;
  pending_version: string | null;
  file_name: string | null;
  file_url: string | null;
  file_modified_at: string | null;
  file_modified_by: string | null;
  last_checked_at: string | null;
  last_synced_at: string | null;
  last_change_at: string | null;
  lock_until: string | null;
  report_json: string | null;
}

type Report = Pick<ExcelSyncStatus, "sheets" | "issues" | "counts" | "problem" | "applied" | "more">;
const EMPTY_APPLIED = { created: 0, updated: 0, deleted: 0, trends: 0 };
const EMPTY_REPORT: Report = { sheets: [], issues: [], counts: null, problem: null, applied: EMPTY_APPLIED, more: false };

/** At most this many issues are kept (the first ones, by sheet and row). */
const MAX_ISSUES = 200;
/** One run at a time: a run that dies leaves the lock, which lapses after this long. */
const LOCK_MS = 90_000;
/**
 * Database statements one run may spend on changes. The Workers Free plan
 * allows 50 queries per invocation (each statement of a batch counts); a run
 * spends about 25 on reading the workbook's targets, copying the columns and
 * the status, so changes get the rest, with room to spare.
 */
const BUDGET = 20;
const COST = { create: 4, createChunk: 4, update: 14, deleteAll: 2, trend: 2 };
const MAX_CREATES = 4;

// ---------------------------------------------------------------------------
// The test space
// ---------------------------------------------------------------------------

/** Live workspace → its test space (kept for this isolate). */
const spaces = new Map<string, string>();

/**
 * The statements that make the test space's columns, dropdown options and
 * settings the live workspace's (its entries and analyses are left alone).
 */
function copyConfig(env: Env, live: string, test: string): D1PreparedStatement[] {
  const now = nowIso();
  return [
    env.DB.prepare(
      `INSERT INTO tenant_settings (tenant_id, settings_json, updated_at, updated_by) SELECT ?2, settings_json, ?3, NULL FROM tenant_settings WHERE tenant_id = ?1
       ON CONFLICT (tenant_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
    ).bind(live, test, now),
    env.DB.prepare("DELETE FROM tracker_columns WHERE tenant_id = ?1").bind(test),
    env.DB.prepare(
      `INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position, deleted_at, tracker_position, in_phantoms, phantoms_position)
       SELECT ?2, stream, key, label, type, core, required, ai_assist, in_tracker, position, deleted_at, tracker_position, in_phantoms, phantoms_position FROM tracker_columns WHERE tenant_id = ?1`,
    ).bind(live, test),
    env.DB.prepare("DELETE FROM column_options WHERE tenant_id = ?1").bind(test),
    env.DB.prepare(
      `INSERT INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
       SELECT 'opt_' || lower(hex(randomblob(10))), ?2, stream, column_key, value, parent, position, created_at FROM column_options WHERE tenant_id = ?1`,
    ).bind(live, test),
    env.DB.prepare("UPDATE schema_meta SET revision = revision + 1 WHERE tenant_id = ?1").bind(test),
  ];
}

/** The live workspace's test space, if it has one. */
export async function testSpaceOf(env: Env, live: string): Promise<string | null> {
  const have = spaces.get(live);
  if (have) return have;
  const r = await env.DB.prepare("SELECT test_tenant_id FROM excel_sync WHERE tenant_id = ?1").bind(live).first<{ test_tenant_id: string }>();
  if (r) spaces.set(live, r.test_tenant_id);
  return r?.test_tenant_id ?? null;
}

/** The live workspace's test space, made (with a copy of its columns, options and settings) the first time. */
export async function ensureTestSpace(env: Env, live: { id: string; name: string }, userId: string | null): Promise<string> {
  const have = await testSpaceOf(env, live.id);
  if (have) return have;
  const t = await env.DB.prepare("SELECT slug FROM tenants WHERE id = ?1").bind(live.id).first<{ slug: string }>();
  const test = `${live.id}-test`;
  const now = nowIso();
  await env.DB.batch([
    // kind 'test' (request 61): never listed as a project of its own.
    env.DB.prepare("INSERT OR IGNORE INTO tenants (id, name, slug, created_at, kind) VALUES (?1, ?2, ?3, ?4, 'test')").bind(test, `${live.name} · Test`, `${t?.slug ?? live.id}-test`, now),
    env.DB.prepare("INSERT OR IGNORE INTO schema_meta (tenant_id, revision) VALUES (?1, 1)").bind(test),
    env.DB.prepare("INSERT OR IGNORE INTO counters (tenant_id, name, value) VALUES (?1, 'inbox', 2200), (?1, 'signal', 1100)").bind(test),
    env.DB.prepare("INSERT OR IGNORE INTO excel_sync (tenant_id, test_tenant_id, created_by, created_at) VALUES (?1, ?2, ?3, ?4)").bind(live.id, test, userId, now),
    ...copyConfig(env, live.id, test),
  ]);
  spaces.set(live.id, test);
  await audit(env, { tenantId: live.id, actorId: userId, actorEmail: null, action: "test_space.created", targetType: "tenant", targetId: test, details: {} });
  return test;
}

/** The test space as an admin acting in it (the run's writes are theirs: whoever pressed Sync now, else whoever made the test space). */
async function actorIn(env: Env, test: string, row: SyncRow, actor: Pick<Principal, "userId" | "email" | "name"> | null): Promise<Principal> {
  let who = actor;
  if (!who) {
    const u = row.created_by
      ? await env.DB.prepare("SELECT id, email, name FROM users WHERE id = ?1").bind(row.created_by).first<{ id: string; email: string; name: string }>()
      : await env.DB.prepare("SELECT u.id, u.email, u.name FROM users u JOIN role_assignments r ON r.user_id = u.id AND r.role = 'admin' AND r.revoked_at IS NULL WHERE r.tenant_id = ?1 LIMIT 1")
          .bind(row.tenant_id)
          .first<{ id: string; email: string; name: string }>();
    who = u ? { userId: u.id, email: u.email, name: u.name } : { userId: "", email: "excel-sync", name: "Excel sync" };
  }
  return { userId: who.userId, email: who.email, name: who.name, tenantId: test, tenantName: "Test", role: "admin", tenants: [], space: "test", liveTenantId: row.tenant_id };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

async function syncRow(env: Env, live: string): Promise<SyncRow | null> {
  return env.DB.prepare("SELECT * FROM excel_sync WHERE tenant_id = ?1").bind(live).first<SyncRow>();
}

function statusOf(env: Env, row: SyncRow | null): ExcelSyncStatus {
  const missing = missingSecrets(env);
  const report: Report = row?.report_json ? { ...EMPTY_REPORT, ...(JSON.parse(row.report_json) as Partial<Report>) } : EMPTY_REPORT;
  return {
    configured: missing.length === 0,
    missing,
    linked: !!row,
    status: row?.status ?? "never",
    message: row?.message ?? null,
    problem: report.problem,
    file: row?.file_name ? { name: row.file_name, url: row.file_url, modifiedAt: row.file_modified_at, modifiedBy: row.file_modified_by } : null,
    lastCheckedAt: row?.last_checked_at ?? null,
    lastSyncedAt: row?.last_synced_at ?? null,
    lastChangeAt: row?.last_change_at ?? null,
    more: report.more,
    applied: report.applied,
    sheets: report.sheets,
    issues: report.issues,
    counts: report.counts,
  };
}

export async function excelStatus(env: Env, live: string): Promise<ExcelSyncStatus> {
  return statusOf(env, await syncRow(env, live));
}

async function countsIn(env: Env, test: string): Promise<NonNullable<ExcelSyncStatus["counts"]>> {
  const [items, comps, macros] = await env.DB.batch([
    env.DB.prepare("SELECT stream, COUNT(*) AS n FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved' GROUP BY stream").bind(test),
    env.DB.prepare("SELECT COUNT(*) AS n FROM trend_summaries WHERE tenant_id = ?1 AND level = 'competitor'").bind(test),
    env.DB.prepare("SELECT COUNT(DISTINCT macrotrend) AS n FROM macrotrend_sections WHERE tenant_id = ?1").bind(test),
  ]);
  const by = new Map(((items?.results ?? []) as { stream: Stream; n: number }[]).map((r) => [r.stream, r.n]));
  return {
    primary: by.get("primary") ?? 0,
    secondary: by.get("secondary") ?? 0,
    competitors: ((comps?.results ?? [])[0] as { n?: number } | undefined)?.n ?? 0,
    macrotrends: ((macros?.results ?? [])[0] as { n?: number } | undefined)?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Reading the workbook
// ---------------------------------------------------------------------------

interface Sheet {
  name: string;
  kind: ExcelSheetKind;
  columns: string[];
  rows: { row: number; cells: string[] }[];
}

/** A sheet's columns (its first row with text) and its rows with any text, by Excel row number. */
function sheetOf(name: string, kind: ExcelSheetKind, grid: Grid): Sheet {
  const h = headerRow(grid);
  const rows: Sheet["rows"] = [];
  if (h.at >= 0) for (let i = h.at + 1; i < grid.length; i++) if ((grid[i] ?? []).some((v) => v?.trim())) rows.push({ row: i + 1, cells: grid[i] ?? [] });
  return { name, kind, columns: h.columns, rows };
}

/** The four sheets the workbook should have (by name), and the sheets it has besides. */
function sortSheets(book: { name: string; grid: Grid }[], issues: ExcelIssue[]): { sheets: Partial<Record<ExcelSheetKind, Sheet>>; report: ExcelSyncStatus["sheets"] } {
  const sheets: Partial<Record<ExcelSheetKind, Sheet>> = {};
  const report: ExcelSyncStatus["sheets"] = [];
  for (const s of book) {
    const kind = sheetKindOf(s.name);
    if (!kind || sheets[kind]) {
      if (kind) issues.push({ sheet: s.name, row: null, column: null, message: `Another sheet is already read as “${EXCEL_SHEETS[kind]}”: this one is left out.` });
      const h = headerRow(s.grid);
      report.push({ name: s.name, kind: "ignored", rows: Math.max(0, s.grid.length - h.at - 1), columns: [], ignored: h.columns });
      continue;
    }
    sheets[kind] = sheetOf(s.name, kind, s.grid);
  }
  for (const k of ["primary", "secondary", "competitor", "macrotrend"] as const)
    if (!sheets[k]) issues.push({ sheet: EXCEL_SHEETS[k], row: null, column: null, message: `The workbook has no sheet named “${EXCEL_SHEETS[k]}”, so ${k === "primary" || k === "secondary" ? `the ${EXCEL_SHEETS[k]} Tracker` : k === "competitor" ? "the Company Profiles" : "the Macrotrend sections"} are left as they are.` });
  return { sheets, report };
}

const blank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const flat = (v: unknown) => (blank(v) ? "" : Array.isArray(v) ? v.map((x) => String(x).trim()).join("\u0001") : String(v).trim());

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------

interface Existing {
  id: string;
  stream: Stream;
  key: string;
  values: ItemValues;
}

interface Run {
  env: Env;
  p: Principal;
  schemas: Schemas;
  fileName: string;
  issues: ExcelIssue[];
  budget: number;
  more: boolean;
  applied: { created: number; updated: number; deleted: number; trends: number };
}

const spend = (run: Run, cost: number): boolean => {
  if (run.budget < cost) {
    run.more = true;
    return false;
  }
  run.budget -= cost;
  return true;
};

/** Primary and Secondary: one entry per row, matched by ID; new rows published, changed rows edited, missing rows deleted. */
async function syncTracker(run: Run, stream: Stream, sheet: Sheet | undefined, existing: Existing[], report: ExcelSyncStatus["sheets"]): Promise<{ deletes: Existing[] }> {
  if (!sheet) return { deletes: [] };
  const { env, p, schemas } = run;
  const schema = schemas[stream];
  const rows = sheet.rows.map((r) => ({ row: r.row, values: Object.fromEntries(sheet.columns.map((c, i) => [c, r.cells[i] ?? ""]).filter(([c]) => c)) as Record<string, string> }));
  const prepared = await prepareRows(env, schemas, p.tenantId, stream, rows);
  report.push({ name: sheet.name, kind: stream, rows: rows.length, columns: sheet.columns.filter((c) => c && !prepared.unknown.includes(c)), ignored: prepared.unknown });
  const bad = new Set(prepared.errors.map((e) => e.row));
  for (const e of prepared.errors) run.issues.push({ sheet: sheet.name, row: e.row, column: e.column, message: e.message });
  const idLabel = schema.columns.find((c) => c.key === FIELDS.id)?.label ?? "ID";
  const byKey = new Map(existing.filter((x) => x.stream === stream).map((x) => [x.key, x]));
  const seen = new Map<string, number>();
  const creates: PreparedRow[] = [];
  const updates: { r: PreparedRow; ex: Existing }[] = [];
  for (const r of prepared.rows) {
    const key = flat(r.values[FIELDS.id]).toLowerCase();
    if (!key) {
      if (!bad.has(r.row)) run.issues.push({ sheet: sheet.name, row: r.row, column: idLabel, message: `No ${idLabel}: give the row an ${idLabel} (or the fields it is made from).` });
      continue;
    }
    const first = seen.get(key);
    if (first) {
      run.issues.push({ sheet: sheet.name, row: r.row, column: idLabel, message: `${idLabel} “${String(r.values[FIELDS.id])}” is also used on row ${first}: this row is left out.` });
      continue;
    }
    seen.set(key, r.row);
    if (bad.has(r.row)) continue;
    const ex = byKey.get(key);
    if (!ex) creates.push(r);
    else if (r.given.some((k) => !r.filled.includes(k) && flat(r.values[k]) !== flat(ex.values[k]))) updates.push({ r, ex });
  }
  const deletes = existing.filter((x) => x.stream === stream && !seen.has(x.key));

  // New rows, a few at a time (each is about four statements).
  for (let i = 0; i < creates.length && run.budget > 0; ) {
    const n = Math.min(MAX_CREATES, creates.length - i, Math.floor((run.budget - COST.createChunk) / COST.create));
    if (n < 1 || !spend(run, COST.createChunk + n * COST.create)) {
      run.more = true;
      break;
    }
    const chunk = creates.slice(i, i + n);
    const codes = await insertRows(env, schema, p, stream, run.fileName, chunk);
    if (!codes) {
      run.issues.push({ sheet: sheet.name, row: chunk[0]!.row, column: idLabel, message: `An ${idLabel} on rows ${chunk[0]!.row}–${chunk.at(-1)!.row} was taken while syncing: tried again on the next run.` });
      run.more = true;
      break;
    }
    run.applied.created += codes.length;
    i += n;
  }
  if (creates.length && run.applied.created < creates.length && !run.more) run.more = true;

  // Changed rows: edited (a new revision), and their Phantom taken again so the Markdown and alert show the workbook as it is now.
  for (const { r, ex } of updates) {
    if (!spend(run, COST.update)) break;
    const raw: Record<string, unknown> = { ...ex.values };
    for (const k of r.given) if (!r.filled.includes(k)) raw[k] = r.values[k] ?? null;
    try {
      await revise(env, schemas, p, ex.id, raw, `Updated from ${run.fileName} (sheet ${sheet.name}, row ${r.row})`, { keepReviewDate: true });
      await env.DB.batch([env.DB.prepare("DELETE FROM phantom_snapshots WHERE tenant_id = ?1 AND item_id = ?2").bind(p.tenantId, ex.id), snapshotPhantom(env, p.tenantId, ex.id)]);
      run.applied.updated++;
    } catch (err) {
      const e = err as { message?: string; fields?: { label: string; message: string }[] };
      if (/Nothing changed/i.test(e.message ?? "")) continue;
      for (const f of e.fields?.length ? e.fields : [{ label: null as unknown as string, message: e.message ?? "Could not be updated" }])
        run.issues.push({ sheet: sheet.name, row: r.row, column: f.label ?? null, message: f.message });
    }
  }
  return { deletes };
}

/** Removed rows: their entries are deleted (all in one statement). */
async function deleteEntries(run: Run, deletes: Existing[]): Promise<void> {
  if (!deletes.length || !spend(run, COST.deleteAll)) return;
  const { env, p } = run;
  const ids = deletes.slice(0, 80).map((d) => d.id);
  if (ids.length < deletes.length) run.more = true;
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE intelligence_items SET status = 'deleted', deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE tenant_id = ?2 AND status = 'approved' AND id IN (${ids.map((_, i) => `?${i + 3}`).join(", ")})`,
  )
    .bind(now, p.tenantId, ...ids)
    .run();
  run.applied.deleted += ids.length;
  await audit(env, { tenantId: p.tenantId, actorId: p.userId || null, actorEmail: p.email, action: "item.deleted", targetType: "item", details: { table: "global", reason: `No longer in ${run.fileName}`, count: ids.length } });
}

/** The index of the first column with one of these names. */
const colOf = (columns: string[], names: readonly string[]) => columns.findIndex((c) => c && columnIs(c, names));

/** Competitor Trend Analysis: each competitor's Company Profile (a competitor left out goes back to the default profile). */
async function syncCompetitors(run: Run, sheet: Sheet | undefined, report: ExcelSyncStatus["sheets"]): Promise<void> {
  if (!sheet) return;
  const { env, p } = run;
  const nameAt = colOf(sheet.columns, COMPETITOR_COLUMNS.name);
  const textAt = colOf(sheet.columns, COMPETITOR_COLUMNS.text);
  report.push({ name: sheet.name, kind: "competitor", rows: sheet.rows.length, columns: [sheet.columns[nameAt], sheet.columns[textAt]].filter((c): c is string => !!c), ignored: sheet.columns.filter((c, i) => c && i !== nameAt && i !== textAt) });
  if (nameAt < 0 || textAt < 0) {
    run.issues.push({ sheet: sheet.name, row: null, column: null, message: `The sheet needs a “${COMPETITOR_COLUMNS.name[0]}” column and a “${COMPETITOR_COLUMNS.text[0]}” column: the Company Profiles are left as they are.` });
    return;
  }
  const known = knownNames(run.schemas);
  const want = new Map<string, string>();
  for (const r of sheet.rows) {
    const name = (r.cells[nameAt] ?? "").trim();
    const text = (r.cells[textAt] ?? "").trim();
    if (!name) {
      run.issues.push({ sheet: sheet.name, row: r.row, column: sheet.columns[nameAt]!, message: "Give the competitor." });
      continue;
    }
    const res = await resolve(env, p.tenantId, known, "competitor", name);
    if (!res.ok) {
      run.issues.push({ sheet: sheet.name, row: r.row, column: sheet.columns[nameAt]!, message: res.message });
      continue;
    }
    if (want.has(res.name)) {
      run.issues.push({ sheet: sheet.name, row: r.row, column: sheet.columns[nameAt]!, message: `${res.name} is on an earlier row too: this row is left out.` });
      continue;
    }
    if (text.length > 10_000) {
      run.issues.push({ sheet: sheet.name, row: r.row, column: sheet.columns[textAt]!, message: `${text.length.toLocaleString("en-GB")} characters; the most is 10,000.` });
      continue;
    }
    want.set(res.name, text);
  }
  const { results } = await env.DB.prepare("SELECT name, text FROM trend_summaries WHERE tenant_id = ?1 AND level = 'competitor'").bind(p.tenantId).all<{ name: string; text: string }>();
  const have = new Map((results ?? []).map((r) => [r.name, r.text]));
  for (const [name, text] of want) {
    if (!text || have.get(name) === text) continue;
    if (!spend(run, COST.trend * 2)) return;
    await store(env, p, [{ level: "competitor", name, parent: null, text }], "import", run.fileName);
    run.applied.trends++;
  }
  for (const [name] of have) {
    if (want.get(name)) continue;
    if (!spend(run, COST.trend)) return;
    await env.DB.prepare("DELETE FROM trend_summaries WHERE tenant_id = ?1 AND level = 'competitor' AND name = ?2").bind(p.tenantId, name).run();
    run.applied.trends++;
  }
}

/** Macrotrend Analysis: each Macrotrend's sections (an empty cell clears its section; a Macrotrend left out loses its sections). */
async function syncMacrotrends(run: Run, sheet: Sheet | undefined, report: ExcelSyncStatus["sheets"]): Promise<void> {
  if (!sheet) return;
  const { env, p } = run;
  const nameAt = colOf(sheet.columns, MACROTREND_COLUMNS.name);
  const sectionAt = new Map<MacroSectionKey, number>();
  for (const k of MACRO_SECTION_KEYS) {
    const at = sheet.columns.findIndex((c, i) => c && i !== nameAt && columnIs(c, MACROTREND_COLUMNS.sections[k]) && ![...sectionAt.values()].includes(i));
    if (at >= 0) sectionAt.set(k, at);
  }
  const used = new Set([nameAt, ...sectionAt.values()]);
  report.push({ name: sheet.name, kind: "macrotrend", rows: sheet.rows.length, columns: sheet.columns.filter((c, i) => c && used.has(i)), ignored: sheet.columns.filter((c, i) => c && !used.has(i)) });
  if (nameAt < 0 || !sectionAt.size) {
    run.issues.push({ sheet: sheet.name, row: null, column: null, message: `The sheet needs a “${MACROTREND_COLUMNS.name[0]}” column and at least one section column (${MACRO_SECTION_KEYS.map((k) => `“${MACROTREND_COLUMNS.sections[k][0]}”`).join(", ")}): the Macrotrend sections are left as they are.` });
    return;
  }
  const known = knownNames(run.schemas);
  const want = new Map<string, Partial<Record<MacroSectionKey, string>>>();
  for (const r of sheet.rows) {
    const name = (r.cells[nameAt] ?? "").trim();
    if (!name) {
      run.issues.push({ sheet: sheet.name, row: r.row, column: sheet.columns[nameAt]!, message: "Give the Macrotrend." });
      continue;
    }
    const res = await resolve(env, p.tenantId, known, "macro", name);
    if (!res.ok) {
      run.issues.push({ sheet: sheet.name, row: r.row, column: sheet.columns[nameAt]!, message: res.message });
      continue;
    }
    if (want.has(res.name)) {
      run.issues.push({ sheet: sheet.name, row: r.row, column: sheet.columns[nameAt]!, message: `${res.name} is on an earlier row too: this row is left out.` });
      continue;
    }
    const sections: Partial<Record<MacroSectionKey, string>> = {};
    let tooLong = false;
    for (const [k, at] of sectionAt) {
      const t = (r.cells[at] ?? "").trim();
      if (t.length > 10_000) {
        run.issues.push({ sheet: sheet.name, row: r.row, column: sheet.columns[at]!, message: `${t.length.toLocaleString("en-GB")} characters; the most is 10,000.` });
        tooLong = true;
      } else if (t) sections[k] = t;
    }
    if (!tooLong) want.set(res.name, sections);
  }
  const { results } = await env.DB.prepare("SELECT macrotrend, section, text FROM macrotrend_sections WHERE tenant_id = ?1").bind(p.tenantId).all<{ macrotrend: string; section: MacroSectionKey; text: string }>();
  const have = new Map<string, Partial<Record<MacroSectionKey, string>>>();
  for (const r of results ?? []) (have.get(r.macrotrend) ?? have.set(r.macrotrend, {}).get(r.macrotrend)!)[r.section] = r.text;
  const at = nowIso();
  for (const name of new Set([...want.keys(), ...have.keys()])) {
    const next = want.get(name) ?? {};
    const prev = have.get(name) ?? {};
    // Only the sections the sheet has columns for (another section keeps what it has).
    const keys = MACRO_SECTION_KEYS.filter((k) => sectionAt.has(k) || !want.has(name));
    const changed = keys.filter((k) => (next[k] ?? "") !== (prev[k] ?? ""));
    if (!changed.length) continue;
    if (!spend(run, COST.trend * (changed.length + 1))) return;
    const stmts: D1PreparedStatement[] = changed.map((k) =>
      next[k] ? sectionUpsert(env, p, name, k, next[k]!, at) : env.DB.prepare("DELETE FROM macrotrend_sections WHERE tenant_id = ?1 AND macrotrend = ?2 AND section = ?3").bind(p.tenantId, name, k),
    );
    if (Object.keys(next).length)
      stmts.push(
        env.DB.prepare(
          "INSERT INTO trend_analyses (id, tenant_id, level, name, parent, text, source, file_name, submitted_by, submitted_at, sections_json) VALUES (?1, ?2, 'macro', ?3, NULL, ?4, 'import', ?5, ?6, ?7, ?8)",
        ).bind(newId("ta"), p.tenantId, name, joined(next), run.fileName, p.userId || null, at, JSON.stringify(next)),
      );
    await env.DB.batch(stmts);
    run.applied.trends++;
  }
}

/** The test space's Tracker entries (with their values), matched to rows by ID. */
async function existingEntries(env: Env, schemas: Schemas, test: string): Promise<Existing[]> {
  const { results } = await env.DB.prepare("SELECT id, stream, record_id, draft_json FROM intelligence_items WHERE tenant_id = ?1 AND status = 'approved'")
    .bind(test)
    .all<{ id: string; stream: Stream; record_id: string | null; draft_json: string | null }>();
  return (results ?? []).map((r) => {
    const values = normaliseValues(schemas[r.stream], JSON.parse(r.draft_json || "{}"));
    return { id: r.id, stream: r.stream, key: flat(r.record_id ?? values[FIELDS.id]).toLowerCase(), values };
  });
}

/**
 * One sync run for a live workspace: is there a new version of the workbook
 * (or `force`)? Then read it and apply as many changes as this run allows.
 * `upload` (development and tests) reads those bytes instead of SharePoint.
 */
export async function syncStep(
  env: Env,
  live: { id: string; name: string },
  actor: Pick<Principal, "userId" | "email" | "name"> | null,
  opts: { force?: boolean; upload?: { bytes: Uint8Array; name: string } } = {},
): Promise<ExcelSyncStatus> {
  const test = await ensureTestSpace(env, live, actor?.userId ?? null);
  let row = (await syncRow(env, live.id))!;
  const now = nowIso();
  const prev: Report = row.report_json ? { ...EMPTY_REPORT, ...(JSON.parse(row.report_json) as Partial<Report>) } : EMPTY_REPORT;
  /** No change in this call (the stored report keeps what the last real run did). */
  const quiet = (r: SyncRow) => ({ ...statusOf(env, r), applied: EMPTY_APPLIED, more: !!r.pending_version });
  // Request 56: the Test pages check every 10 seconds, so a check that finds nothing writes only when something is new.
  const recent = (at: string | null) => !!at && Date.now() - Date.parse(at) < 60_000;
  const failed = async (message: string, problem: ReturnType<GraphError["toJSON"]> | null, releaseLock: boolean) => {
    if (!releaseLock && row.status === "error" && row.message === message && recent(row.last_checked_at)) return quiet(row);
    await env.DB.prepare(`UPDATE excel_sync SET status = 'error', message = ?2, last_checked_at = ?3, report_json = ?4${releaseLock ? ", lock_until = NULL" : ""} WHERE tenant_id = ?1`)
      .bind(live.id, message, now, JSON.stringify({ ...prev, problem, applied: EMPTY_APPLIED, more: false }))
      .run();
    row = (await syncRow(env, live.id))!;
    return quiet(row);
  };
  if (!opts.upload) {
    const missing = missingSecrets(env);
    if (missing.length) return failed(`Not configured: set ${missing.join(", ")}`, null, false);
  }

  // Has the workbook changed? (One Graph call; no lock, and no write unless something is new.)
  let file: WorkbookFile;
  try {
    file = opts.upload
      ? { name: opts.upload.name, size: opts.upload.bytes.byteLength, lastModified: now, lastModifiedBy: actor?.name ?? null, webUrl: null, version: `upload:${(await sha256Hex(opts.upload.bytes)).slice(0, 24)}` }
      : await workbookFile(env);
  } catch (err) {
    const problem = err instanceof GraphError ? err.toJSON() : null;
    if (!problem) log("error", "excel_sync_failed", { tenant: live.id, message: (err as Error).message });
    return failed(problem ? problem.message : `The sync stopped: ${(err as Error).message}`, problem, false);
  }
  const fileCols = [file.name, file.webUrl, file.lastModified, file.lastModifiedBy] as const;
  if (!opts.force && !opts.upload && row.version === file.version && !row.pending_version) {
    const sameFile = row.file_name === file.name && row.file_url === file.webUrl && row.file_modified_at === file.lastModified && row.file_modified_by === file.lastModifiedBy;
    if (row.status === "idle" && !prev.problem && sameFile && recent(row.last_checked_at)) return quiet(row);
    await env.DB.prepare(
      "UPDATE excel_sync SET status = 'idle', message = NULL, file_name = ?2, file_url = ?3, file_modified_at = ?4, file_modified_by = ?5, last_checked_at = ?6, report_json = ?7 WHERE tenant_id = ?1",
    )
      .bind(live.id, ...fileCols, now, JSON.stringify({ ...prev, problem: null, applied: EMPTY_APPLIED, more: false }))
      .run();
    row = (await syncRow(env, live.id))!;
    return quiet(row);
  }

  // One run at a time.
  const lock = await env.DB.prepare("UPDATE excel_sync SET lock_until = ?2 WHERE tenant_id = ?1 AND (lock_until IS NULL OR lock_until < ?3)")
    .bind(live.id, new Date(Date.now() + LOCK_MS).toISOString(), now)
    .run();
  if (!lock.meta.changes) return { ...quiet(row), message: "A sync is already running: try again in a moment." };

  try {
    // A new version (or a forced run): the live workspace's columns, options and settings are copied again first.
    const starting = opts.force || opts.upload || row.pending_version !== file.version;
    if (starting) await env.DB.batch(copyConfig(env, live.id, test));
    const bytes = opts.upload?.bytes ?? (await downloadWorkbook(env));
    const book = await readWorkbook(bytes);
    const issues: ExcelIssue[] = [];
    const { sheets, report } = sortSheets(book, issues);
    const schemas = await loadSchemas(env, test);
    const run: Run = { env, p: await actorIn(env, test, row, actor), schemas, fileName: file.name || EXCEL_WORKBOOK_NAME, issues, budget: BUDGET, more: false, applied: { ...EMPTY_APPLIED } };
    const existing = await existingEntries(env, schemas, test);
    const deletes: Existing[] = [];
    for (const stream of ["primary", "secondary"] as const) {
      // A missing sheet leaves that Tracker as it is (renamed by mistake, not emptied).
      const r = await syncTracker(run, stream, sheets[stream], existing, report);
      deletes.push(...r.deletes);
    }
    await deleteEntries(run, deletes);
    await syncCompetitors(run, sheets.competitor, report);
    await syncMacrotrends(run, sheets.macrotrend, report);
    const changed = run.applied.created + run.applied.updated + run.applied.deleted + run.applied.trends > 0;
    if (changed) await bumpDataVersion(env, test);
    const done = !run.more;
    const order = (k: string) => ["primary", "secondary", "competitor", "macrotrend", "ignored"].indexOf(k);
    const out: Report = {
      sheets: report.sort((a, b) => order(a.kind) - order(b.kind)),
      issues: issues.sort((a, b) => (a.sheet === b.sheet ? (a.row ?? 0) - (b.row ?? 0) : 0)).slice(0, MAX_ISSUES),
      counts: await countsIn(env, test),
      problem: null,
      applied: run.applied,
      more: run.more,
    };
    await env.DB.prepare(
      `UPDATE excel_sync SET status = ?2, message = ?3, version = ?4, pending_version = ?5, file_name = ?6, file_url = ?7, file_modified_at = ?8, file_modified_by = ?9,
         last_checked_at = ?10, last_synced_at = COALESCE(?11, last_synced_at), last_change_at = COALESCE(?12, last_change_at), lock_until = NULL, report_json = ?13 WHERE tenant_id = ?1`,
    )
      .bind(
        live.id,
        done ? "idle" : "syncing",
        done ? null : "Applying the changes a few rows at a time…",
        done ? file.version : row.version,
        done ? null : file.version,
        ...fileCols,
        now,
        done ? now : null,
        changed ? now : null,
        JSON.stringify(out),
      )
      .run();
    if (changed) log("info", "excel_sync_applied", { tenant: live.id, test, ...run.applied, more: run.more, issues: issues.length });
    return excelStatus(env, live.id);
  } catch (err) {
    const problem = err instanceof GraphError ? err.toJSON() : null;
    if (!problem) log("error", "excel_sync_failed", { tenant: live.id, message: (err as Error).message, stack: (err as Error).stack?.split("\n").slice(0, 4).join(" | ") });
    return failed(problem ? problem.message : `The sync stopped: ${(err as Error).message}`, problem, true);
  }
}

/** Request 55: every minute, the Test tab's workbook is checked for changes (wrangler.jsonc; the other schedule is the daily retention run). */
export const EXCEL_CRON = "* * * * *";

/** The every-minute cron: each workspace with a test space is synced (when the workbook changed, or a sync is under way). */
export async function runExcelCron(env: Env): Promise<void> {
  if (missingSecrets(env).length) return;
  const { results } = await env.DB.prepare("SELECT s.tenant_id, t.name FROM excel_sync s JOIN tenants t ON t.id = s.tenant_id WHERE t.active = 1").all<{ tenant_id: string; name: string }>();
  for (const r of results ?? []) {
    try {
      await syncStep(env, { id: r.tenant_id, name: r.name }, null);
    } catch (err) {
      log("error", "excel_cron_failed", { tenant: r.tenant_id, message: (err as Error).message });
    }
  }
}
