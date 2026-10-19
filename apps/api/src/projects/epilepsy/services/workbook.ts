/**
 * Request 61: the Epilepsy project's SharePoint workbook. An admin pastes its
 * link (Admin → Epilepsy settings); the link is resolved once to the file's
 * drive and item ids. Every minute (and on Sync now) the file's version is
 * checked (one Graph call); when it changed, the four sheets are read and
 * their rows replace the ones kept (epilepsy_rows, JSON in chunks). The pages
 * read them all in one request (cached while nothing changed).
 */
import {
  EPILEPSY_DEFAULT_FILE,
  EPILEPSY_SHEETS,
  EPILEPSY_SHEET_NAME,
  EPI_COLUMNS,
  acceptedOptions,
  type SheetLists,
  EPI_LAUNCH_FIELDS,
  EPI_PRIMARY_FIELDS,
  EPI_PROFILE_FIELDS,
  EPI_RCA_PANEL,
  EPI_SECONDARY_FIELDS,
  epilepsySheetOf,
  excelDate,
  normaliseHeader,
  type EpilepsyData,
  type EpilepsySheet,
  type EpilepsySheetData,
  type EpilepsySyncStatus,
  type Grid,
} from "@eradigm/shared";
import type { Principal } from "../../../auth/context.js";
import type { Env } from "../../../env.js";
import { bumpDataVersion } from "../../../lib/cache.js";
import { badRequest, forbidden } from "../../../lib/errors.js";
import { nowIso } from "../../../lib/ids.js";
import { log } from "../../../lib/log.js";
import { audit } from "../../../services/audit.js";
import { GraphError, downloadWorkbook, readWorkbook, resolveWorkbookLink, workbookFile, type WorkbookTarget } from "../../../services/sharepoint.js";

/** The columns each sheet is expected to have (to find its header row). */
const EXPECTED: Record<EpilepsySheet, readonly string[]> = {
  secondary: EPI_SECONDARY_FIELDS,
  primary: EPI_PRIMARY_FIELDS,
  profiles: EPI_PROFILE_FIELDS,
  assets: [...EPI_LAUNCH_FIELDS, ...EPI_RCA_PANEL],
};
/** Sheets whose company is written once for a block of rows (merged cells): later rows take it from above. */
const FILL_DOWN: Partial<Record<EpilepsySheet, string>> = { profiles: "Company/competitor", assets: "Company/competitor" };
/** The most rows kept per chunk (D1 keeps each value under 2 MB; a chunk stays far below). */
const CHUNK_BYTES = 400_000;
const LOCK_MS = 60_000;
/** The every-minute cron re-checks a workbook at most this often. */
const RECHECK_MS = 55_000;

interface Row {
  tenant_id: string;
  link: string | null;
  file_name: string;
  drive_id: string | null;
  item_id: string | null;
  status: EpilepsySyncStatus["status"];
  message: string | null;
  problem_json: string | null;
  version: string | null;
  file_url: string | null;
  file_label: string | null;
  file_modified_at: string | null;
  file_modified_by: string | null;
  counts_json: string | null;
  colours_json: string | null;
  column_names_json: string | null;
  lists_json: string | null;
  added_options_json: string | null;
  last_checked_at: string | null;
  last_synced_at: string | null;
}

async function rowOf(env: Env, tenantId: string): Promise<Row | null> {
  return env.DB.prepare("SELECT * FROM epilepsy_workbook WHERE tenant_id = ?1").bind(tenantId).first<Row>();
}

async function ensureRow(env: Env, tenantId: string): Promise<Row> {
  await env.DB.prepare("INSERT OR IGNORE INTO epilepsy_workbook (tenant_id, file_name) VALUES (?1, ?2)").bind(tenantId, EPILEPSY_DEFAULT_FILE).run();
  return (await rowOf(env, tenantId))!;
}

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function statusOf(r: Row): EpilepsySyncStatus {
  return {
    status: r.status,
    message: r.message,
    link: r.link,
    fileName: r.file_name,
    file: { name: r.file_label, url: r.file_url, modifiedAt: r.file_modified_at, modifiedBy: r.file_modified_by },
    lastCheckedAt: r.last_checked_at,
    lastSyncedAt: r.last_synced_at,
    counts: parse(r.counts_json, {}),
    problem: parse(r.problem_json, null),
  };
}

