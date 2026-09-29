/**
 * HTTP API. Every route (except /api/health) resolves the caller's identity,
 * tenant and role, then checks the permission for the action. The tenant id
 * used by every query comes from the verified principal, never from the body.
 */
import { Hono, type Context } from "hono";
import type { z } from "zod";
import {
  CAPTURE_LIMITS,
  IMPORT_CHUNK_ROWS,
  ACTIONS,
  AddColumnRequest,
  AddOptionRequest,
  ApproveRequest,
  ImportRequest,
  ReorderColumnsRequest,
  ReorderOptionsRequest,
  DeleteItemRequest,
  CONTRACT_VERSION,
  CreateSavedViewRequest,
  CreateSubmissionRequest,
  CreateUserRequest,
  DeleteOptionRequest,
  EXPORT_FORMATS,
  EXPORT_MIME,
  ITEM_STATUSES,
  RejectRequest,
  RenameOptionRequest,
  ReprocessRequest,
  ReviseRequest,
  SaveDraftRequest,
  TrendConfigSchema,
  UpdateColumnRequest,
  UpdateSettingsRequest,
  UpdateUserRequest,
  CORE,
  can,
  exportFilename,
  isStream,
  mergeSchemas,
  filtersFromParams,
  getColumn,
  toCsv,
  toJson,
  toTable,
  toTsv,
  toXlsx,
  todayIso,
  type ExportFormat,
  type ItemStatus,
  type Stream,
  type TrackerSchema,
  type TenantSettings,
} from "@eradigm/shared";
import { requirePermission, resolvePrincipal, type Principal } from "./auth/context.js";
import { allowedTenants, entraConfigured } from "./auth/entra.js";
import { registerAuthRoutes } from "./auth/routes.js";
import type { Env } from "./env.js";
import { ApiError, badRequest, forbidden, notFound } from "./lib/errors.js";
import { newId, nowIso } from "./lib/ids.js";
import { log, metric } from "./lib/log.js";
import { prefillMode } from "./pipeline/prefill.js";
import { readSnapshot, snapshotBackend } from "./pipeline/snapshots.js";
import { audit, listAudit, verifyChain } from "./services/audit.js";
import { getDetail, getItemRow, inboxCounts, listItems } from "./services/items.js";
import { qualityMetrics } from "./services/metrics.js";
import { dashboard, exportRows, trackerPage, trendTest, type Scope } from "./services/query.js";
import { approve, reject, reprocess, revise, saveDraft, softDelete } from "./services/review.js";
import {
  addColumn,
  addOption,
  deleteColumn,
  deleteOption,
  loadSchema,
  loadSchemas,
  loadSettings,
  optionUsageMap,
  renameOption,
  reorderColumns,
  reorderOptions,
  saveSettings,
  updateColumn,
} from "./services/schema.js";
import { signalDetail, signalMarkdown } from "./services/signals.js";
import { attachSnapshot, importRows } from "./services/imports.js";
import { submitFile, submitUrl } from "./services/submissions.js";
import { createInvite, createUser, listUsers, revokeSessions, updateUser } from "./services/users.js";

type Vars = { principal: Principal; requestId: string };
type C = Context<{ Bindings: Env; Variables: Vars }>;

export const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use("*", async (c, next) => {
  const requestId = c.req.header("cf-ray") ?? newId("req");
  c.set("requestId", requestId);
  const started = Date.now();
  await next();
  c.header("X-Request-Id", requestId);
  c.header("X-Contract-Version", CONTRACT_VERSION);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  if (!c.res.headers.get("Cache-Control")) c.header("Cache-Control", "no-store");
  const p = c.get("principal") as Principal | undefined;
  const route = c.req.routePath;
  log("info", "request", { requestId, method: c.req.method, route, status: c.res.status, ms: Date.now() - started, tenant: p?.tenantId, user: p?.userId });
  metric(c.env, "request_ms", Date.now() - started, { route, status: String(c.res.status), tenant: p?.tenantId ?? "" });
});

app.onError((err, c) => {
  const requestId = c.get("requestId");
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, fields: err.fields, details: err.details, requestId } }, err.status as 400);
  }
  log("error", "unhandled", { requestId, message: (err as Error).message, stack: (err as Error).stack?.split("\n").slice(0, 5).join(" | ") });
  return c.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again.", requestId } }, 500);
});

