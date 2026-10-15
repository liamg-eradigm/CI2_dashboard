/**
 * What every route handler shares, whichever project it belongs to: the
 * request context, reading a validated body, the caller, and the read cache.
 */
import { Hono, type Context } from "hono";
import type { z } from "zod";
import type { Principal } from "../auth/context.js";
import type { Env } from "../env.js";
import { cacheGet, cachePut, dataVersion, type DataVersions } from "./cache.js";
import { ApiError, badRequest } from "./errors.js";

export type Vars = { principal: Principal; requestId: string; dataVersion?: DataVersions };
export type AppEnv = { Bindings: Env; Variables: Vars };
export type C = Context<AppEnv>;
/** A set of routes (the platform's, or one project's). */
export const routes = () => new Hono<AppEnv>();

/** The workspace's data versions, read once per request. */
export async function versionsOf(c: C): Promise<DataVersions> {
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
export async function cachedJson(c: C, make: () => Promise<unknown>, scope: "tracker" | "all" = "tracker"): Promise<Response> {
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

export async function body<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T>> {
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

export const P = (c: C) => c.get("principal");
export const ctxOf = (c: C): ExecutionContext | null => {
  try {
    return c.executionCtx as ExecutionContext;
  } catch {
    return null;
  }
};
