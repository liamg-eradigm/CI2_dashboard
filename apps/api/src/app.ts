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
  CreateManualRequest,
  CreateNewsletterRequest,
  GenerateDiscussionSummaryRequest,
  GenerateNewsletterRequest,
  UpdateDiscussionSummaryRequest,
  DOCX_MIME,
  GenerateTrendSummaryRequest,
  CreateCommentRequest,
  UpdateCommentRequest,
  VersionRequest,
  UpdateTrendSummaryRequest,
  CreateTrendAnalysisRequest,
  ImportTrendAnalysesRequest,
  SubmitMacroSectionsRequest,
  UpdateMacroSectionRequest,
  normaliseNavOrder,
  normaliseMenu,
  ClearDecidedRequest,
  SplitRequest,
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
  SetTextSizeRequest,
  MAX_TEXT_SIZES,
  UpdateUserRequest,
  CORE,
  TABLE_ALL_MAX,
  can,
  exportFilename,
  isStream,
  mergeSchemas,
  phantomColumns,
  trackerColumns,
  sortedColumns,
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
import { bumpDataVersion, cacheGet, cachePut, dataVersion, memo, type DataVersions } from "./lib/cache.js";
import { ApiError, badRequest, forbidden, notFound } from "./lib/errors.js";
import { newId, nowIso } from "./lib/ids.js";
import { log, metric } from "./lib/log.js";
import { prefillMode } from "./pipeline/prefill.js";
import { readSnapshot, snapshotBackend } from "./pipeline/snapshots.js";
import { audit, listAudit, verifyChain } from "./services/audit.js";
import { clientInboxCount, getDetail, getItemRow, inboxCounts, listItems } from "./services/items.js";
import { qualityMetrics } from "./services/metrics.js";
import { archivedResponses, dashboard, dateBounds, distinctTextValues, exportRows, trackerPage, trendTest, type Scope } from "./services/query.js";
import { approve, clearDecided, deleteFromTable, reject, splitItem, reprocess, revise, saveDraft, softDelete } from "./services/review.js";
import {
  addColumn,
  addOption,
  deleteColumn,
  deleteOption,
  loadSchema,
  loadSettings,
  optionUsageMap,
  renameOption,
  reorderColumns,
  reorderOptions,
  saveSettings,
  updateColumn,
  type Schemas,
} from "./services/schema.js";
import { primarySources, signalDetail, signalMarkdown } from "./services/signals.js";
import { attachSnapshot, importRows } from "./services/imports.js";
import { submitFile, submitManual, submitUrl } from "./services/submissions.js";
import { competitors, generateSummary, megatrends, writeSummary } from "./services/megatrends.js";
import {
  createTrendAnalysis,
  deleteTrendAnalysis,
  importMacroSections,
  importTrendAnalyses,
  listMacroSections,
  listTrendAnalyses,
  submitMacroSections,
  trendAnalysisFile,
  updateMacroSection,
} from "./services/trendAnalyses.js";
import { listPages, pageSnapshotId } from "./services/pages.js";
import { addComment, backToEradigm, clientPush, listComments, sendToClient, updateComment } from "./services/clientInbox.js";
import { createNewsletter, databaseExtras, deleteDeliverable, ensureAlerts, generateNewsletter, listNewsletters, readDeliverable } from "./services/deliverables.js";
import { getDiscussionSummary, regenerateDiscussionSummary, writeDiscussionSummary } from "./services/discussionSummaries.js";
import { createInvite, createUser, listUsers, revokeSessions, updateUser } from "./services/users.js";

type Vars = { principal: Principal; requestId: string; dataVersion?: DataVersions };
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
  // Anything but a read may have changed the workspace: answers cached before are no longer used
  // (whether it succeeded or not, so a partial change is never hidden).
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    // The route of the handler that ran (the last match that is not a middleware).
    const handler = c.req.matchedRoutes.filter((r) => r.method !== "ALL").pop();
    const route = `${c.req.method} ${handler?.path ?? c.req.path}`;
    if (!READ_ONLY_POSTS.has(route)) await bumpDataVersion(c.env, p.tenantId, INBOX_ONLY.has(route) ? "inbox" : "all");
  }
});

