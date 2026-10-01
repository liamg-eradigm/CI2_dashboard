/**
 * One-off spreadsheet import into a tracker, and attaching the saved HTML page
 * to a tracker entry afterwards.
 *
 * The dashboard parses the spreadsheet (xlsx/csv/tsv) in the browser and sends
 * the rows here keyed by the tracker's column labels, a few at a time (the
 * Workers Free plan allows 50 database queries per request). Every row is
 * checked with the same rules as an approval; a dry run over the whole file
 * comes first, so nothing is written unless every row is valid.
 *
 * Imported rows are published straight to the stream's Tracker (and therefore
 * to Phantoms under the usual rules) with no saved page; the page can be
 * attached later from the Tracker.
 */
import {
  CAPTURE_LIMITS,
  CORE,
  FIELDS,
  MAX_SAVED_PAGES,
  SOURCE_TIER,
  checkAndNormaliseUrl,
  dedupeKey,
  excelDate,
  hasOptions,
  listOptions,
  matchOption,
  normaliseValues,
  optionsOf,
  splitMulti,
  subtrendsOf,
  validateValues,
  type FieldError,
  type ItemValues,
  type Stream,
  type TrackerColumn,
  type TrackerSchema,
} from "@eradigm/shared";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { sha256Hex } from "../lib/crypto.js";
import { ApiError, conflict, notFound } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { parseUploadIsolated } from "../pipeline/capture-client.js";
import { storeSnapshot } from "../pipeline/snapshots.js";
import { audit } from "./audit.js";
import { contentFingerprintInput, getItemRow } from "./items.js";
import { listPages } from "./pages.js";
import { todayIn } from "./review.js";
import { PHYSICAL, loadSettings, type Schemas } from "./schema.js";

