/**
 * What a project gives the platform (request 61). The platform (app.ts,
 * index.ts, auth, people, audit) knows projects only through this shape and
 * the registry; a project never imports another project.
 */
import type { Hono } from "hono";
import type { Env, JobMessage } from "../env.js";
import type { AppEnv } from "../lib/http.js";

export type ConfigCheck = { key: string; ok: boolean; message: string };

export type ProjectModule = {
  /** tenants.kind of the workspaces this project serves. */
  kind: string;
  /** Its HTTP routes (mounted after the platform's authentication). */
  routes: Hono<AppEnv>;
  /** The /api paths its routes are under (e.g. "/api/epilepsy/"); none: every /api path the platform and other projects do not claim. */
  prefixes?: readonly string[];
  /** "METHOD /path" of POSTs that only read: they leave cached reads in place. */
  readOnlyPosts?: ReadonlySet<string>;
  /** "METHOD /path" of changes that only touch the Inbox side (lib/cache.ts). */
  inboxOnly?: ReadonlySet<string>;
  /** Features the web app switches on (/api/me). */
  features?: (env: Env) => { prefill: "manual" | "llm" };
  /** Its lines in Admin → Configuration. */
  configChecks?: (env: Env) => ConfigCheck[];
  /** Request 55: the workspace's isolated test space (admins' Test tab), created when first asked for. */
  testSpace?: (env: Env, live: { id: string; name: string }, userId: string) => Promise<string>;
  /** Background work from the queue. */
  queue?: (batch: MessageBatch<JobMessage>, env: Env) => Promise<void>;
  /** Cron triggers (each module ignores the crons that are not its own). */
  scheduled?: (cron: string, env: Env, ctx: ExecutionContext) => void;
};