app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404));

app.get("/api/health", async (c) => {
  let db = "ok";
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch {
    db = "error";
  }
  return c.json({ ok: db === "ok", environment: c.env.ENVIRONMENT, contractVersion: CONTRACT_VERSION, checks: { db } }, db === "ok" ? 200 : 503);
});

// Sign-in with Microsoft (public routes, before the authentication middleware).
registerAuthRoutes(app);

// Authentication, tenancy and rate limiting for everything else.
app.use("/api/*", async (c, next) => {
  // Cross-site request forgery: the session is a cookie, so every state-changing
  // request must carry a header that a cross-site form or image cannot send
  // (and that a cross-origin script cannot send without a CORS preflight, which
  // this API never grants).
  if (c.env.AUTH_MODE === "entra" && !["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-eci-request") !== "1") {
    throw forbidden("Request blocked (missing X-ECI-Request header)");
  }
  const p = await resolvePrincipal(c.req.raw, c.env);
  c.set("principal", p);
  if (c.env.RATE_LIMITER) {
    const { success } = await c.env.RATE_LIMITER.limit({ key: p.userId });
    if (!success) throw new ApiError("RATE_LIMITED", "Too many requests. Please slow down and try again shortly.");
  }
  await next();
});

async function body<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new ApiError(
      "VALIDATION",
      "Some fields are invalid",
      r.error.issues.map((i) => ({ key: i.path.join(".") || "body", label: i.path.join(".") || "Request", code: "invalid", message: i.message })),
    );
  }
  return r.data;
}

const P = (c: C) => c.get("principal");
const ctxOf = (c: C): ExecutionContext | null => {
  try {
    return c.executionCtx as ExecutionContext;
  } catch {
    return null;
  }
};

/** `?stream=primary|secondary` (default primary). */
function streamOf(c: C, raw: string | null | undefined = c.req.query("stream")): Stream {
  if (raw == null || raw === "") return "primary";
  if (!isStream(raw)) throw badRequest("stream must be “primary” or “secondary”");
  return raw;
}

async function schemaFor(c: C, stream: Stream = streamOf(c)) {
  return loadSchema(c.env, P(c).tenantId, stream);
}

async function schemasFor(c: C) {
  return loadSchemas(c.env, P(c).tenantId);
}

/** Both streams as one read-only schema: the Dashboard covers every source. */
async function mergedSchema(c: C) {
  const s = await schemasFor(c);
  return mergeSchemas(s.primary, s.secondary);
}

/** Phantoms: Primary entries always; Secondary entries at or above the admin-set Impact. */
async function phantomScope(c: C, stream: Stream, schema: TrackerSchema): Promise<Scope> {
  if (stream === "primary") return { stream };
  const { phantoms } = await loadSettings(c.env, P(c).tenantId);
  const opts = getColumn(schema, CORE.impact)?.options ?? [];
  const at = opts.indexOf(phantoms.secondaryMinImpact);
  return { stream, impacts: opts.slice(at >= 0 ? at : Math.min(1, Math.max(0, opts.length - 1))) };
}