export interface ImportRow {
  row: number;
  values: Record<string, string | string[] | null>;
}
export interface ImportError {
  row: number;
  column: string | null;
  message: string;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** A spreadsheet cell as the value a column expects. */
function cell(col: TrackerColumn, v: string | string[] | null | undefined): string | string[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  const s = String(v);
  if (col.type === "date") return excelDate(s) || null;
  if (col.type === "multi") return s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  return s;
}

const STREAM_NAME: Record<Stream, string> = { primary: "Primary", secondary: "Secondary" };

/**
 * Dropdown values as the configured options: "press release" or "Press  release"
 * mean "Press Release" (case, spacing, quote and dash styles do not matter).
 * Values that match nothing are left as they are, for the checks to report.
 */
function canonicalise(schema: TrackerSchema, values: ItemValues): ItemValues {
  const out: ItemValues = { ...values };
  const macroCol = schema.columns.find((c) => c.key === CORE.macrotrend);
  const m = out[CORE.macrotrend];
  if (macroCol && typeof m === "string") out[CORE.macrotrend] = matchOption(m, optionsOf(schema, macroCol)) ?? m;
  for (const col of schema.columns) {
    const v = out[col.key];
    if (v == null || col.key === CORE.macrotrend) continue;
    if (col.type === "multi") {
      const opts = optionsOf(schema, col);
      out[col.key] = splitMulti(v).map((x) => matchOption(x, opts) ?? x);
    } else if (col.type === "sub" && typeof v === "string") {
      const macro = out[CORE.macrotrend];
      out[col.key] = (typeof macro === "string" ? matchOption(v, subtrendsOf(schema, macro)) : null) ?? matchOption(v, optionsOf(schema, col)) ?? v;
    } else if ((col.type === "select" || col.type === "macro") && typeof v === "string") {
      out[col.key] = matchOption(v, optionsOf(schema, col)) ?? v;
    }
  }
  return out;
}

/**
 * An import problem in plain words: for a dropdown, the value, the allowed
 * options (of this stream) and where to add one; and whether the value is an
 * option of the other stream instead (each Inbox has its own options).
 */
function explain(schema: TrackerSchema, other: TrackerSchema, stream: Stream, values: ItemValues, e: FieldError): string {
  const col = schema.columns.find((c) => c.key === e.key);
  if (!col || (e.code !== "not_in_taxonomy" && e.code !== "subtrend_mismatch")) return e.message;
  const name = STREAM_NAME[stream];
  const otherName = STREAM_NAME[stream === "primary" ? "secondary" : "primary"];
  const where = `Add or rename options under Inbox → Edit columns (${name} Inbox), then check again.`;
  const otherCol = other.columns.find((c) => c.key === e.key);
  const otherHas = (v: string) => !!otherCol && hasOptions(otherCol) && !!matchOption(v, optionsOf(other, otherCol));
  const hint = (v: string) => (otherHas(v) ? ` “${v}” is a ${otherName} option: did you mean to import into the ${otherName} Tracker?` : "");
  if (col.type === "multi") {
    const opts = optionsOf(schema, col);
    const bad = splitMulti(values[col.key]).filter((x) => !opts.includes(x));
    return `${bad.map((b) => `“${b}”`).join(", ")} ${bad.length === 1 ? "is not a" : "are not"} ${name} ${col.label} option${bad.length === 1 ? "" : "s"}. Options: ${listOptions(opts)}. ${where}${bad.map(hint).join("")}`;
  }
  const v = String(values[col.key] ?? "");
  if (col.type === "sub") {
    const macro = typeof values[CORE.macrotrend] === "string" ? (values[CORE.macrotrend] as string) : "";
    const macroLabel = schema.columns.find((c) => c.key === CORE.macrotrend)?.label ?? "Macrotrend";
    const owner = schema.taxonomy.find((g) => g.subtrends.includes(v))?.name;
    const subs = macro ? subtrendsOf(schema, macro) : [];
    if (owner && macro && owner !== macro) return `“${v}” belongs to the ${macroLabel} “${owner}”, not “${macro}”. Subtrends of “${macro}”: ${listOptions(subs)}. ${where}`;
    return `“${v}” is not a ${name} ${col.label}${macro ? ` of “${macro}”` : ""}. ${macro ? `Subtrends of “${macro}”: ${listOptions(subs)}` : `${macroLabel} must be set first`}. ${where}${hint(v)}`;
  }
  return `“${v}” is not a ${name} ${col.label} option. Options: ${listOptions(optionsOf(schema, col))}. ${where}${hint(v)}`;
}

async function allocCodes(env: Env, tenantId: string, name: "inbox" | "signal", n: number): Promise<string[]> {
  const bump = () => env.DB.prepare("UPDATE counters SET value = value + ?3 WHERE tenant_id = ?1 AND name = ?2 RETURNING value").bind(tenantId, name, n).first<{ value: number }>();
  let r = await bump();
  if (!r) {
    await env.DB.prepare("INSERT OR IGNORE INTO counters (tenant_id, name, value) VALUES (?1, ?2, ?3)").bind(tenantId, name, name === "inbox" ? 2200 : 1100).run();
    r = await bump();
  }
  const last = r?.value ?? 0;
  return Array.from({ length: n }, (_, i) => `${name === "inbox" ? "INB" : "SIG"}-${last - n + 1 + i}`);
}

export async function importRows(
  env: Env,
  schemas: Schemas,
  p: Principal,
  stream: Stream,
  fileName: string,
  rows: ImportRow[],
  dryRun: boolean,
): Promise<{ ok: boolean; imported: number; errors: ImportError[]; codes: string[] }> {
  const schema = schemas[stream];
  const other = schemas[stream === "primary" ? "secondary" : "primary"];
  const byLabel = new Map(schema.columns.map((c) => [norm(c.label), c]));
  const errors: ImportError[] = [];
  const unknown = new Set<string>();
  const today = await todayIn(env, p.tenantId);
  const hasReviewDate = schema.columns.some((c) => c.key === FIELDS.reviewDate);
  const hasTier = schema.columns.some((c) => c.key === FIELDS.sourceTier);

  const parsed = rows.map((r) => {
    const raw: Record<string, unknown> = {};
    for (const [label, v] of Object.entries(r.values)) {
      const col = byLabel.get(norm(label));
      if (!col) {
        if (label.trim()) unknown.add(label.trim());
        continue;
      }
      raw[col.key] = cell(col, v);
    }
    const values = canonicalise(schema, normaliseValues(schema, raw));
    if (hasTier) values[FIELDS.sourceTier] = SOURCE_TIER[stream];
    if (hasReviewDate && !values[FIELDS.reviewDate]) values[FIELDS.reviewDate] = today;
    for (const e of validateValues(schema, values, { forApproval: true })) errors.push({ row: r.row, column: e.label, message: explain(schema, other, stream, values, e) });
    return { row: r.row, values };
  });
  for (const u of unknown) errors.push({ row: 1, column: u, message: `“${u}” is not a column of the ${stream === "primary" ? "Primary" : "Secondary"} Tracker` });

  // IDs: unique within this request and among existing tracker entries.
  const idLabel = schema.columns.find((c) => c.key === FIELDS.id)?.label ?? "ID";
  const seen = new Map<string, number>();
  for (const r of parsed) {
    const id = r.values[FIELDS.id];
    if (typeof id !== "string" || !id) continue;
    const prev = seen.get(id.toLowerCase());
    if (prev) errors.push({ row: r.row, column: idLabel, message: `${idLabel} “${id}” is also used on row ${prev}` });
    else seen.set(id.toLowerCase(), r.row);
  }
  const ids = parsed.map((r) => r.values[FIELDS.id]).filter((v): v is string => typeof v === "string" && !!v);
  if (ids.length) {
    const taken = await env.DB.prepare(
      `SELECT record_id, signal_code FROM intelligence_items WHERE tenant_id = ? AND status = 'approved' AND record_id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(p.tenantId, ...ids)
      .all<{ record_id: string; signal_code: string }>();
    for (const t of taken.results ?? []) {
      const r = parsed.find((x) => x.values[FIELDS.id] === t.record_id);
      errors.push({ row: r?.row ?? 0, column: idLabel, message: `${idLabel} “${t.record_id}” is already used by ${t.signal_code} in the tracker` });
    }
  }
  errors.sort((a, b) => a.row - b.row);
  if (errors.length || dryRun) return { ok: !errors.length, imported: 0, errors, codes: [] };

  // ---- write (one atomic batch per request) --------------------------------
  const n = parsed.length;
  const [inbox, signal] = [await allocCodes(env, p.tenantId, "inbox", n), await allocCodes(env, p.tenantId, "signal", n)];
  const now = nowIso();
  const subId = newId("sub");
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO submissions (id, tenant_id, submitted_by, input_type, file_name, created_at) VALUES (?1, ?2, ?3, 'file', ?4, ?5)").bind(
      subId,
      p.tenantId,
      p.userId,
      fileName.slice(0, 255),
      now,
    ),
  ];
  const longText = schema.columns.filter((c) => c.type === "long" || c.type === "text");
  const outletKey = schema.columns.some((c) => c.key === FIELDS.publisher) ? FIELDS.publisher : FIELDS.sourceCompany;
  const prov = JSON.stringify(Object.fromEntries(schema.columns.map((c) => [c.key, "analyst"])));
  for (let i = 0; i < n; i++) {
    const { values } = parsed[i] as (typeof parsed)[number];
    const id = newId("itm");
    const extra: Record<string, unknown> = {};
    for (const c of schema.columns) if (!PHYSICAL[c.key] && c.key !== CORE.competitors) extra[c.key] = values[c.key] ?? null;
    const url = typeof values[FIELDS.url] === "string" ? checkAndNormaliseUrl(values[FIELDS.url] as string) : null;
    const urlOk = url && url.ok ? url.url : null;
    const body = longText
      .filter((c) => c.key !== CORE.title && c.key !== FIELDS.id && typeof values[c.key] === "string")
      .map((c) => values[c.key])
      .join("\n\n");
    const fp = contentFingerprintInput(values[CORE.title] as string, body);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO intelligence_items (id, tenant_id, submission_id, code, signal_code, stream, record_id, status, version, attempts, input_type, url_key, content_sha256, outlet,
           final_url, received_at, submitted_by, headline, body_text, publication_date, draft_json, provenance_json, published_rev, pub_date, title, macrotrend, subtrend,
           growth, impact, extra_json, approved_at, approved_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'approved', 1, 1, 'file', ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 1, ?16, ?14, ?19, ?20, ?21, ?22, ?23, ?12, ?13, ?12, ?12)`,
      ).bind(
        id,
        p.tenantId,
        subId,
        inbox[i],
        signal[i],
        stream,
        values[FIELDS.id],
        urlOk ? dedupeKey(urlOk) : null,
        fp ? await sha256Hex(fp) : null,
        (typeof values[outletKey] === "string" ? values[outletKey] : null) ?? "Imported",
        urlOk,
        now,
        p.userId,
        values[CORE.title] ?? null,
        body || null,
        values[CORE.date] ?? null,
        JSON.stringify(values),
        prov,
        values[CORE.macrotrend] ?? null,
        values[CORE.subtrend] ?? null,
        values[CORE.growth] ?? null,
        values[CORE.impact] ?? null,
        JSON.stringify(extra),
      ),
      env.DB.prepare("INSERT INTO item_competitors (tenant_id, item_id, competitor) SELECT ?1, ?2, value FROM json_each(?3)").bind(
        p.tenantId,
        id,
        JSON.stringify(Array.isArray(values[CORE.competitors]) ? values[CORE.competitors] : []),
      ),
      env.DB.prepare(
        `INSERT INTO item_revisions (id, tenant_id, item_id, seq, kind, published_rev, values_json, provenance_json, changed_keys, created_by, created_at, note)
         VALUES (?1, ?2, ?3, 1, 'published', 1, ?4, ?5, '[]', ?6, ?7, ?8)`,
      ).bind(newId("rev"), p.tenantId, id, JSON.stringify(values), prov, p.userId, now, `Imported from ${fileName.slice(0, 120)} (row ${parsed[i]?.row})`),
    );
  }
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    if (/UNIQUE/i.test(String((err as Error)?.message ?? err))) {
      return { ok: false, imported: 0, errors: [{ row: 0, column: idLabel, message: `An ${idLabel} in these rows was just used by another entry. Check the file and import again.` }], codes: [] };
    }
    throw err;
  }
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "import.completed",
    targetType: "tracker",
    details: { stream, fileName, rows: n, firstRow: parsed[0]?.row, codes: signal },
  });
  return { ok: true, imported: n, errors: [], codes: signal };
}