/** POSTs that only read (nothing to bump). */
const READ_ONLY_POSTS = new Set(["POST /api/trend-test"]);
/**
 * Changes that never reach the Tracker, Phantoms, Dashboard, Megatrends or
 * Competitors (entries still in the Inbox, comments, saved views, users):
 * they leave Tracker-side reads cached. Anything not listed counts as both.
 */
const INBOX_ONLY = new Set([
  "POST /api/submissions",
  "POST /api/submissions/manual",
  "PATCH /api/items/:id/draft",
  "POST /api/items/:id/split",
  "POST /api/items/:id/reject",
  "POST /api/items/:id/reprocess",
  "POST /api/items/:id/send-to-client",
  "POST /api/items/:id/recall",
  "POST /api/client-inbox/:id/send-to-eradigm",
  "POST /api/items/clear-decided",
  "POST /api/items/:id/comments",
  "PATCH /api/items/:id/comments/:cid",
  "DELETE /api/items/:id/comments/:cid",
  "POST /api/views",
  "DELETE /api/views/:id",
  "POST /api/me/sessions/revoke",
  "POST /api/users",
  "PATCH /api/users/:id",
  "POST /api/users/:id/invite",
  "POST /api/users/:id/sessions/revoke",
  "POST /api/incidents/:id/resolve",
]);

/** The workspace's data versions, read once per request. */
async function versionsOf(c: C): Promise<DataVersions> {
  const have = c.get("dataVersion");
  if (have) return have;
  const v = await dataVersion(c.env, P(c).tenantId);
  c.set("dataVersion", v);
  return v;
}

/**
 * A read answered from memory while the workspace has not changed (its data
 * version, lib/cache.ts): one row read instead of the query's. Keyed by
 * workspace, version, role, day (for "today") and the full URL.
 */