async function todayFor(c: C): Promise<string> {
  const s = await loadSettings(c.env, P(c).tenantId);
  try {
    return todayIso(new Date(), s.timezone);
  } catch {
    return todayIso(new Date(), "UTC");
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

app.get("/api/me", async (c) => {
  const p = P(c);
  const s = await loadSettings(c.env, p.tenantId);
  return c.json({
    user: { id: p.userId, email: p.email, name: p.name },
    tenant: { id: p.tenantId, name: p.tenantName },
    role: p.role,
    tenants: p.tenants,
    permissions: ACTIONS.filter((a) => can(p.role, a)),
    contractVersion: CONTRACT_VERSION,
    environment: c.env.ENVIRONMENT,
    timezone: s.timezone,
    features: { prefill: prefillMode(c.env) },
  });
});

app.post("/api/me/sessions/revoke", async (c) => {
  const p = P(c);
  return c.json(await revokeSessions(c.env, p, p.userId));
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

app.get("/api/schema", async (c) => {
  // ?stream=all: both column sets merged (read-only; used by the Dashboard).
  if (c.req.query("stream") === "all") return c.json(await mergedSchema(c));
  const stream = streamOf(c);
  const schema = await schemaFor(c, stream);
  const p = P(c);
  if (can(p.role, "schema:edit") && c.req.query("usage") === "1") {
    return c.json({ ...schema, usage: await optionUsageMap(c.env, p.tenantId, stream, schema) });
  }
  return c.json(schema);
});

async function schemaChanged(c: C, stream: Stream, details: Record<string, unknown>) {
  const p = P(c);
  await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "schema.changed", targetType: "schema", details: { stream, ...details } });
  const schema = await schemaFor(c, stream);
  return c.json({ ...schema, usage: await optionUsageMap(c.env, p.tenantId, stream, schema) });
}

app.post("/api/schema/columns", async (c) => {
  requirePermission(P(c), "schema:edit");
  const b = await body(c, AddColumnRequest);
  const stream = streamOf(c);
  const r = await addColumn(c.env, P(c).tenantId, stream, b.label, b.type);
  return schemaChanged(c, stream, { op: "add_column", key: r.key, type: b.type });
});

// Registered before "/api/schema/columns/:key" routes; PUT is used only here.
app.put("/api/schema/columns/order", async (c) => {
  requirePermission(P(c), "schema:edit");
  const b = await body(c, ReorderColumnsRequest);
  const stream = streamOf(c);
  await reorderColumns(c.env, P(c).tenantId, stream, b.keys);
  return schemaChanged(c, stream, { op: "reorder_columns", keys: b.keys });
});

app.patch("/api/schema/columns/:key", async (c) => {
  requirePermission(P(c), "schema:edit");
  const b = await body(c, UpdateColumnRequest);
  const stream = streamOf(c);
  const r = await updateColumn(c.env, P(c).tenantId, stream, c.req.param("key"), b);
  return schemaChanged(c, stream, { op: "update_column", key: c.req.param("key"), renamed: r.before.label !== r.after.label, required: r.after.required, inTracker: r.after.inTracker });
});

app.delete("/api/schema/columns/:key", async (c) => {
  requirePermission(P(c), "schema:edit");
  const stream = streamOf(c);
  await deleteColumn(c.env, P(c).tenantId, stream, c.req.param("key"));
  return schemaChanged(c, stream, { op: "delete_column", key: c.req.param("key") });
});

app.post("/api/schema/columns/:key/options", async (c) => {
  requirePermission(P(c), "schema:edit");
  const b = await body(c, AddOptionRequest);
  const stream = streamOf(c);
  await addOption(c.env, P(c).tenantId, stream, c.req.param("key"), b.value, b.parent);
  return schemaChanged(c, stream, { op: "add_option", key: c.req.param("key") });
});

app.patch("/api/schema/columns/:key/options", async (c) => {
  requirePermission(P(c), "schema:edit");
  const b = await body(c, RenameOptionRequest);
  const stream = streamOf(c);
  await renameOption(c.env, P(c).tenantId, stream, c.req.param("key"), b.from, b.to);
  return schemaChanged(c, stream, { op: "rename_option", key: c.req.param("key") });
});

app.put("/api/schema/columns/:key/options/order", async (c) => {
  requirePermission(P(c), "schema:edit");
  const b = await body(c, ReorderOptionsRequest);
  const stream = streamOf(c);
  await reorderOptions(c.env, P(c).tenantId, stream, c.req.param("key"), b.values, b.parent);
  return schemaChanged(c, stream, { op: "reorder_options", key: c.req.param("key"), parent: b.parent ?? null });
});

app.delete("/api/schema/columns/:key/options", async (c) => {
  requirePermission(P(c), "schema:edit");
  const b = await body(c, DeleteOptionRequest);
  const stream = streamOf(c);
  await deleteOption(c.env, P(c).tenantId, stream, c.req.param("key"), b.value);
  return schemaChanged(c, stream, { op: "delete_option", key: c.req.param("key") });
});

// ---------------------------------------------------------------------------
// Tracker, dashboard, trend test
// ---------------------------------------------------------------------------

function sortOf(c: C, schema: Awaited<ReturnType<typeof loadSchema>>) {
  const key = c.req.query("sort") ?? "date";
  const dir = c.req.query("dir") === "asc" ? "asc" : "desc";
  return { key: getColumn(schema, key) ? key : "date", dir } as const;
}

async function tablePage(c: C, view: "tracker" | "phantoms") {
  requirePermission(P(c), "tracker:read");
  const stream = streamOf(c);
  const schema = await schemaFor(c, stream);
  const scope = view === "phantoms" ? await phantomScope(c, stream, schema) : { stream };
  const url = new URL(c.req.url);
  const f = filtersFromParams(url.searchParams, { schema, today: await todayFor(c) });
  const page = Math.max(0, Number.parseInt(c.req.query("page") ?? "0", 10) || 0);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(c.req.query("pageSize") ?? "10", 10) || 10));
  return c.json(await trackerPage(c.env, schema, P(c).tenantId, f, sortOf(c, schema), page, pageSize, scope));
}

