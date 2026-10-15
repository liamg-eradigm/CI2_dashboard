/**
 * CI Squared (request 61: the platform's first project): its routes, cache
 * rules, background queue, crons and configuration checks.
 */
import type { Env } from "../../env.js";
import { log } from "../../lib/log.js";
import type { ProjectModule } from "../types.js";
import { failItem, runJob } from "./pipeline/process.js";
import { prefillMode } from "./pipeline/prefill.js";
import { snapshotBackend } from "./pipeline/snapshots.js";
import { ciSquaredRoutes } from "./routes.js";
import { RETENTION_CRON, runRetention } from "./services/retention.js";

const MAX_DELIVERIES = 3;

/** POSTs that only read (nothing to bump). */
const READ_ONLY_POSTS = new Set(["POST /api/trend-test"]);
/**
 * Changes that never reach the Tracker, Phantoms, Dashboard, Megatrends or
 * Competitors (entries still in the Inbox, comments, saved views): they leave
 * Tracker-side reads cached. Anything not listed counts as both.
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
]);

function configChecks(e: Env) {
  return [
    prefillMode(e) === "manual"
      ? { key: "llm", ok: true, message: "Manual entry: drafts arrive with every field empty; no external AI service is used (see docs/ENABLING-AUTOFILL.md to enable pre-fill)" }
      : e.LLM_PROVIDER === "mock"
        ? { key: "llm", ok: false, message: "Pre-fill uses the offline mock heuristics (set LLM_PROVIDER=anthropic or none)" }
        : { key: "llm", ok: !!e.ANTHROPIC_API_KEY, message: e.ANTHROPIC_API_KEY ? "LLM pre-fill: Claude API key configured" : "LLM pre-fill enabled but ANTHROPIC_API_KEY is not set" },
    { key: "capture", ok: !!e.CAPTURE, message: "Isolated capture worker bound" },
    { key: "queue", ok: !!e.JOBS, message: "Background work queue bound" },
    { key: "snapshots", ok: true, message: snapshotBackend(e) === "r2" ? "Snapshots stored in R2" : "Snapshots stored in D1 (Workers Free plan)" },
    { key: "encryption", ok: !!e.SNAPSHOT_ENCRYPTION_KEY, message: "Application-level snapshot encryption key set" },
  ];
}

export const ciSquared: ProjectModule = {
  kind: "ci2",
  routes: ciSquaredRoutes,
  readOnlyPosts: READ_ONLY_POSTS,
  inboxOnly: INBOX_ONLY,
  features: (env) => ({ prefill: prefillMode(env) }),
  configChecks,

  async queue(batch, env) {
    const deadLetter = batch.queue.includes("-dlq");
    for (const msg of batch.messages) {
      const job = msg.body;
      try {
        if (deadLetter) {
          // Every retry was used up: make the failure visible and retryable by an analyst.
          await failItem(env, job, "RETRIES_EXHAUSTED", "Processing failed repeatedly · use Retry to try again", null);
          msg.ack();
          continue;
        }
        const r = await runJob(env, job, msg.attempts, MAX_DELIVERIES);
        if (r === "retry") msg.retry({ delaySeconds: Math.min(300, 15 * 2 ** (msg.attempts - 1)) });
        else msg.ack();
      } catch (err) {
        log("error", "queue_message_error", { item: job.itemId, message: (err as Error).message });
        msg.retry({ delaySeconds: 60 });
      }
    }
  },

  scheduled(cron, env, ctx) {
    if (cron === RETENTION_CRON) ctx.waitUntil(runRetention(env));
  },
};