/** Attach the saved HTML page to a tracker entry that has none (e.g. an imported row). */
/**
 * Attach a saved HTML page to a Tracker entry. The first page becomes the
 * entry's page (and fills in its text, URL and fingerprint when missing);
 * pages attached after it are added to the entry's list of pages.
 */
export async function attachSnapshot(env: Env, p: Principal, id: string, file: { name: string; bytes: ArrayBuffer; type: string }): Promise<{ id: string; hasSnapshot: boolean; pages: number }> {
  const row = await getItemRow(env, p.tenantId, id);
  if (row.status !== "approved") throw notFound("Tracker entry");
  let hasFirst = false;
  if (row.current_snapshot_id) {
    const s = await env.DB.prepare("SELECT retention_status FROM source_snapshots WHERE id = ?1").bind(row.current_snapshot_id).first<{ retention_status: string }>();
    hasFirst = s?.retention_status === "active";
  }
  const before = hasFirst ? (await listPages(env, p.tenantId, id)).length : 0;
  if (before >= MAX_SAVED_PAGES) throw conflict(`This entry already has ${MAX_SAVED_PAGES} saved pages (the most allowed)`);
  if (!/\.html?$/i.test(file.name)) throw new ApiError("UNSUPPORTED_MEDIA", "Only .html or .htm files are accepted");
  if (file.bytes.byteLength > CAPTURE_LIMITS.maxBytes) throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds the ${CAPTURE_LIMITS.maxBytes / 1048576} MB limit`);
  // Scan and sanitise in the isolated worker before anything is stored.
  const parsed = await parseUploadIsolated(env, file.bytes, file.name);
  if (!parsed.ok) throw new ApiError("VALIDATION", parsed.message, [{ key: "file", label: "File", code: parsed.code, message: parsed.message }]);
  const settings = await loadSettings(env, p.tenantId);
  const snap = await storeSnapshot(env, {
    tenantId: p.tenantId,
    itemId: id,
    attempt: row.attempts,
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
  const name = file.name.slice(0, 200);
  if (hasFirst) {
    // Another page for an entry that has one: add it to the list (the same file twice is refused).
    const known = snap.id === row.current_snapshot_id || !!(await env.DB.prepare("SELECT 1 AS x FROM source_snapshots WHERE id = ?1 AND extra = 1 AND retention_status = 'active'").bind(snap.id).first());
    if (known) throw conflict("This page is already attached to the entry");
    await env.DB.prepare("UPDATE source_snapshots SET extra = 1, file_name = ?1, retention_status = 'active', deleted_at = NULL WHERE tenant_id = ?2 AND id = ?3").bind(name, p.tenantId, snap.id).run();
    await audit(env, {
      tenantId: p.tenantId,
      actorId: p.userId,
      actorEmail: p.email,
      action: "snapshot.attached",
      targetType: "item",
      targetId: id,
      details: { code: row.signal_code, file: file.name.slice(0, 120), page: before + 1, singleFile: parsed.singleFile.detected },
    });
    return { id, hasSnapshot: true, pages: before + 1 };
  }
  await env.DB.prepare("UPDATE source_snapshots SET file_name = ?1 WHERE tenant_id = ?2 AND id = ?3").bind(name, p.tenantId, snap.id).run();
  const fileSha = await sha256Hex(file.bytes);
  await env.DB.prepare(
    `UPDATE intelligence_items SET current_snapshot_id = ?1, file_sha256 = COALESCE(file_sha256, ?2), final_url = COALESCE(final_url, ?3),
            url_key = COALESCE(url_key, ?4), body_text = CASE WHEN body_text IS NULL OR body_text = '' THEN ?5 ELSE body_text END, updated_at = ?6
      WHERE tenant_id = ?7 AND id = ?8`,
  )
    .bind(snap.id, fileSha, parsed.finalUrl, parsed.finalUrl ? dedupeKey(parsed.finalUrl) : null, parsed.article.bodyText || null, nowIso(), p.tenantId, id)
    .run();
  await audit(env, {
    tenantId: p.tenantId,
    actorId: p.userId,
    actorEmail: p.email,
    action: "snapshot.attached",
    targetType: "item",
    targetId: id,
    details: { code: row.signal_code, file: file.name.slice(0, 120), singleFile: parsed.singleFile.detected },
  });
  return { id, hasSnapshot: true, pages: 1 };
}