export async function epilepsyStatus(env: Env, tenantId: string): Promise<EpilepsySyncStatus> {
  return statusOf(await ensureRow(env, tenantId));
}

type BySheet<T> = Partial<Record<EpilepsySheet, Record<string, T>>>;

/** Request 65: only the sheets and columns that mean something (a page's column; a value given). */
function cleanColumnNames(b: BySheet<string>): BySheet<string> {
  const out: BySheet<string> = {};
  for (const k of EPILEPSY_SHEETS) {
    const known = new Map(EPI_COLUMNS[k].map((c) => [normaliseHeader(c.name), c.name]));
    for (const [want, header] of Object.entries(b[k] ?? {})) {
      const name = known.get(normaliseHeader(want));
      if (!name) throw badRequest(`“${want}” is not a column the pages read from ${EPILEPSY_SHEET_NAME[k]}`);
      if (header.trim()) (out[k] ??= {})[name] = header.trim();
    }
  }
  return out;
}
function cleanOptions(b: BySheet<string[]>): BySheet<string[]> {
  const out: BySheet<string[]> = {};
  for (const k of EPILEPSY_SHEETS) {
    for (const [col, opts] of Object.entries(b[k] ?? {})) {
      const list = acceptedOptions([], opts);
      if (col.trim() && list.length) (out[k] ??= {})[col.trim()] = list;
    }
  }
  return out;
}

/** Admins set the workbook's link and file name, the companies' colours, and (request 65) the column names and added dropdown options. */
export async function saveEpilepsySettings(
  env: Env,
  p: Principal,
  b: { link?: string; fileName?: string; colours?: Record<string, string>; columnNames?: BySheet<string>; addedOptions?: BySheet<string[]> },
): Promise<EpilepsySyncStatus> {
  if (p.role !== "admin") throw forbidden("Only admins change the Epilepsy settings");
  const r = await ensureRow(env, p.tenantId);
  const now = nowIso();
  const linkChanged = b.link !== undefined && (b.link || null) !== r.link;
  const nameChanged = b.fileName !== undefined && b.fileName !== r.file_name;
  if (linkChanged || nameChanged) {
    // Another workbook: found again from the link, and read in full on the next sync.
    await env.DB.prepare(
      "UPDATE epilepsy_workbook SET link = ?2, file_name = ?3, drive_id = NULL, item_id = NULL, version = NULL, status = 'never', message = NULL, problem_json = NULL, updated_at = ?4, updated_by = ?5 WHERE tenant_id = ?1",
    )
      .bind(p.tenantId, b.link !== undefined ? b.link || null : r.link, b.fileName ?? r.file_name, now, p.userId)
      .run();
  }
  if (b.colours) {
    const colours = Object.fromEntries(Object.entries(b.colours).map(([k, v]) => [k.trim(), v.toLowerCase()]));
    await env.DB.prepare("UPDATE epilepsy_workbook SET colours_json = ?2, updated_at = ?3, updated_by = ?4 WHERE tenant_id = ?1").bind(p.tenantId, JSON.stringify(colours), now, p.userId).run();
    await bumpDataVersion(env, p.tenantId);
  }
  if (b.columnNames) {
    await env.DB.prepare("UPDATE epilepsy_workbook SET column_names_json = ?2, updated_at = ?3, updated_by = ?4 WHERE tenant_id = ?1").bind(p.tenantId, JSON.stringify(cleanColumnNames(b.columnNames)), now, p.userId).run();
    await bumpDataVersion(env, p.tenantId);
  }
  if (b.addedOptions) {
    await env.DB.prepare("UPDATE epilepsy_workbook SET added_options_json = ?2, updated_at = ?3, updated_by = ?4 WHERE tenant_id = ?1").bind(p.tenantId, JSON.stringify(cleanOptions(b.addedOptions)), now, p.userId).run();
    await bumpDataVersion(env, p.tenantId);
  }
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "settings.changed", targetType: "settings", details: { sections: Object.keys(b).map((k) => `epilepsy.${k}`) } });
  return epilepsyStatus(env, p.tenantId);
}

