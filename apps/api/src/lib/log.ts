import type { Env } from "../env.js";

type Level = "debug" | "info" | "warn" | "error";

/**
 * Structured JSON logs (picked up by Workers Logs / Logpush). Never log
 * article content, model inputs/outputs or analyst edits — only identifiers,
 * codes and timings.
 */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Write a metric data point to Workers Analytics Engine when bound. */
export function metric(env: Env, name: string, value: number, labels: Record<string, string> = {}): void {
  try {
    env.METRICS?.writeDataPoint({
      indexes: [name],
      blobs: [env.ENVIRONMENT, labels.tenant ?? "", labels.status ?? "", labels.route ?? "", labels.code ?? ""],
      doubles: [value],
    });
  } catch {
    // Metrics must never break a request.
  }
}

/** Send an operational alert to the configured webhook (Slack/Teams compatible `text` payload). */
export async function alert(env: Env, text: string, fields: Record<string, unknown> = {}): Promise<void> {
  log("warn", "alert", { text, ...fields });
  if (!env.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `[eradigm-ci ${env.ENVIRONMENT}] ${text}` }),
    });
  } catch (err) {
    log("error", "alert_failed", { message: (err as Error).message });
  }
}