app.get("/api/tracker", (c) => tablePage(c, "tracker"));
app.get("/api/phantoms", (c) => tablePage(c, "phantoms"));

app.get("/api/tracker/export", async (c) => {
  const p = P(c);
  requirePermission(p, "tracker:export");
  const stream = streamOf(c);
  const schema = await schemaFor(c, stream);
  const view = c.req.query("view") === "phantoms" ? "phantoms" : "tracker";
  const rowScope = view === "phantoms" ? await phantomScope(c, stream, schema) : { stream };
  const format = (c.req.query("format") ?? "csv") as ExportFormat;
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw badRequest("Unknown export format");
  const scope = c.req.query("scope") === "all" ? "all" : "filtered";
  const today = await todayFor(c);
  const url = new URL(c.req.url);
  const f = scope === "all" ? null : filtersFromParams(url.searchParams, { schema, today });
  const rows = await exportRows(c.env, schema, p.tenantId, f, sortOf(c, schema), rowScope);
  const table = toTable(schema, rows);
  const content: string | Uint8Array =
    format === "csv" ? toCsv(table) : format === "tsv" ? toTsv(table) : format === "json" ? toJson(schema, rows) : toXlsx(table);
  await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "export.created", targetType: "tracker", details: { format, scope, rows: rows.length, stream, view } });
  return new Response(content, {
    headers: {
      "Content-Type": EXPORT_MIME[format],
      "Content-Disposition": `attachment; filename="${exportFilename(scope, format, today, { stream, name: view })}"`,
      "X-Export-Rows": String(rows.length),
      "Cache-Control": "no-store",
    },
  });
});

app.get("/api/signals/:id", async (c) => {
  requirePermission(P(c), "tracker:read");
  return c.json(await signalDetail(c.env, await schemasFor(c), P(c).tenantId, c.req.param("id")));
});