// ---------------------------------------------------------------------------
// Reading the sheets
// ---------------------------------------------------------------------------

const filled = (r: readonly string[] | undefined) => (r ?? []).some((v) => v?.trim());

/** The header row: of the first rows, the one naming the most expected columns (else the first with any text). */
function headerAt(grid: Grid, expected: readonly string[]): number {
  const want = new Set(expected.map(normaliseHeader));
  let best = -1;
  let score = 0;
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const n = (grid[i] ?? []).filter((v) => want.has(normaliseHeader(v ?? ""))).length;
    if (n > score) {
      score = n;
      best = i;
    }
  }
  return best >= 0 ? best : grid.findIndex(filled);
}

/** A worksheet as the pages read it: its columns and the rows under them (dates as YYYY-MM-DD). */
export function sheetData(name: string, kind: EpilepsySheet, grid: Grid, lists?: SheetLists): EpilepsySheetData {
  const at = headerAt(grid, EXPECTED[kind]);
  if (at < 0) return { name, columns: [], rows: [] };
  const header = (grid[at] ?? []).map((v) => (v ?? "").replace(/\s+/g, " ").trim());
  let width = header.length;
  while (width > 0 && !header[width - 1]) width--;
  const columns = header.slice(0, width);
  // Columns that hold dates (by name): a date typed as text (or stored as a number without a date format) reads as YYYY-MM-DD.
  const dateCols = columns.map((c) => /date|start$|pcd$/.test(normaliseHeader(c)));
  const fill = FILL_DOWN[kind] ? columns.findIndex((c) => normaliseHeader(c) === normaliseHeader(FILL_DOWN[kind]!)) : -1;
  const rows: string[][] = [];
  let above = "";
  for (const raw of grid.slice(at + 1)) {
    if (!filled(raw)) continue;
    const row = columns.map((_, i) => {
      const v = (raw?.[i] ?? "").trim();
      // A year on its own (“2028”) stays a year, not Excel's day 2028 (1905).
      return dateCols[i] && v && !/^(19|20)\d\d$/.test(v) ? excelDate(v) : v;
    });
    if (!row.some((v) => v)) continue;
    if (fill >= 0) {
      if (row[fill]) above = row[fill]!;
      else row[fill] = above;
    }
    rows.push(row);
  }
  // Request 65: the dropdowns of the columns (by name).
  const byName: Record<string, string[]> = {};
  for (const [col, options] of Object.entries(lists ?? {})) {
    const header = columns[Number(col)];
    if (header) byName[header] = options;
  }
  return { name, columns, rows, ...(lists ? { lists: byName } : {}) };
}

/** The four sheets of a workbook (null: not in it). */
export async function readSheets(bytes: Uint8Array): Promise<Record<EpilepsySheet, EpilepsySheetData | null>> {
  const book = await readWorkbook(bytes, (n) => epilepsySheetOf(n) != null, { formats: true, lists: true });
  const out: Record<EpilepsySheet, EpilepsySheetData | null> = { secondary: null, primary: null, profiles: null, assets: null };
  for (const s of book) {
    const kind = epilepsySheetOf(s.name);
    if (kind && !out[kind]) out[kind] = sheetData(s.name, kind, s.grid, s.lists);
  }
  return out;
}

/** Rows in chunks of at most CHUNK_BYTES of JSON. */
function chunks(rows: string[][]): string[][][] {
  const out: string[][][] = [];
  let cur: string[][] = [];
  let size = 0;
  for (const r of rows) {
    const n = JSON.stringify(r).length + 1;
    if (cur.length && size + n > CHUNK_BYTES) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += n;
  }
  out.push(cur);
  return out;
}

