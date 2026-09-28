/**
 * Calls the isolated capture worker. The API itself never fetches or parses
 * untrusted pages in staging/production.
 */
import type * as CaptureLib from "@eradigm/capture";
import { decodeCaptureResult, type CaptureResult } from "@eradigm/capture";
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { log } from "../lib/log.js";

let testFetcher: typeof fetch | null = null;
/** Test hook: route inline-capture network traffic through a fake fetcher. */
export function setInlineCaptureFetcher(f: typeof fetch | null): void {
  testFetcher = f;
}

async function inline(env: Env): Promise<typeof CaptureLib> {
  if (env.ENVIRONMENT !== "dev" && env.ENVIRONMENT !== "test") {
    throw new ApiError("MISCONFIGURED", "The isolated capture worker is not bound (CAPTURE service binding)");
  }
  return import("@eradigm/capture");
}

/** What the analyst sees when the capture worker itself fails (most likely the CPU limit on a very large page). */
export const PROCESSING_LIMIT_MESSAGE =
  "The page could not be processed (it may be too large for the Cloudflare plan's CPU limit). Save it with SingleFile, ideally without embedded images, and upload the HTML file, or retry later.";

async function viaBinding(env: Env, path: string, init: RequestInit): Promise<CaptureResult | null> {
  if (!env.CAPTURE) return null;
  let res: Response;
  try {
    res = await env.CAPTURE.fetch(`https://capture.internal${path}`, init);
  } catch (err) {
    // In dev the binding exists even when the capture worker is not running.
    if (env.ENVIRONMENT === "dev" || env.ENVIRONMENT === "test") return null;
    log("error", "capture_worker_error", { path, message: (err as Error).message });
    return processingLimit();
  }
  if (!res.ok) {
    if (env.ENVIRONMENT === "dev" || env.ENVIRONMENT === "test") return null;
    // e.g. error 1102 "Worker exceeded resource limits".
    log("error", "capture_worker_error", { path, status: res.status });
    return processingLimit();
  }
  return decodeCaptureResult(await res.arrayBuffer());
}

function processingLimit(): CaptureResult {
  // No step detail: the caller keeps the steps recorded before the capture worker was called.
  return { ok: false, code: "PROCESSING_LIMIT", message: PROCESSING_LIMIT_MESSAGE, retryable: false, stepIndex: 2, steps: [], finalUrl: null };
}

export async function captureUrlIsolated(env: Env, url: string): Promise<CaptureResult> {
  const r = await viaBinding(env, "/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
  if (r) return r;
  const lib = await inline(env);
  return lib.captureUrl(url, { fetcher: testFetcher ?? fetch, resolverUrl: env.DNS_RESOLVER_URL, userAgent: env.CAPTURE_USER_AGENT });
}

export async function parseUploadIsolated(env: Env, body: ArrayBuffer, fileName: string): Promise<CaptureResult> {
  const r = await viaBinding(env, "/parse", { method: "POST", headers: { "content-type": "text/html", "x-file-name": fileName }, body });
  if (r) return r;
  const lib = await inline(env);
  return lib.parseUpload(new Uint8Array(body), fileName);
}