/** The Phantoms Markdown for an entry (inline for the side panel, or ?download=1 as a file). */
app.get("/api/signals/:id/markdown", async (c) => {
  const p = P(c);
  requirePermission(p, "tracker:read");
  const md = await signalMarkdown(c.env, await schemasFor(c), p.tenantId, c.req.param("id"));
  const download = c.req.query("download") === "1";
  if (download) {
    await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "markdown.downloaded", targetType: "item", targetId: c.req.param("id"), details: { code: md.code, file: md.fileName } });
  }
  return new Response(md.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${md.fileName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

app.post("/api/signals/:id/revise", async (c) => {
  requirePermission(P(c), "item:edit");
  const b = await body(c, ReviseRequest);
  const schemas = await schemasFor(c);
  await revise(c.env, schemas, P(c), c.req.param("id"), b.values, b.note);
  return c.json(await signalDetail(c.env, schemas, P(c).tenantId, c.req.param("id")));
});

app.get("/api/dashboard", async (c) => {
  requirePermission(P(c), "dashboard:read");
  const schema = await mergedSchema(c);
  const f = filtersFromParams(new URL(c.req.url).searchParams, { schema, today: await todayFor(c) });
  return c.json(await dashboard(c.env, schema, P(c).tenantId, f));
});

app.post("/api/trend-test", async (c) => {
  requirePermission(P(c), "dashboard:read");
  const cfg = await body(c, TrendConfigSchema);
  if (cfg.from > cfg.to) throw badRequest("Date from must be on or before Date to");
  return c.json(await trendTest(c.env, await mergedSchema(c), P(c).tenantId, cfg));
});

// ---------------------------------------------------------------------------
// Submissions and Inbox
// ---------------------------------------------------------------------------

app.post("/api/submissions", async (c) => {
  const p = P(c);
  requirePermission(p, "submission:create");
  if (c.env.SUBMIT_LIMITER) {
    const { success } = await c.env.SUBMIT_LIMITER.limit({ key: p.userId });
    if (!success) throw new ApiError("RATE_LIMITED", "Too many submissions. Please wait a minute and try again.");
  }
  const schemas = await schemasFor(c);
  const idem = c.req.header("idempotency-key")?.slice(0, 100) ?? null;
  const type = c.req.header("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const len = Number(c.req.header("content-length") ?? "0");
    if (len > CAPTURE_LIMITS.maxBytes + 64 * 1024) throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds the ${CAPTURE_LIMITS.maxBytes / 1048576} MB limit`);
    const form = await c.req.formData();
    const file = form.get("file") as unknown as File | string | null;
    if (!file || typeof file === "string") throw badRequest("Attach an HTML file in the “file” field");
    const stream = streamOf(c, (form.get("stream") as string | null) ?? c.req.query("stream"));
    const r = await submitFile(c.env, ctxOf(c), schemas, p, { name: file.name, bytes: await file.arrayBuffer(), type: file.type }, idem, stream);
    return c.json(r, r.duplicate ? 200 : 201);
  }
  const b = await body(c, CreateSubmissionRequest);
  const r = await submitUrl(c.env, ctxOf(c), schemas, p, b.url, idem, b.stream);
  return c.json(r, r.duplicate ? 200 : 201);
});

/** One-off spreadsheet import into a stream's Tracker (the dashboard parses the file and sends rows). */
app.post("/api/import", async (c) => {
  const p = P(c);
  requirePermission(p, "submission:create");
  requirePermission(p, "item:review");
  const b = await body(c, ImportRequest);
  if (!b.dryRun && b.rows.length > IMPORT_CHUNK_ROWS) throw badRequest(`Send at most ${IMPORT_CHUNK_ROWS} rows per import request`);
  return c.json(await importRows(c.env, await schemasFor(c), p, streamOf(c), b.fileName, b.rows, !!b.dryRun));
});

/** Attach the saved HTML page to a tracker entry that has none (e.g. an imported row). */
app.post("/api/items/:id/snapshot", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  const len = Number(c.req.header("content-length") ?? "0");
  if (len > CAPTURE_LIMITS.maxBytes + 64 * 1024) throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds the ${CAPTURE_LIMITS.maxBytes / 1048576} MB limit`);
  const form = await c.req.formData();
  const file = form.get("file") as unknown as File | string | null;
  if (!file || typeof file === "string") throw badRequest("Attach an HTML file in the “file” field");
  return c.json(await attachSnapshot(c.env, p, c.req.param("id"), { name: file.name, bytes: await file.arrayBuffer(), type: file.type }));
});

app.get("/api/capture-log", async (c) => {
  requirePermission(P(c), "submission:create");
  const res = await c.env.DB.prepare(
    "SELECT l.id, l.at, l.input, l.final_url, l.outcome, l.ok, l.item_id, i.stream FROM capture_log l LEFT JOIN intelligence_items i ON i.id = l.item_id WHERE l.tenant_id = ?1 ORDER BY l.at DESC LIMIT 100",
  )
    .bind(P(c).tenantId)
    .all<{ id: string; at: string; input: string; final_url: string | null; outcome: string; ok: number; item_id: string | null; stream: Stream | null }>();
  return c.json((res.results ?? []).map((r) => ({ id: r.id, at: r.at, input: r.input, finalUrl: r.final_url, outcome: r.outcome, ok: !!r.ok, itemId: r.item_id, stream: r.stream })));
});

app.get("/api/items", async (c) => {
  requirePermission(P(c), "inbox:read");
  const requested = (c.req.query("status") ?? "").split(",").filter(Boolean);
  const statuses = (requested.length ? requested : ITEM_STATUSES.filter((s) => s !== "deleted")).filter((s): s is ItemStatus =>
    (ITEM_STATUSES as readonly string[]).includes(s),
  );
  if (!statuses.length) throw badRequest("Unknown status");
  const stream = c.req.query("stream") ? streamOf(c) : null;
  return c.json(await listItems(c.env, await schemasFor(c), P(c).tenantId, statuses, stream));
});

// Registered before "/api/items/:id". Items awaiting the analyst, per inbox (the red badges).
app.get("/api/items/counts", async (c) => {
  requirePermission(P(c), "inbox:read");
  return c.json(await inboxCounts(c.env, P(c).tenantId));
});

app.get("/api/items/:id", async (c) => {
  requirePermission(P(c), "inbox:read");
  return c.json(await getDetail(c.env, await schemasFor(c), P(c).tenantId, c.req.param("id")));
});

app.get("/api/items/:id/snapshot", async (c) => {
  const p = P(c);
  const row = await getItemRow(c.env, p.tenantId, c.req.param("id"));
  // Clients may only see the snapshot of a published (approved) signal.
  if (!can(p.role, "inbox:read") && row.status !== "approved") throw notFound("Item");
  if (!row.current_snapshot_id) throw notFound("Snapshot");
  const html = await readSnapshot(c.env, p.tenantId, row.current_snapshot_id);
  if (html == null) throw notFound("Snapshot");
  const download = c.req.query("download") === "1";
  if (download) {
    await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "snapshot.downloaded", targetType: "item", targetId: row.id, details: { code: row.code } });
  }
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Inert rendering: sandboxed, no scripts, no network requests.
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, no-store",
      "Content-Disposition": download ? `attachment; filename="${row.code}-source.html"` : "inline",
    },
  });
});