async function store(env: Env, tenantId: string, sheets: Record<EpilepsySheet, EpilepsySheetData | null>) {
  const stmts: D1PreparedStatement[] = [];
  for (const kind of EPILEPSY_SHEETS) {
    const s = sheets[kind];
    // A sheet missing from the workbook (renamed by mistake) keeps what was read before.
    if (!s) continue;
    stmts.push(env.DB.prepare("DELETE FROM epilepsy_rows WHERE tenant_id = ?1 AND sheet = ?2").bind(tenantId, kind));
    chunks(s.rows).forEach((rows, i) =>
      stmts.push(
        env.DB.prepare("INSERT INTO epilepsy_rows (tenant_id, sheet, chunk, name, columns_json, rows_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(tenantId, kind, i, s.name, JSON.stringify(s.columns), JSON.stringify(rows)),
      ),
    );
  }
  // Request 65: each sheet's dropdowns (a sheet missing keeps the ones read before).
  const r = await rowOf(env, tenantId);
  const lists = parse<Partial<Record<EpilepsySheet, Record<string, string[]>>>>(r?.lists_json ?? null, {});
  for (const kind of EPILEPSY_SHEETS) if (sheets[kind]) lists[kind] = sheets[kind]!.lists ?? {};
  stmts.push(env.DB.prepare("UPDATE epilepsy_workbook SET lists_json = ?2 WHERE tenant_id = ?1").bind(tenantId, JSON.stringify(lists)));
  await env.DB.batch(stmts);
}

/** Everything the pages show: the four sheets, the companies' colours and when the workbook was last read. */
export async function epilepsyData(env: Env, tenantId: string): Promise<EpilepsyData> {
  const [res, r] = await Promise.all([
    env.DB.prepare("SELECT sheet, chunk, name, columns_json, rows_json FROM epilepsy_rows WHERE tenant_id = ?1 ORDER BY sheet, chunk")
      .bind(tenantId)
      .all<{ sheet: EpilepsySheet; chunk: number; name: string; columns_json: string; rows_json: string }>(),
    rowOf(env, tenantId),
  ]);
  const sheets: EpilepsyData["sheets"] = { secondary: null, primary: null, profiles: null, assets: null };
  for (const c of res.results ?? []) {
    const have = sheets[c.sheet];
    const rows = JSON.parse(c.rows_json) as string[][];
    if (have) have.rows.push(...rows);
    else sheets[c.sheet] = { name: c.name, columns: JSON.parse(c.columns_json) as string[], rows };
  }
  return {
    sheets,
    colours: parse(r?.colours_json ?? null, {}),
    columnNames: parse(r?.column_names_json ?? null, {}),
    dropdowns: parse(r?.lists_json ?? null, {}),
    addedOptions: parse(r?.added_options_json ?? null, {}),
    syncedAt: r?.last_synced_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Check the workbook and, when it changed (or `force`), read it again.
 * `upload`: development and tests only, the workbook's bytes instead of SharePoint's.
 */
export async function syncEpilepsy(env: Env, tenantId: string, actor: Pick<Principal, "userId" | "email"> | null, opts: { force?: boolean; upload?: { bytes: Uint8Array; name: string } } = {}): Promise<EpilepsySyncStatus> {
  let r = await ensureRow(env, tenantId);
  const now = nowIso();
  if (!opts.upload && !r.link) {
    if (r.status !== "never" || r.message !== null) await env.DB.prepare("UPDATE epilepsy_workbook SET status = 'never', message = NULL WHERE tenant_id = ?1").bind(tenantId).run();
    return { ...statusOf(r), status: "never", message: "Paste the workbook's SharePoint link in Admin → Epilepsy settings." };
  }
  const lock = await env.DB.prepare("UPDATE epilepsy_workbook SET lock_until = ?2 WHERE tenant_id = ?1 AND (lock_until IS NULL OR lock_until < ?3)")
    .bind(tenantId, new Date(Date.now() + LOCK_MS).toISOString(), now)
    .run();
  if (!lock.meta.changes) return { ...statusOf(r), message: "A sync is already running: try again in a moment." };
  try {
    let file: { name: string | null; url: string | null; modifiedAt: string | null; modifiedBy: string | null; version: string };
    let bytes: Uint8Array | null = null;
    if (opts.upload) {
      file = { name: opts.upload.name, url: null, modifiedAt: now, modifiedBy: actor?.email ?? null, version: `upload:${now}` };
      bytes = opts.upload.bytes;
    } else {
      let target: WorkbookTarget | null = r.drive_id && r.item_id ? { driveId: r.drive_id, itemId: r.item_id } : null;
      if (!target) {
        const found = await resolveWorkbookLink(env, r.link!, r.file_name);
        target = { driveId: found.driveId, itemId: found.itemId };
        await env.DB.prepare("UPDATE epilepsy_workbook SET drive_id = ?2, item_id = ?3 WHERE tenant_id = ?1").bind(tenantId, target.driveId, target.itemId).run();
      }
      const f = await workbookFile(env, target);
      file = { name: f.name, url: f.webUrl, modifiedAt: f.lastModified, modifiedBy: f.lastModifiedBy, version: f.version };
      if (opts.force || f.version !== r.version) bytes = await downloadWorkbook(env, target);
    }
    let counts = parse<Record<string, number | null>>(r.counts_json, {});
    if (bytes) {
      const sheets = await readSheets(bytes);
      await store(env, tenantId, sheets);
      counts = Object.fromEntries(EPILEPSY_SHEETS.map((k) => [k, sheets[k]?.rows.length ?? null]));
      await bumpDataVersion(env, tenantId);
      log("info", "epilepsy_sync_applied", { tenant: tenantId, ...counts });
    }
    const missing = EPILEPSY_SHEETS.filter((k) => counts[k] == null);
    await env.DB.prepare(
      `UPDATE epilepsy_workbook SET status = 'idle', message = ?2, problem_json = NULL, version = ?3, file_label = ?4, file_url = ?5, file_modified_at = ?6, file_modified_by = ?7,
         counts_json = ?8, last_checked_at = ?9, last_synced_at = COALESCE(?10, last_synced_at), lock_until = NULL WHERE tenant_id = ?1`,
    )
      .bind(
        tenantId,
        missing.length ? `Not found in the workbook: ${missing.map((k) => `“${k}”`).join(", ")} (each sheet's name must start “Platform …” as in “2. Platform Primary”)` : null,
        file.version,
        file.name,
        file.url,
        file.modifiedAt,
        file.modifiedBy,
        JSON.stringify(counts),
        now,
        bytes ? now : null,
      )
      .run();
    if (bytes && actor) await audit(env, { tenantId, actorId: actor.userId, actorEmail: actor.email, action: "settings.changed", targetType: "settings", details: { sections: ["epilepsy.sync"], counts } });
  } catch (err) {
    const problem = err instanceof GraphError ? err.toJSON() : null;
    if (!problem) log("error", "epilepsy_sync_failed", { tenant: tenantId, message: (err as Error).message });
    await env.DB.prepare("UPDATE epilepsy_workbook SET status = 'error', message = ?2, problem_json = ?3, last_checked_at = ?4, lock_until = NULL WHERE tenant_id = ?1")
      .bind(tenantId, problem ? problem.message : `The sync stopped: ${(err as Error).message}`, problem ? JSON.stringify(problem) : null, now)
      .run();
  }
  r = (await rowOf(env, tenantId))!;
  return statusOf(r);
}

/** The every-minute cron: each Epilepsy workspace with a workbook is checked (and read when it changed). */
export async function runEpilepsyCron(env: Env): Promise<void> {
  const res = await env.DB.prepare(
    "SELECT w.tenant_id, w.last_checked_at FROM epilepsy_workbook w JOIN tenants t ON t.id = w.tenant_id AND t.active = 1 AND t.kind = 'epilepsy' WHERE w.link IS NOT NULL",
  ).all<{ tenant_id: string; last_checked_at: string | null }>();
  for (const w of res.results ?? []) {
    if (w.last_checked_at && Date.now() - Date.parse(w.last_checked_at) < RECHECK_MS) continue;
    await syncEpilepsy(env, w.tenant_id, null).catch((err: unknown) => log("error", "epilepsy_cron_failed", { tenant: w.tenant_id, message: (err as Error).message }));
  }
}
