/**
 * HTTP API: the platform (request 61). Sign-in, identity, people, audit and
 * incidents are the platform's; every project's own routes are mounted from
 * projects/registry.ts after the authentication middleware. Every route
 * (except /api/health and sign-in) resolves the caller's identity, workspace
 * and role, then checks the permission for the action. The tenant id used by
 * every query comes from the verified principal, never from the body.
 */
import { Hono } from "hono";
import { ACTIONS, AddPersonRequest, CONTRACT_VERSION, CreateUserRequest, PROJECT_PATH_PREFIX, RenameProjectRequest, SPACE_HEADER, SetAccessRequest, UpdateUserRequest, can } from "@eradigm/shared";
import { requirePermission, resolvePrincipal, type Principal } from "./auth/context.js";
import { allowedTenants, entraConfigured } from "./auth/entra.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { bumpDataVersion } from "./lib/cache.js";
import { ApiError, forbidden, notFound } from "./lib/errors.js";
import { body, P, type AppEnv } from "./lib/http.js";
import { newId, nowIso } from "./lib/ids.js";
import { log, metric } from "./lib/log.js";
import { PROJECTS, projectOf } from "./projects/registry.js";
import type { ProjectModule } from "./projects/types.js";
import { accessEndSessions, accessInvite, addPerson, listAccess, renameProject, setAccess } from "./services/access.js";
import { audit, listAudit, verifyChain } from "./services/audit.js";
import { tenantTimezone } from "./services/tenants.js";
import { createInvite, createUser, listUsers, revokeSessions, updateUser } from "./services/users.js";


export const app = new Hono<AppEnv>();

/** The project serving the caller's workspace. */
const projectFor = (p: Principal): ProjectModule => projectOf(p.projectKind) ?? (PROJECTS[0] as ProjectModule);

/** The platform's own routes (any project); every other /api route is a project's. */
const PLATFORM_PATHS = /^\/api\/(me|users|access|projects|audit|incidents|notifications|admin|health|auth)(\/|$)/;

/** The project whose route a path is: the one claiming its prefix, else the project without prefixes (CI Squared's /api/*). */
function ownerOf(path: string): ProjectModule | undefined {
  if (PLATFORM_PATHS.test(path)) return undefined;
  return PROJECTS.find((m) => m.prefixes?.some((x) => path.startsWith(x))) ?? PROJECTS.find((m) => !m.prefixes);
}

/** POSTs that only read, and changes that only touch the Inbox side, of every project (lib/cache.ts). */
const READ_ONLY_POSTS = new Set(PROJECTS.flatMap((m) => [...(m.readOnlyPosts ?? [])]));
const INBOX_ONLY = new Set([
  ...PROJECTS.flatMap((m) => [...(m.inboxOnly ?? [])]),
  // The platform's own changes never reach a project's data.
  "POST /api/me/sessions/revoke",
  "POST /api/users",
  "PATCH /api/users/:id",
  "POST /api/users/:id/invite",
  "POST /api/users/:id/sessions/revoke",
  "POST /api/incidents/:id/resolve",
  "POST /api/access",
  "PUT /api/access/:userId",
  "POST /api/access/:userId/invite",
  "POST /api/access/:userId/sessions/revoke",
  "PATCH /api/projects/:id",
]);

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
  let p = await resolvePrincipal(c.req.raw, c.env);
  // Request 55: the Test tab's pages read and write the workspace's test space (admins only).
  if (c.req.header(SPACE_HEADER) === "test") {
    const testSpace = projectFor(p).testSpace;
    if (p.role !== "admin") throw forbidden("The Test tab is for admins only");
    if (!testSpace) throw notFound("Test space");
    const test = await testSpace(c.env, { id: p.tenantId, name: p.tenantName }, p.userId);
    p = { ...p, tenantId: test, tenantName: `${p.tenantName} · Test`, space: "test", liveTenantId: p.tenantId };
  }
  c.set("principal", p);
  // Request 61: a project's routes answer only for its own workspaces (the platform's answer for any).
  const owner = ownerOf(c.req.path);
  if (owner && owner.kind !== projectFor(p).kind) throw notFound("Page");
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

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