app.patch("/api/items/:id/draft", async (c) => {
  requirePermission(P(c), "item:edit");
  const b = await body(c, SaveDraftRequest);
  return c.json(await saveDraft(c.env, await schemasFor(c), P(c), c.req.param("id"), b.values, b.version));
});

app.post("/api/items/:id/approve", async (c) => {
  requirePermission(P(c), "item:review");
  const b = await body(c, ApproveRequest);
  return c.json(await approve(c.env, await schemasFor(c), P(c), c.req.param("id"), b.values, b.version, b.note, b.overrideDuplicate ?? false));
});

app.post("/api/items/:id/reject", async (c) => {
  requirePermission(P(c), "item:review");
  const b = await body(c, RejectRequest);
  return c.json(await reject(c.env, await schemasFor(c), P(c), c.req.param("id"), b.reason, b.version));
});

app.post("/api/items/:id/reprocess", async (c) => {
  requirePermission(P(c), "item:review");
  const b = await body(c, ReprocessRequest);
  return c.json(await reprocess(c.env, ctxOf(c), await schemasFor(c), P(c), c.req.param("id"), b.version));
});

app.delete("/api/items/:id", async (c) => {
  requirePermission(P(c), "item:delete");
  // The body is optional (older dashboards send none).
  const raw = await c.req.text();
  const b = raw.trim() ? await body(c, DeleteItemRequest) : {};
  return c.json(await softDelete(c.env, await schemasFor(c), P(c), c.req.param("id"), b.reason));
});

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

