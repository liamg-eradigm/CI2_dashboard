/**
 * Isolated capture worker entry point.
 *
 *   POST /capture  {"url": "..."}                  -> framed CaptureResult
 *   POST /parse    body = HTML, x-file-name header -> framed CaptureResult
 *
 * Returns sanitised HTML plus the extracted article (see @eradigm/capture
 * wire.ts for the framing). It never stores anything.
 */
import { CAPTURE_WIRE_TYPE, captureUrl, encodeCaptureResult, parseUpload, type CaptureResult } from "@eradigm/capture";
import { CAPTURE_LIMITS } from "@eradigm/shared";

interface Env {
  CAPTURE_USER_AGENT: string;
  DNS_RESOLVER_URL: string;
}

/** Structured log line (identifiers and outcomes only — never page content). */
function logResult(path: string, started: number, r: CaptureResult) {
  console.log(JSON.stringify({ level: "info", event: "capture", path, ok: r.ok, code: r.ok ? null : r.code, bytes: r.ok ? r.rawBytes : null, ms: Date.now() - started }));
}

const framed = (r: CaptureResult) => new Response(encodeCaptureResult(r), { headers: { "content-type": CAPTURE_WIRE_TYPE } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return Response.json({ ok: true });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    if (url.pathname === "/capture") {
      const body = (await req.json().catch(() => ({}))) as { url?: string };
      const result = await captureUrl(String(body.url ?? ""), { fetcher: fetch, resolverUrl: env.DNS_RESOLVER_URL, userAgent: env.CAPTURE_USER_AGENT });
      logResult("/capture", started, result);
      return framed(result);
    }

    if (url.pathname === "/parse") {
      const name = req.headers.get("x-file-name") ?? "upload.html";
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.byteLength > CAPTURE_LIMITS.maxBytes) {
        return framed({ ok: false, code: "TOO_LARGE", message: `File exceeds the ${CAPTURE_LIMITS.maxBytes / 1048576} MB limit`, retryable: false, stepIndex: 0, steps: [], finalUrl: null });
      }
      const result = await parseUpload(buf, name);
      logResult("/parse", started, result);
      return framed(result);
    }
    return new Response("Not found", { status: 404 });
  },
};
