/**
 * API worker entry point: HTTP (Hono app), background queue consumer and the
 * daily retention cron.
 */
import { app } from "./app.js";
import type { Env, JobMessage } from "./env.js";
import { log } from "./lib/log.js";
import { failItem, runJob } from "./pipeline/process.js";
import { runRetention } from "./services/retention.js";

const MAX_DELIVERIES = 3;

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
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

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runRetention(env));
  },
} satisfies ExportedHandler<Env, JobMessage>;
