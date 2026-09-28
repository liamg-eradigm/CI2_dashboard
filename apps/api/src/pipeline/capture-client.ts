/**
 * Calls the isolated capture worker. The API itself never fetches or parses
 * untrusted pages in staging/production.
 */
import type * as CaptureLib from "@eradigm/capture";
import type { CaptureResult } from "@eradigm/capture";
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";

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

async function viaBinding(env: Env, path: string, init: RequestInit): Promise<CaptureResult | null> {
  if (!env.CAPTURE) return null;
  try {
    const res = await env.CAPTURE.fetch(`https://capture.internal${path}`, init);
    if (!res.ok) throw new Error(`capture worker HTTP ${res.status}`);
    return (await res.json()) as CaptureResult;
  } catch (err) {
    // In dev the binding exists even when the capture worker is not running.
    if (env.ENVIRONMENT === "dev" || env.ENVIRONMENT === "test") return null;
    throw err;
  }
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
  return lib.parseUpload(new TextDecoder("utf-8").decode(body), fileName, body.byteLength);
}
