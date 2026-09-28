/**
 * POST /render {"url": "https://..."}   Authorization: Bearer <CONTAINER_TOKEN>
 * -> { html, finalUrl, status, redirects, contentType }
 *
 * The capture worker validates the URL and every resolved address before
 * calling this service and re-validates the final URL afterwards. This
 * service additionally routes all browser traffic through EGRESS_PROXY (a
 * filtering proxy that blocks private/link-local ranges) when configured.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const TOKEN = process.env.CONTAINER_TOKEN ?? "";
const PORT = Number(process.env.PORT ?? 8080);
const LOAD_MS = 20_000;
const JOB_MS = 30_000;
const MAX_BYTES = 10 * 1024 * 1024;
if (!TOKEN) {
  console.error("CONTAINER_TOKEN is required");
  process.exit(1);
}

function authorised(req) {
  const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function capture(url) {
  const dir = await mkdtemp(path.join(tmpdir(), "cap-"));
  const out = path.join(dir, "page.html");
  const browserArgs = ["--headless=new", "--disable-gpu", `--user-data-dir=${path.join(dir, "profile")}`, "--no-first-run", "--disable-extensions"];
  if (process.env.EGRESS_PROXY) browserArgs.push(`--proxy-server=${process.env.EGRESS_PROXY}`);
  const args = [
    "node_modules/single-file-cli/single-file-node.js",
    url,
    out,
    `--browser-executable-path=${process.env.CHROMIUM_PATH}`,
    `--browser-args=${JSON.stringify(browserArgs)}`,
    `--browser-load-max-time=${LOAD_MS}`,
    "--block-scripts=true",
    "--remove-hidden-elements=false",
  ];
  try {
    await new Promise((resolve, reject) =>
      execFile("node", args, { timeout: JOB_MS, maxBuffer: 1024 * 1024 }, (err) =>
        err ? reject(new Error(err.killed ? "Capture exceeded the job time limit" : "Capture failed")) : resolve(),
      ),
    );
    const html = await readFile(out, "utf8");
    if (Buffer.byteLength(html) > MAX_BYTES) throw new Error("Snapshot exceeds 10 MB");
    const finalUrl = /^\s*url:\s*(\S+)\s*$/m.exec(html.slice(0, 5000))?.[1] ?? url;
    return { html, finalUrl, status: 200, redirects: finalUrl === url ? 0 : 1, contentType: "text/html" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
  if (req.method !== "POST" || req.url !== "/render") return send(404, { error: "not found" });
  if (!authorised(req)) return send(401, { error: "unauthorised" });
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) return send(413, { error: "request too large" });
  }
  let url;
  try {
    url = new URL(JSON.parse(raw).url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("scheme");
  } catch {
    return send(400, { error: "invalid url" });
  }
  try {
    send(200, await capture(url.href));
  } catch (e) {
    send(502, { error: e.message });
  }
}).listen(PORT, () => console.log(`capture service on :${PORT}`));
