/**
 * API worker entry point: HTTP (the platform's Hono app, with every project's
 * routes), background queue consumer and cron triggers, each handed to the
 * projects (request 61: projects/registry.ts).
 */
import { app } from "./app.js";
import type { Env, JobMessage } from "./env.js";
import { PROJECTS } from "./projects/registry.js";

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    for (const m of PROJECTS) if (m.queue) await m.queue(batch, env);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const m of PROJECTS) m.scheduled?.(controller.cron, env, ctx);
  },
} satisfies ExportedHandler<Env, JobMessage>;