async function cachedJson(c: C, make: () => Promise<unknown>, scope: "tracker" | "all" = "tracker"): Promise<Response> {
  const headers = { "content-type": "application/json; charset=UTF-8" };
  if (c.env.READ_CACHE === "off" || c.req.method !== "GET") return c.body(JSON.stringify(await make()), 200, headers);
  const p = P(c);
  const url = new URL(c.req.url);
  const ver = await versionsOf(c);
  // Tracker-side reads follow t; Inbox reads (which also show Tracker entries) follow every change (v).
  const key = `${p.tenantId}|${scope === "tracker" ? `t${ver.t}` : `v${ver.v}`}|${p.role}|${new Date().toISOString().slice(0, 10)}|${url.pathname}?${url.searchParams.toString()}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return c.body(hit, 200, { ...headers, "X-Read-Cache": "hit" });
  const text = JSON.stringify(await make());
  cachePut(key, text);
  return c.body(text, 200, { ...headers, "X-Read-Cache": "miss" });
}

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

/** A stream's column set, kept in memory while the workspace has not changed (a copy each time: callers may change it). */
async function schemaFor(c: C, stream: Stream = streamOf(c)) {
  // Requests that change things always read the current columns (and may be changing them).
  if (c.env.READ_CACHE === "off" || c.req.method !== "GET") return loadSchema(c.env, P(c).tenantId, stream);
  const t = P(c).tenantId;
  return structuredClone(await memo(`schema|${t}|${(await versionsOf(c)).t}|${stream}`, () => loadSchema(c.env, t, stream)));
}

async function schemasFor(c: C): Promise<Schemas> {
  const [primary, secondary] = await Promise.all([schemaFor(c, "primary"), schemaFor(c, "secondary")]);
  return { primary, secondary };
}

/** Both streams as one read-only schema: the Dashboard covers every source. */
async function mergedSchema(c: C) {
  const s = await schemasFor(c);
  return mergeSchemas(s.primary, s.secondary);
}

/** Phantoms: Primary entries always; Secondary entries at or above the admin-set Impact. */
async function phantomScope(c: C, stream: Stream, schema: TrackerSchema): Promise<Scope> {
  if (stream === "primary") return { stream, table: "phantoms" };
  const { phantoms } = await loadSettings(c.env, P(c).tenantId);
  const opts = getColumn(schema, CORE.impact)?.options ?? [];
  const at = opts.indexOf(phantoms.secondaryMinImpact);
  return { stream, impacts: opts.slice(at >= 0 ? at : 0), table: "phantoms" };
}

/** database: the Database page (request 43), every Tracker entry of a stream with every field. */
type TableView = "tracker" | "phantoms" | "alerts" | "newsletter" | "database";
const TABLE_VIEWS: readonly TableView[] = ["tracker", "phantoms", "alerts", "newsletter", "database"];

/**
 * Deliverables are built from Phantoms: Alerts from those with the highest
 * Impact (High), the Newsletter from the two highest (High, Medium).
 */
async function deliverableScope(c: C, stream: Stream, schema: TrackerSchema, kind: "alerts" | "newsletter"): Promise<Scope> {
  const sc = await phantomScope(c, stream, schema);
  const opts = getColumn(schema, CORE.impact)?.options ?? [];
  const want = opts.slice(kind === "alerts" ? -1 : -2);
  return { ...sc, impacts: sc.impacts ? sc.impacts.filter((i) => want.includes(i)) : want, ...(kind === "alerts" ? { withoutDeletedAlerts: true } : {}) };
}

async function scopeFor(c: C, view: TableView, stream: Stream, schema: TrackerSchema): Promise<Scope> {
  if (view === "phantoms") return phantomScope(c, stream, schema);
  if (view === "alerts" || view === "newsletter") return deliverableScope(c, stream, schema, view);
  return { stream };
}

/** Filters from the query string; missing dates default to everything in view (oldest entry → today). */
async function filtersOf(c: C, schema: TrackerSchema, today?: string) {
  const params = new URL(c.req.url).searchParams;
  const bounds = params.get("from") && params.get("to") ? null : await dateBounds(c.env, P(c).tenantId);
  return filtersFromParams(params, { schema, today: today ?? (await todayFor(c)), bounds });
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
  await reorderColumns(c.env, P(c).tenantId, stream, b.keys, b.table);
  return schemaChanged(c, stream, { op: "reorder_columns", table: b.table, keys: b.keys });
});

app.patch("/api/schema/columns/:key", async (c) => {
  requirePermission(P(c), "schema:edit");
  const b = await body(c, UpdateColumnRequest);
  const stream = streamOf(c);
  const r = await updateColumn(c.env, P(c).tenantId, stream, c.req.param("key"), b);
  return schemaChanged(c, stream, { op: "update_column", key: c.req.param("key"), renamed: r.before.label !== r.after.label, required: r.after.required, inTracker: r.after.inTracker, inPhantoms: r.after.inPhantoms, type: r.after.type });
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

async function tablePage(c: C, view: TableView) {
  requirePermission(P(c), "tracker:read");
  const stream = streamOf(c);
  const schema = await schemaFor(c, stream);
  const scope = await scopeFor(c, view, stream, schema);
  const f = await filtersOf(c, schema);
  const page = Math.max(0, Number.parseInt(c.req.query("page") ?? "0", 10) || 0);
  // "Display all" asks for up to TABLE_ALL_MAX rows on one page.
  const pageSize = Math.min(TABLE_ALL_MAX, Math.max(1, Number.parseInt(c.req.query("pageSize") ?? "10", 10) || 10));
  // Each alert row carries its .docx, created (or refreshed after a revision) on first sight (a write: never cached).
  if (view === "alerts") {
    const result = await trackerPage(c.env, schema, P(c).tenantId, f, sortOf(c, schema), page, pageSize, scope);
    result.rows = await ensureAlerts(c.env, P(c).tenantId, result.rows);
    return c.json(result);
  }
  // The Database page: each row also says whether it is in Phantoms, carries its alert (request 51: every
  // entry has one) and the newsletters it is in (creates alerts: never cached).
  if (view === "database") {
    const result = await trackerPage(c.env, schema, P(c).tenantId, f, sortOf(c, schema), page, pageSize, scope);
    const phantoms = await phantomScope(c, stream, schema);
    result.rows = await databaseExtras(c.env, P(c).tenantId, result.rows, phantoms.impacts ?? null);
    return c.json(result);
  }
  return cachedJson(c, () => trackerPage(c.env, schema, P(c).tenantId, f, sortOf(c, schema), page, pageSize, scope));
}

app.get("/api/tracker/bounds", async (c) => {
  requirePermission(P(c), "tracker:read");
  return cachedJson(c, () => dateBounds(c.env, P(c).tenantId));
});
app.get("/api/tracker", (c) => tablePage(c, "tracker"));
app.get("/api/phantoms", (c) => tablePage(c, "phantoms"));

/** Primary entries with a source, for the "prior primary information" flag in the Inbox. */
app.get("/api/primary-sources", async (c) => {
  requirePermission(P(c), "tracker:read");
  return cachedJson(c, () => primarySources(c.env, P(c).tenantId));
});
/** The values of text columns among a stream's Tracker entries (Analytics → Primary Tracker's filter dropdowns, request 41). */
app.get("/api/tracker/values", async (c) => {
  requirePermission(P(c), "tracker:read");
  const stream = streamOf(c);
  const keys = (c.req.queries("key") ?? []).slice(0, 8);
  const schema = await schemaFor(c, stream);
  return cachedJson(c, () => distinctTextValues(c.env, schema, P(c).tenantId, stream, keys));
});
app.get("/api/deliverables/alerts", (c) => tablePage(c, "alerts"));
app.get("/api/database", (c) => tablePage(c, "database"));
app.get("/api/deliverables/newsletter", (c) => tablePage(c, "newsletter"));

// ---------------------------------------------------------------------------
// Megatrends: entries per Macrotrend / Subtrend, their summaries, the timeline
// ---------------------------------------------------------------------------

app.get("/api/megatrends", async (c) => {
  requirePermission(P(c), "tracker:read");
  const raw = c.req.query("stream") ?? "all";
  if (raw !== "all" && !isStream(raw)) throw badRequest("stream must be “all”, “primary” or “secondary”");
  const date = (k: "from" | "to") => {
    const v = c.req.query(k);
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`${k} must be YYYY-MM-DD`);
    return v;
  };
  const range = { stream: raw as "all" | Stream, from: date("from"), to: date("to") };
  return cachedJson(c, () => megatrends(c.env, P(c).tenantId, range, prefillMode(c.env) === "llm"));
});

// Competitors: entries per competitor named, co-occurrence, summaries, the timeline.
app.get("/api/competitors", async (c) => {
  requirePermission(P(c), "tracker:read");
  const raw = c.req.query("stream") ?? "all";
  if (raw !== "all" && !isStream(raw)) throw badRequest("stream must be “all”, “primary” or “secondary”");
  return cachedJson(c, () => competitors(c.env, P(c).tenantId, raw, prefillMode(c.env) === "llm"));
});

app.put("/api/megatrends/summaries", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  return c.json(await writeSummary(c.env, p, await body(c, UpdateTrendSummaryRequest)));
});

app.post("/api/megatrends/summaries/generate", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  const b = await body(c, GenerateTrendSummaryRequest);
  if (prefillMode(c.env) !== "llm") {
    throw new ApiError("CONFLICT", "The AI writer is not connected yet (set LLM_PROVIDER and ANTHROPIC_API_KEY on the API). Write the summary by hand for now.");
  }
  return c.json(await generateSummary(c.env, p, b, await todayFor(c)));
});

// Trend Analyses (contract 1.18): analyses submitted on the Input page, kept as Markdown files.
app.get("/api/trend-analyses", async (c) => {
  requirePermission(P(c), "tracker:read");
  return cachedJson(c, () => listTrendAnalyses(c.env, P(c).tenantId));
});

app.post("/api/trend-analyses", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  const b = await body(c, CreateTrendAnalysisRequest);
  return c.json(await createTrendAnalysis(c.env, p, await schemasFor(c), b), 201);
});

app.post("/api/trend-analyses/import", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  const b = await body(c, ImportTrendAnalysesRequest);
  return c.json(await importTrendAnalyses(c.env, p, await schemasFor(c), b));
});

// A Macrotrend's analysis by section (request 34): the Macrotrend dashboards' text cells.
app.post("/api/trend-analyses/macrotrend", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  const b = await body(c, SubmitMacroSectionsRequest);
  return c.json(await submitMacroSections(c.env, p, await schemasFor(c), b), 201);
});

app.post("/api/trend-analyses/macrotrend/import", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  const b = await body(c, ImportTrendAnalysesRequest);
  return c.json(await importMacroSections(c.env, p, await schemasFor(c), b));
});

app.get("/api/macrotrends/sections", async (c) => {
  requirePermission(P(c), "tracker:read");
  return cachedJson(c, () => listMacroSections(c.env, P(c).tenantId));
});

app.put("/api/macrotrends/sections", async (c) => {
  const p = P(c);
  // Edited in place by admins only (analysts submit on the Input page).
  requirePermission(p, "settings:edit");
  const b = await body(c, UpdateMacroSectionRequest);
  return c.json(await updateMacroSection(c.env, p, await schemasFor(c), b));
});

app.get("/api/trend-analyses/:id/markdown", async (c) => {
  const p = P(c);
  requirePermission(p, "tracker:read");
  const md = await trendAnalysisFile(c.env, p.tenantId, c.req.param("id"));
  const download = c.req.query("download") === "1";
  if (download) {
    await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "markdown.downloaded", targetType: "trend_analysis", targetId: md.analysis.id, details: { file: md.fileName } });
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

app.delete("/api/trend-analyses/:id", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  await deleteTrendAnalysis(c.env, p, c.req.param("id"));
  return c.json({ ok: true as const });
});

app.get("/api/newsletters", async (c) => {
  requirePermission(P(c), "tracker:read");
  return c.json(await listNewsletters(c.env, P(c).tenantId));
});

app.post("/api/newsletters", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  const b = await body(c, CreateNewsletterRequest);
  const schemas = await schemasFor(c);
  const scopes: Partial<Record<Stream, Scope>> = {};
  const n = await createNewsletter(c.env, p, b.name, b.itemIds, async (stream, impact) => {
    scopes[stream] ??= await deliverableScope(c, stream, schemas[stream], "newsletter");
    return !!impact && (scopes[stream]?.impacts ?? []).includes(impact);
  });
  return c.json(n, 201);
});

/** The Database page's Generate Newsletter (request 43): any Tracker entries, either stream. */
app.post("/api/newsletters/generate", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  const b = await body(c, GenerateNewsletterRequest);
  const s = await loadSettings(c.env, p.tenantId);
  return c.json(await generateNewsletter(c.env, p, b.itemIds, b.sections, s.timezone, (stream) => schemaFor(c, stream)), 201);
});

/** Delete an alert (its entry leaves the Alerts table; the Phantom stays) or a newsletter (request 36). */
app.delete("/api/deliverables/:id", async (c) => {
  const p = P(c);
  requirePermission(p, "item:delete");
  return c.json(await deleteDeliverable(c.env, p, c.req.param("id")));
});

/** A stored alert or newsletter .docx: inline for the side pane, or ?download=1 as a file. */
app.get("/api/deliverables/:id/docx", async (c) => {
  const p = P(c);
  requirePermission(p, "tracker:read");
  const d = await readDeliverable(c.env, p.tenantId, c.req.param("id"), (stream) => schemaFor(c, stream));
  const download = c.req.query("download") === "1";
  if (download) await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "deliverable.downloaded", targetType: "deliverable", targetId: c.req.param("id"), details: { kind: d.kind, file: d.fileName } });
  return new Response(d.bytes, {
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${d.fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.get("/api/tracker/export", async (c) => {
  const p = P(c);
  requirePermission(p, "tracker:export");
  const stream = streamOf(c);
  const schema = await schemaFor(c, stream);
  const view: TableView = TABLE_VIEWS.find((v) => v === c.req.query("view")) ?? "tracker";
  const rowScope = await scopeFor(c, view, stream, schema);
  const format = (c.req.query("format") ?? "csv") as ExportFormat;
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw badRequest("Unknown export format");
  const scope = c.req.query("scope") === "all" ? "all" : "filtered";
  const today = await todayFor(c);
  const f = scope === "all" ? null : await filtersOf(c, schema, today);
  const rows = await exportRows(c.env, schema, p.tenantId, f, sortOf(c, schema), rowScope);
  // Deliverables tables show the Phantoms columns; the Database page every field.
  const cols = view === "database" ? sortedColumns(schema) : view === "tracker" ? trackerColumns(schema) : phantomColumns(schema);
  const table = toTable(schema, rows, cols);
  const content: string | Uint8Array =
    format === "csv" ? toCsv(table) : format === "tsv" ? toTsv(table) : format === "json" ? toJson(schema, rows, cols) : toXlsx(table);
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

// The Primary Tracker's AI Summary (request 43) of an entry's Full Discussion, or (match=kiq) its KIQ Archive.
const discussionMode = (v: string | undefined) => (v === "kiq" ? "kiq" : "source");
app.get("/api/signals/:id/summary", async (c) => {
  const p = P(c);
  requirePermission(p, "tracker:read");
  const [schema, settings] = await Promise.all([schemaFor(c, "primary"), loadSettings(c.env, p.tenantId)]);
  return c.json(await getDiscussionSummary(c.env, p, schema, settings, c.req.param("id"), discussionMode(c.req.query("match")), prefillMode(c.env) === "llm"));
});
app.put("/api/signals/:id/summary", async (c) => {
  const p = P(c);
  // Edited by admins only.
  requirePermission(p, "settings:edit");
  const b = await body(c, UpdateDiscussionSummaryRequest);
  return c.json(await writeDiscussionSummary(c.env, p, await schemaFor(c, "primary"), c.req.param("id"), b.mode, b.text, prefillMode(c.env) === "llm"));
});
app.post("/api/signals/:id/summary/generate", async (c) => {
  const p = P(c);
  requirePermission(p, "settings:edit");
  const b = await body(c, GenerateDiscussionSummaryRequest);
  if (prefillMode(c.env) !== "llm") throw new ApiError("CONFLICT", "The AI writer is not connected yet (set LLM_PROVIDER and ANTHROPIC_API_KEY on the API). Write the summary by hand for now.");
  const [schema, settings] = await Promise.all([schemaFor(c, "primary"), loadSettings(c.env, p.tenantId)]);
  return c.json(await regenerateDiscussionSummary(c.env, p, schema, settings, c.req.param("id"), b.mode));
});

// Archived Responses (request 34): earlier Primary entries from the same source as this one.
app.get("/api/signals/:id/archived", async (c) => {
  requirePermission(P(c), "tracker:read");
  const schema = await schemaFor(c, "primary");
  const match = c.req.query("match") === "kiq" ? "kiq" : "source";
  return cachedJson(c, () => archivedResponses(c.env, schema, P(c).tenantId, c.req.param("id"), match));
});

app.get("/api/signals/:id", async (c) => {
  requirePermission(P(c), "tracker:read");
  const schemas = await schemasFor(c);
  return cachedJson(c, () => signalDetail(c.env, schemas, P(c).tenantId, c.req.param("id")));
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
  const f = await filtersOf(c, schema);
  return cachedJson(c, () => dashboard(c.env, schema, P(c).tenantId, f));
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

app.post("/api/submissions/manual", async (c) => {
  const p = P(c);
  requirePermission(p, "submission:create");
  const b = await body(c, CreateManualRequest);
  const r = await submitManual(c.env, await schemasFor(c), p, c.req.header("idempotency-key")?.slice(0, 100) ?? null, b.stream);
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

/** Attach a saved HTML page to a tracker entry: its first page, or another page for its list. */
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
  const schemas = await schemasFor(c);
  return cachedJson(c, () => listItems(c.env, schemas, P(c).tenantId, statuses, stream), "all");
});

// Registered before "/api/items/:id". Items awaiting the analyst, per inbox (the red badges).
app.get("/api/items/counts", async (c) => {
  requirePermission(P(c), "inbox:read");
  return cachedJson(c, () => inboxCounts(c.env, P(c).tenantId), "all");
});

app.get("/api/items/:id", async (c) => {
  requirePermission(P(c), "inbox:read");
  const schemas = await schemasFor(c);
  return cachedJson(c, () => getDetail(c.env, schemas, P(c).tenantId, c.req.param("id")), "all");
});

// ---------------------------------------------------------------------------
// Eradigm Inbox ⇄ Client Inbox, and comments on an entry's text
// ---------------------------------------------------------------------------

// "Delete All" in the Eradigm Inbox's Pushed & Rejected view.
app.post("/api/items/clear-decided", async (c) => {
  requirePermission(P(c), "item:delete");
  const b = await body(c, ClearDecidedRequest);
  return c.json(await clearDecided(c.env, P(c), b.stream ?? null));
});

app.post("/api/items/:id/send-to-client", async (c) => {
  requirePermission(P(c), "item:review");
  const b = await body(c, VersionRequest);
  return c.json(await sendToClient(c.env, await schemasFor(c), P(c), c.req.param("id"), b.version));
});

/** Eradigm takes an entry back from the Client Inbox (without the client sending it). */
app.post("/api/items/:id/recall", async (c) => {
  requirePermission(P(c), "item:review");
  const b = await body(c, VersionRequest);
  return c.json(await backToEradigm(c.env, await schemasFor(c), P(c), c.req.param("id"), b.version, "eradigm"));
});

app.get("/api/client-inbox", async (c) => {
  requirePermission(P(c), "clientInbox:read");
  const schemas = await schemasFor(c);
  return cachedJson(c, () => listItems(c.env, schemas, P(c).tenantId, ["needs_review"], null, 200, true), "all");
});

app.get("/api/client-inbox/count", async (c) => {
  requirePermission(P(c), "clientInbox:read");
  return cachedJson(c, async () => ({ count: await clientInboxCount(c.env, P(c).tenantId) }), "all");
});

app.get("/api/client-inbox/:id", async (c) => {
  const p = P(c);
  requirePermission(p, "clientInbox:read");
  const row = await getItemRow(c.env, p.tenantId, c.req.param("id"));
  if (!row.with_client_at || row.status !== "needs_review") throw notFound("Item");
  return c.json(await getDetail(c.env, await schemasFor(c), p.tenantId, row.id));
});

app.post("/api/client-inbox/:id/send-to-eradigm", async (c) => {
  requirePermission(P(c), "clientInbox:act");
  const b = await body(c, VersionRequest);
  return c.json(await backToEradigm(c.env, await schemasFor(c), P(c), c.req.param("id"), b.version, "client"));
});

app.post("/api/client-inbox/:id/push", async (c) => {
  requirePermission(P(c), "clientInbox:act");
  const b = await body(c, VersionRequest);
  return c.json(await clientPush(c.env, await schemasFor(c), P(c), c.req.param("id"), b.version));
});

const canComment = (p: Principal) => can(p.role, "item:review") || can(p.role, "clientInbox:act");

app.get("/api/items/:id/comments", async (c) => {
  if (!canComment(P(c))) throw forbidden();
  return c.json(await listComments(c.env, P(c), c.req.param("id")));
});

app.post("/api/items/:id/comments", async (c) => {
  if (!canComment(P(c))) throw forbidden();
  return c.json(await addComment(c.env, P(c), c.req.param("id"), await body(c, CreateCommentRequest)), 201);
});

app.patch("/api/items/:id/comments/:cid", async (c) => {
  if (!canComment(P(c))) throw forbidden();
  const b = await body(c, UpdateCommentRequest);
  return c.json(await updateComment(c.env, P(c), c.req.param("id"), c.req.param("cid"), b));
});

app.delete("/api/items/:id/comments/:cid", async (c) => {
  if (!canComment(P(c))) throw forbidden();
  return c.json(await updateComment(c.env, P(c), c.req.param("id"), c.req.param("cid"), "delete"));
});

app.get("/api/items/:id/snapshots", async (c) => {
  const p = P(c);
  const row = await getItemRow(c.env, p.tenantId, c.req.param("id"));
  if (!can(p.role, "inbox:read") && row.status !== "approved" && !row.with_client_at) throw notFound("Item");
  return c.json(await listPages(c.env, p.tenantId, row.id));
});

app.get("/api/items/:id/snapshot", async (c) => {
  const p = P(c);
  const row = await getItemRow(c.env, p.tenantId, c.req.param("id"));
  // Clients may only see the snapshot of a published (approved) signal, or of one in their inbox.
  if (!can(p.role, "inbox:read") && row.status !== "approved" && !row.with_client_at) throw notFound("Item");
  // ?page=<id> opens one of the entry's other saved pages (default: its first page).
  const snapshotId = await pageSnapshotId(c.env, p.tenantId, row, c.req.query("page"));
  const html = await readSnapshot(c.env, p.tenantId, snapshotId);
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
  return c.json(await saveDraft(c.env, await schemasFor(c), P(c), c.req.param("id"), b.values, b.version, b.kiqs));
});

// Primary entries: one Inbox entry per Key Intelligence Question, before Push to Tracker.
app.post("/api/items/:id/split", async (c) => {
  const b = await body(c, SplitRequest);
  return c.json(await splitItem(c.env, await schemasFor(c), P(c), c.req.param("id"), b.version, b.kiqs));
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
  const b: DeleteItemRequest = raw.trim() ? await body(c, DeleteItemRequest) : {};
  const schemas = await schemasFor(c);
  if (b.from && b.from !== "global") return c.json(await deleteFromTable(c.env, schemas, P(c), c.req.param("id"), b.from, async (stream, impact) => {
    const sc = await phantomScope(c, stream, schemas[stream]);
    return !sc.impacts || sc.impacts.includes(impact ?? "");
  }, b.reason));
  return c.json(await softDelete(c.env, schemas, P(c), c.req.param("id"), b.reason));
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
    navOrder: normaliseNavOrder(b.navOrder ?? current.navOrder),
    menu: normaliseMenu(b.menu ?? current.menu),
    megatrends: { ...current.megatrends, ...b.megatrends },
  };
  await saveSettings(c.env, p.tenantId, next, p.userId);
  await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "settings.changed", targetType: "settings", details: { sections: Object.keys(b) } });
  return c.json(next);
});

/** Request 47: staff change the size of a title or heading for everyone (1 = back to the default). */
app.put("/api/settings/text-size", async (c) => {
  const p = P(c);
  requirePermission(p, "item:edit");
  const b = await body(c, SetTextSizeRequest);
  const current = await loadSettings(c.env, p.tenantId);
  const textSizes = { ...current.textSizes };
  if (Math.abs(b.size - 1) < 0.001) delete textSizes[b.key];
  else textSizes[b.key] = b.size;
  if (Object.keys(textSizes).length > MAX_TEXT_SIZES) throw new ApiError("VALIDATION", "Too many sizes have been changed; set some back first");
  const next: TenantSettings = { ...current, textSizes };
  await saveSettings(c.env, p.tenantId, next, p.userId);
  await audit(c.env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "settings.changed", targetType: "settings", details: { sections: ["textSizes"], key: b.key, size: b.size } });
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