app.get("/api/views", async (c) => {
  const p = P(c);
  const res = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.kind, v.state_json, v.created_at, v.shared, u.name AS owner FROM saved_views v JOIN users u ON u.id = v.user_id
      WHERE v.tenant_id = ?1 AND v.deleted_at IS NULL AND (v.user_id = ?2 OR v.shared = 1) ORDER BY v.created_at DESC LIMIT 200`,
  )
    .bind(p.tenantId, p.userId)
    .all<{ id: string; name: string; kind: string; state_json: string; created_at: string; shared: number; owner: string }>();
  return c.json((res.results ?? []).map((v) => ({ id: v.id, name: v.name, kind: v.kind, state: JSON.parse(v.state_json), createdAt: v.created_at, shared: !!v.shared, owner: v.owner })));
});

app.post("/api/views", async (c) => {
  const p = P(c);
  requirePermission(p, "savedView:write");
  const b = await body(c, CreateSavedViewRequest);
  const id = newId("view");
  const now = nowIso();
  await c.env.DB.prepare("INSERT INTO saved_views (id, tenant_id, user_id, name, kind, state_json, shared, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
    .bind(id, p.tenantId, p.userId, b.name.trim(), b.kind, JSON.stringify(b.state), b.shared ? 1 : 0, now)
    .run();
  await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "view.saved", targetType: "view", targetId: id, details: { kind: b.kind, shared: b.shared } });
  return c.json({ id, name: b.name.trim(), kind: b.kind, state: b.state, createdAt: now, shared: b.shared, owner: p.name }, 201);
});

app.delete("/api/views/:id", async (c) => {
  const p = P(c);
  const r = await c.env.DB.prepare("UPDATE saved_views SET deleted_at = ?1 WHERE tenant_id = ?2 AND id = ?3 AND (user_id = ?4 OR ?5 = 1) AND deleted_at IS NULL")
    .bind(nowIso(), p.tenantId, c.req.param("id"), p.userId, p.role === "admin" ? 1 : 0)
    .run();
  if (!r.meta.changes) throw notFound("Saved view");
  await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "view.deleted", targetType: "view", targetId: c.req.param("id") });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Settings (visible to all users; editable by admins)
// ---------------------------------------------------------------------------

app.get("/api/settings", async (c) => c.json(await loadSettings(c.env, P(c).tenantId)));

app.patch("/api/settings", async (c) => {
  const p = P(c);
  requirePermission(p, "settings:edit");
  const b = await body(c, UpdateSettingsRequest);
  if (b.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: b.timezone });
    } catch {
      throw new ApiError("VALIDATION", "Unknown time zone");
    }
  }
  if (b.phantoms) {
    // The threshold must be one of the Secondary inbox's Impact options.
    const opts = getColumn(await schemaFor(c, "secondary"), CORE.impact)?.options ?? [];
    if (!opts.includes(b.phantoms.secondaryMinImpact)) throw new ApiError("VALIDATION", `Choose one of the Secondary Impact options: ${opts.join(", ")}`);
  }
  const current = await loadSettings(c.env, p.tenantId);
  const next: TenantSettings = {
    ...current,
    ...b,
    trendDefaults: { ...current.trendDefaults, ...b.trendDefaults },
    retention: { ...current.retention, ...b.retention },
    redaction: { ...current.redaction, ...b.redaction },
    phantoms: { ...current.phantoms, ...b.phantoms },
  };
  await saveSettings(c.env, p.tenantId, next, p.userId);
  await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "settings.changed", targetType: "settings", details: { sections: Object.keys(b) } });
  return c.json(next);
});

// ---------------------------------------------------------------------------
// Users, audit, incidents, metrics
// ---------------------------------------------------------------------------

app.get("/api/users", async (c) => {
  requirePermission(P(c), "user:read");
  return c.json(await listUsers(c.env, P(c).tenantId));
});

app.post("/api/users", async (c) => {
  requirePermission(P(c), "user:create");
  const b = await body(c, CreateUserRequest);
  return c.json(await createUser(c.env, P(c), b), 201);
});

app.patch("/api/users/:id", async (c) => {
  const p = P(c);
  const b = await body(c, UpdateUserRequest);
  if (b.role !== undefined) requirePermission(p, "user:changeRole");
  if (b.active !== undefined) requirePermission(p, "user:deactivate");
  if (c.req.param("id") === p.userId && (b.active === false || (b.role && b.role !== p.role))) throw forbidden("You cannot deactivate or demote yourself");
  return c.json(await updateUser(c.env, p, c.req.param("id"), b));
});

app.post("/api/users/:id/invite", async (c) => {
  requirePermission(P(c), "user:create");
  return c.json(await createInvite(c.env, P(c), c.req.param("id")), 201);
});

app.post("/api/users/:id/sessions/revoke", async (c) => {
  requirePermission(P(c), "user:endSessions");
  return c.json(await revokeSessions(c.env, P(c), c.req.param("id")));
});

app.get("/api/audit", async (c) => {
  requirePermission(P(c), "audit:read");
  const before = c.req.query("before") ? Number(c.req.query("before")) : null;
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? "50") || 50));
  return c.json(await listAudit(c.env, P(c).tenantId, before, limit));
});

app.get("/api/audit/verify", async (c) => {
  requirePermission(P(c), "audit:read");
  return c.json(await verifyChain(c.env, P(c).tenantId));
});

app.get("/api/incidents", async (c) => {
  requirePermission(P(c), "incident:read");
  const res = await c.env.DB.prepare(
    "SELECT n.id, n.at, n.category, n.resolved_at, i.code FROM incidents n LEFT JOIN intelligence_items i ON i.id = n.item_id WHERE n.tenant_id = ?1 ORDER BY n.at DESC LIMIT 200",
  )
    .bind(P(c).tenantId)
    .all<{ id: string; at: string; category: string; resolved_at: string | null; code: string | null }>();
  return c.json((res.results ?? []).map((r) => ({ id: r.id, at: r.at, category: r.category, itemCode: r.code, resolved: !!r.resolved_at })));
});

app.post("/api/incidents/:id/resolve", async (c) => {
  const p = P(c);
  requirePermission(p, "incident:read");
  const r = await c.env.DB.prepare("UPDATE incidents SET resolved_at = ?1, resolved_by = ?2 WHERE tenant_id = ?3 AND id = ?4 AND resolved_at IS NULL").bind(nowIso(), p.userId, p.tenantId, c.req.param("id")).run();
  if (!r.meta.changes) throw notFound("Incident");
  await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "incident.resolved", targetType: "incident", targetId: c.req.param("id") });
  return c.json({ ok: true });
});

app.get("/api/notifications", async (c) => {
  requirePermission(P(c), "incident:read");
  const res = await c.env.DB.prepare("SELECT id, kind, message, created_at, read_at FROM notifications WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 50")
    .bind(P(c).tenantId)
    .all<{ id: string; kind: string; message: string; created_at: string; read_at: string | null }>();
  return c.json((res.results ?? []).map((n) => ({ id: n.id, kind: n.kind, message: n.message, at: n.created_at, read: !!n.read_at })));
});

app.get("/api/admin/config-status", async (c) => {
  requirePermission(P(c), "settings:edit");
  const e = c.env;
  const checks = [
    (() => {
      if (e.AUTH_MODE !== "entra") return { key: "auth", ok: false, message: "Development sign-in (AUTH_MODE=dev) — not for real users" };
      const cfg = entraConfigured(e);
      const scope = allowedTenants(e).length ? `${allowedTenants(e).length} allowed organisation(s)` : "any organisation";
      return { key: "auth", ok: cfg.ok, message: cfg.ok ? `Sign in with Microsoft configured (${scope})` : `Sign in with Microsoft needs attention: ${[...cfg.missing.map((m) => `${m} missing`), ...cfg.problems].join("; ")} (docs/SIGN-IN-ENTRA.md)` };
    })(),
    prefillMode(e) === "manual"
      ? { key: "llm", ok: true, message: "Manual entry: drafts arrive with every field empty; no external AI service is used (see docs/ENABLING-AUTOFILL.md to enable pre-fill)" }
      : e.LLM_PROVIDER === "mock"
        ? { key: "llm", ok: false, message: "Pre-fill uses the offline mock heuristics (set LLM_PROVIDER=anthropic or none)" }
        : { key: "llm", ok: !!e.ANTHROPIC_API_KEY, message: e.ANTHROPIC_API_KEY ? "LLM pre-fill: Claude API key configured" : "LLM pre-fill enabled but ANTHROPIC_API_KEY is not set" },
    { key: "capture", ok: !!e.CAPTURE, message: "Isolated capture worker bound" },
    { key: "queue", ok: !!e.JOBS, message: "Background work queue bound" },
    { key: "snapshots", ok: true, message: snapshotBackend(e) === "r2" ? "Snapshots stored in R2" : "Snapshots stored in D1 (Workers Free plan)" },
    { key: "encryption", ok: !!e.SNAPSHOT_ENCRYPTION_KEY, message: "Application-level snapshot encryption key set" },
    { key: "audit", ok: !!e.AUDIT_HMAC_KEY, message: "Audit HMAC key set" },
    { key: "alerts", ok: !!e.ALERT_WEBHOOK_URL, message: "Operational alert webhook configured" },
  ];
  return c.json({ environment: e.ENVIRONMENT, model: e.LLM_MODEL, provider: e.LLM_PROVIDER, prefill: prefillMode(e), checks });
});

app.get("/api/metrics/quality", async (c) => {
  requirePermission(P(c), "metrics:read");
  return c.json(await qualityMetrics(c.env, await mergedSchema(c), P(c).tenantId));
});