app.get("/api/me", async (c) => {
  const p = P(c);
  const project = projectFor(p);
  return c.json({
    user: { id: p.userId, email: p.email, name: p.name },
    tenant: { id: p.tenantId, name: p.tenantName },
    role: p.role,
    tenants: p.tenants,
    permissions: ACTIONS.filter((a) => can(p.role, a)),
    contractVersion: CONTRACT_VERSION,
    environment: c.env.ENVIRONMENT,
    timezone: await tenantTimezone(c.env, p.tenantId),
    features: project.features?.(c.env) ?? { prefill: "manual" },
    space: p.space ?? "live",
    project: projectOfPrincipal(p),
    projects: p.tenants.map((t, i) => ({ id: t.id, slug: t.slug, name: t.name, kind: t.kind, role: t.role, path: i === 0 ? "" : `${PROJECT_PATH_PREFIX}/${t.slug}` })),
  });
});

/** The project the request is for (in the Test tab: the live project's). */
function projectOfPrincipal(p: Principal) {
  const live = p.liveTenantId ?? p.tenantId;
  const i = p.tenants.findIndex((t) => t.id === live);
  const t = p.tenants[i];
  if (!t) return undefined;
  return { id: t.id, slug: t.slug, name: t.name, kind: t.kind, role: t.role, path: i === 0 ? "" : `${PROJECT_PATH_PREFIX}/${t.slug}` };
}

// ---------------------------------------------------------------------------
// Request 61: projects and who can open them (Admin → Projects & access)
// ---------------------------------------------------------------------------

app.get("/api/access", async (c) => c.json(await listAccess(c.env, P(c))));

app.post("/api/access", async (c) => {
  const p = P(c);
  const b = await body(c, AddPersonRequest);
  const r = await addPerson(c.env, p, b);
  return c.json({ ...(await listAccess(c.env, p)), invite: r.invite, userId: r.userId }, 201);
});

app.put("/api/access/:userId", async (c) => {
  const p = P(c);
  const b = await body(c, SetAccessRequest);
  await setAccess(c.env, p, c.req.param("userId"), b.projectId, b.role);
  return c.json(await listAccess(c.env, p));
});

app.post("/api/access/:userId/invite", async (c) => c.json(await accessInvite(c.env, P(c), c.req.param("userId")), 201));

app.post("/api/access/:userId/sessions/revoke", async (c) => c.json(await accessEndSessions(c.env, P(c), c.req.param("userId"))));

app.patch("/api/projects/:id", async (c) => {
  const b = await body(c, RenameProjectRequest);
  return c.json(await renameProject(c.env, P(c), c.req.param("id"), b.name));
});

app.post("/api/me/sessions/revoke", async (c) => {
  const p = P(c);
  return c.json(await revokeSessions(c.env, p, p.userId));
});

// ---------------------------------------------------------------------------
// People, audit, incidents, configuration
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
    ...PROJECTS.flatMap((m) => m.configChecks?.(e) ?? []),
    { key: "audit", ok: !!e.AUDIT_HMAC_KEY, message: "Audit HMAC key set" },
    { key: "alerts", ok: !!e.ALERT_WEBHOOK_URL, message: "Operational alert webhook configured" },
  ];
  return c.json({ environment: e.ENVIRONMENT, model: e.LLM_MODEL, provider: e.LLM_PROVIDER, prefill: projectFor(P(c)).features?.(e).prefill ?? "manual", checks });
});

// ---------------------------------------------------------------------------
// Projects (request 61): each project's own routes
// ---------------------------------------------------------------------------

for (const m of PROJECTS) app.route("/", m.routes);
