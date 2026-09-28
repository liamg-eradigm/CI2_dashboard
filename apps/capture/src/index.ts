/**
 * Isolated capture worker entry point.
 *
 *   POST /capture  {"url": "..."}                  -> CaptureResult (JSON)
 *   POST /parse    body = HTML, x-file-name header -> CaptureResult (JSON)
 *
 * Returns sanitised HTML plus the extracted article. It never stores anything.
 */
import { captureUrl, parseUpload, type RenderResult } from "@eradigm/capture";
import { CAPTURE_LIMITS } from "@eradigm/shared";

interface Env {
  CAPTURE_MODE: "fetch" | "container";
  CAPTURE_USER_AGENT: string;
  DNS_RESOLVER_URL: string;
  CONTAINER_URL: string;
  CONTAINER_TOKEN?: string;
}

function containerRenderer(env: Env) {
  if (!env.CONTAINER_URL) return undefined;
  return async (url: string): Promise<RenderResult> => {
    const res = await fetch(`${env.CONTAINER_URL.replace(/\/$/, "")}/render`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.CONTAINER_TOKEN ?? ""}` },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(CAPTURE_LIMITS.jobMs),
    });
    if (!res.ok) throw new Error(`capture container returned ${res.status}`);
    return (await res.json()) as RenderResult;
  };
}

/** Structured log line (identifiers and outcomes only — never page content). */
function logResult(path: string, started: number, r: { ok: boolean; code?: string; method?: string }) {
  console.log(JSON.stringify({ level: "info", event: "capture", path, ok: r.ok, code: r.ok ? null : r.code, method: r.method ?? null, ms: Date.now() - started }));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, mode: env.CAPTURE_MODE });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    if (url.pathname === "/capture") {
      const body = (await req.json().catch(() => ({}))) as { url?: string };
      const mode = env.CAPTURE_MODE ?? "fetch";
      const render = mode === "container" ? containerRenderer(env) : undefined;
      const result = await captureUrl(String(body.url ?? ""), {
        fetcher: fetch,
        resolverUrl: env.DNS_RESOLVER_URL,
        userAgent: env.CAPTURE_USER_AGENT,
        method: mode,
        render,
      });
      logResult("/capture", started, result);
      return Response.json(result);
    }

    if (url.pathname === "/parse") {
      const name = req.headers.get("x-file-name") ?? "upload.html";
      const buf = await req.arrayBuffer();
      if (buf.byteLength > CAPTURE_LIMITS.maxBytes) return Response.json({ ok: false, code: "TOO_LARGE", message: "File exceeds the 10 MB limit", retryable: false, stepIndex: 0, steps: [], finalUrl: null });
      const html = new TextDecoder("utf-8").decode(buf);
      const result = await parseUpload(html, name, buf.byteLength);
      logResult("/parse", started, result);
      return Response.json(result);
    }
    return new Response("Not found", { status: 404 });
  },
};
