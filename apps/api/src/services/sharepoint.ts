/**
 * Request 55: the SharePoint workbook behind the Test tab, read with Microsoft
 * Graph as the app itself (client credentials, no user signed in).
 *
 * The app registration (SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET in
 * Eradigm's directory, SHAREPOINT_TENANT_ID) holds the Sites.Selected
 * permission and was granted read on the one SharePoint site; the file is
 * named by its drive (document library) and item ids. The file is downloaded
 * and read here (packages/shared/src/sheet.ts), which works with read access
 * alone. Errors are logged (never the secret or the token) with a hint on
 * what to fix, and returned to the admin who asked.
 */
import { parseXlsxBook, type Grid } from "@eradigm/shared";
import type { Env } from "../env.js";
import { log } from "../lib/log.js";

const LOGIN = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
/** The largest workbook read (a test workbook is far smaller). */
const MAX_BYTES = 15 * 1024 * 1024;

export const SHAREPOINT_SECRETS = ["SHAREPOINT_TENANT_ID", "SHAREPOINT_CLIENT_ID", "SHAREPOINT_CLIENT_SECRET", "SHAREPOINT_DRIVE_ID", "SHAREPOINT_ITEM_ID"] as const;

interface Config {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  driveId: string;
  itemId: string;
}

/** The app's own sign-in secrets (any workbook it reads). */
export const SHAREPOINT_APP_SECRETS = ["SHAREPOINT_TENANT_ID", "SHAREPOINT_CLIENT_ID", "SHAREPOINT_CLIENT_SECRET"] as const;

/** Request 61: a workbook named by its drive (document library) and item ids, instead of the secrets' (the Test tab's). */
export interface WorkbookTarget {
  driveId: string;
  itemId: string;
}

/** The secrets that are not set (none: the workbook can be read). */
export function missingSecrets(env: Env, target?: WorkbookTarget): string[] {
  return (target ? SHAREPOINT_APP_SECRETS : SHAREPOINT_SECRETS).filter((k) => !env[k]?.trim());
}

function config(env: Env, target?: WorkbookTarget): Config {
  const missing = missingSecrets(env, target);
  if (missing.length) throw new GraphError("config", `Not configured: set ${missing.join(", ")} with wrangler secret put`, { hint: "Set the missing secrets, then redeploy the API." });
  return {
    tenantId: env.SHAREPOINT_TENANT_ID!.trim(),
    clientId: env.SHAREPOINT_CLIENT_ID!.trim(),
    clientSecret: env.SHAREPOINT_CLIENT_SECRET!.trim(),
    driveId: target?.driveId ?? env.SHAREPOINT_DRIVE_ID!.trim(),
    itemId: target?.itemId ?? env.SHAREPOINT_ITEM_ID!.trim(),
  };
}

export type GraphStage = "config" | "token" | "file" | "download" | "read";

/** A failure talking to Microsoft, with what to fix. */
export class GraphError extends Error {
  stage: GraphStage;
  status: number | null;
  code: string | null;
  hint: string;
  graphRequestId: string | null;
  constructor(stage: GraphStage, message: string, o: { status?: number | null; code?: string | null; hint: string; requestId?: string | null }) {
    super(message);
    this.stage = stage;
    this.status = o.status ?? null;
    this.code = o.code ?? null;
    this.hint = o.hint;
    this.graphRequestId = o.requestId ?? null;
  }
  toJSON() {
    return { stage: this.stage, status: this.status, code: this.code, message: this.message, hint: this.hint, requestId: this.graphRequestId };
  }
}

/** Logged once per failure: what failed and why (no secret, token or file content). */
function logged(e: GraphError): GraphError {
  log("error", "sharepoint_graph_error", { stage: e.stage, status: e.status, code: e.code, message: e.message.slice(0, 500), hint: e.hint, graphRequestId: e.graphRequestId });
  return e;
}

/** What to do about a sign-in error (AADSTS codes from Microsoft Entra). */
function tokenHint(code: string | null, aadsts: string | null): string {
  switch (aadsts) {
    case "7000215":
      return "The client secret is wrong. Put the secret's Value (not its Secret ID) in SHAREPOINT_CLIENT_SECRET.";
    case "7000222":
      return "The client secret has expired. Create a new one (Entra → the app → Certificates & secrets) and put its Value in SHAREPOINT_CLIENT_SECRET.";
    case "700016":
      return "No app with this Application (client) ID in that directory. Check SHAREPOINT_CLIENT_ID and SHAREPOINT_TENANT_ID are from the same app registration's Overview page.";
    case "90002":
    case "900023":
    case "90013":
      return "The Directory (tenant) ID is not recognised. Copy it again from the app registration's Overview page into SHAREPOINT_TENANT_ID.";
    case "700024":
    case "50034":
      return "Microsoft refused the app's sign-in. Check the client ID and secret belong to the same app registration.";
  }
  if (code === "invalid_client") return "Microsoft refused the app's credentials. Check SHAREPOINT_CLIENT_ID and SHAREPOINT_CLIENT_SECRET (the secret's Value).";
  if (code === "unauthorized_client") return "The app may not sign in on its own. Check it is a single-tenant app registration in Eradigm's directory.";
  return "Check the three app secrets (tenant ID, client ID, client secret Value) match the app registration.";
}

/** What to do about a Graph error on the file. */
function fileHint(status: number, code: string | null): string {
  if (status === 401) return "Microsoft did not accept the app's sign-in for Graph. Check the API permission is Microsoft Graph → Sites.Selected (Application) with admin consent granted.";
  if (status === 403)
    return "The app has no access to this file. Check admin consent was granted for Sites.Selected (Entra → the app → API permissions) and that the app was given read access to the CI2 Monitoring site (Graph Explorer, POST …/sites/{site-id}/permissions).";
  if (status === 404)
    return "No file with these IDs, or the app cannot see it (Graph also answers 404 when the site was not shared with the app). Check SHAREPOINT_DRIVE_ID (starts “b!”) and SHAREPOINT_ITEM_ID (starts “01”), and the site permission.";
  if (status === 400 && code === "invalidRequest") return "Graph did not accept the IDs. Check SHAREPOINT_DRIVE_ID (the library's id, starts “b!”) and SHAREPOINT_ITEM_ID (the file's id).";
  if (status === 429 || status === 503) return "Microsoft is limiting requests for a moment. It is tried again automatically.";
  return "Microsoft Graph returned an error. Try again; if it stays, check the IDs and the site permission.";
}

/** Tokens last about an hour: kept in this isolate until a few minutes before they expire. */
const tokens = new Map<string, { token: string; until: number }>();

async function appToken(cfg: Config): Promise<string> {
  const key = `${cfg.tenantId}|${cfg.clientId}`;
  const have = tokens.get(key);
  if (have && have.until > Date.now()) return have.token;
  let res: Response;
  try {
    res = await fetch(`${LOGIN}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    });
  } catch (err) {
    throw logged(new GraphError("token", `Could not reach Microsoft sign-in: ${(err as Error).message}`, { hint: "A network problem: it is tried again automatically." }));
  }
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string; error_codes?: number[]; trace_id?: string } | null;
  if (!res.ok || !body?.access_token) {
    const code = body?.error ?? null;
    const aadsts = body?.error_codes?.[0] != null ? String(body.error_codes[0]) : (/AADSTS(\d+)/.exec(body?.error_description ?? "")?.[1] ?? null);
    const first = (body?.error_description ?? `HTTP ${res.status}`).split(/\r?\n/)[0] ?? "";
    throw logged(new GraphError("token", `Microsoft sign-in failed: ${first}`, { status: res.status, code: aadsts ? `AADSTS${aadsts}` : code, hint: tokenHint(code, aadsts), requestId: body?.trace_id ?? null }));
  }
  tokens.set(key, { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000 });
  return body.access_token;
}

async function graph(cfg: Config, token: string, path: string, stage: GraphStage): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch (err) {
    throw logged(new GraphError(stage, `Could not reach Microsoft Graph: ${(err as Error).message}`, { hint: "A network problem: it is tried again automatically." }));
  }
  if (res.ok) return res;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; innerError?: { "request-id"?: string } } } | null;
  const code = body?.error?.code ?? null;
  if (res.status === 401) tokens.delete(`${cfg.tenantId}|${cfg.clientId}`);
  throw logged(
    new GraphError(stage, `Microsoft Graph: ${body?.error?.message ?? `HTTP ${res.status}`}`, {
      status: res.status,
      code,
      hint: fileHint(res.status, code),
      requestId: res.headers.get("request-id") ?? body?.error?.innerError?.["request-id"] ?? null,
    }),
  );
}

export interface WorkbookFile {
  name: string;
  size: number | null;
  lastModified: string | null;
  lastModifiedBy: string | null;
  webUrl: string | null;
  /** Changes when the file's content changes (not its name or properties). */
  version: string;
}

const itemPath = (cfg: Config) => `/drives/${encodeURIComponent(cfg.driveId)}/items/${encodeURIComponent(cfg.itemId)}`;

/** The file's name and version (one Graph call): enough to tell whether it changed. */
export async function workbookFile(env: Env, target?: WorkbookTarget): Promise<WorkbookFile> {
  const cfg = config(env, target);
  const token = await appToken(cfg);
  const res = await graph(cfg, token, `${itemPath(cfg)}?$select=name,size,lastModifiedDateTime,lastModifiedBy,webUrl,cTag,eTag,file`, "file");
  const it = (await res.json()) as { name: string; size?: number; lastModifiedDateTime?: string; lastModifiedBy?: { user?: { displayName?: string } }; webUrl?: string; cTag?: string; eTag?: string; file?: unknown };
  if (!it.file) throw logged(new GraphError("file", `“${it.name}” is a folder, not a file`, { hint: "SHAREPOINT_ITEM_ID must be the id of the workbook itself." }));
  return {
    name: it.name,
    size: it.size ?? null,
    lastModified: it.lastModifiedDateTime ?? null,
    lastModifiedBy: it.lastModifiedBy?.user?.displayName ?? null,
    webUrl: it.webUrl ?? null,
    version: it.cTag ?? it.eTag ?? it.lastModifiedDateTime ?? "",
  };
}

/** The workbook's bytes. */
export async function downloadWorkbook(env: Env, target?: WorkbookTarget): Promise<Uint8Array> {
  const cfg = config(env, target);
  const token = await appToken(cfg);
  const res = await graph(cfg, token, `${itemPath(cfg)}/content`, "download");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw logged(new GraphError("download", `The workbook is ${Math.round(bytes.byteLength / 1048576)} MB; the most read is ${MAX_BYTES / 1048576} MB`, { hint: "Use a smaller test workbook." }));
  return bytes;
}

/** Every sheet of a workbook's bytes (or, with `only`, the sheets it picks). */
export async function readWorkbook(bytes: Uint8Array, only?: (name: string) => boolean, opts?: { formats?: boolean }): Promise<{ name: string; grid: Grid }[]> {
  try {
    return await parseXlsxBook(bytes, only, opts);
  } catch (err) {
    throw logged(new GraphError("read", `The file could not be read as an Excel workbook: ${(err as Error).message}`, { hint: "The file must be an .xlsx workbook (not .xls or .csv)." }));
  }
}

/** A sheet's header row: its first row with any text (the columns, as written). */
export function headerRow(grid: Grid): { at: number; columns: string[] } {
  const at = grid.findIndex((r) => (r ?? []).some((v) => v?.trim()));
  if (at < 0) return { at: -1, columns: [] };
  const row = grid[at] ?? [];
  let end = row.length;
  while (end > 0 && !row[end - 1]?.trim()) end--;
  return { at, columns: row.slice(0, end).map((v) => (v ?? "").replace(/\s+/g, " ").trim()) };
}

/**
 * Request 61: the drive and item ids of a workbook from its SharePoint link
 * (“Copy link”). Graph opens a sharing link directly (/shares); when it
 * cannot (an app with access to one site only may not), the file is looked
 * for by name on the link's site.
 */
export async function resolveWorkbookLink(env: Env, link: string, fileName: string): Promise<WorkbookTarget & { name: string; webUrl: string | null }> {
  const creds = config(env, { driveId: "", itemId: "" });
  const token = await appToken(creds);
  type Item = { id: string; name: string; webUrl?: string; parentReference?: { driveId?: string }; file?: unknown };
  const asTarget = (it: Item) => ({ driveId: it.parentReference?.driveId ?? "", itemId: it.id, name: it.name, webUrl: it.webUrl ?? null });
  const share = `u!${btoa(link.trim()).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
  let first: GraphError | null = null;
  try {
    const res = await graph(creds, token, `/shares/${share}/driveItem?$select=id,name,webUrl,parentReference,file`, "file");
    const it = (await res.json()) as Item;
    if (it.parentReference?.driveId) return asTarget(it);
  } catch (err) {
    if (!(err instanceof GraphError)) throw err;
    first = err;
  }
  // The site the link is on: https://<host>/:x:/s/<site>/… or https://<host>/sites/<site>/…
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw logged(new GraphError("file", "That is not a link", { hint: "Paste the workbook's link from SharePoint or Excel (Share → Copy link)." }));
  }
  const site = /\/(?::[a-z]:\/)?(?:s|sites|teams|t)\/([^/?#]+)/i.exec(url.pathname)?.[1];
  const kind = /\/(?::[a-z]:\/)?(t|teams)\//i.test(url.pathname) ? "teams" : "sites";
  if (!site) throw first ?? logged(new GraphError("file", "The link does not name a SharePoint site", { hint: "Paste the workbook's SharePoint link (it contains /s/<site name>/)." }));
  const siteRes = await graph(creds, token, `/sites/${url.hostname}:/${kind}/${encodeURIComponent(decodeURIComponent(site))}?$select=id`, "file");
  const siteId = ((await siteRes.json()) as { id: string }).id;
  const q = fileName.replace(/'/g, "''");
  const found = await graph(creds, token, `/sites/${encodeURIComponent(siteId)}/drive/root/search(q='${encodeURIComponent(q)}')?$select=id,name,webUrl,parentReference,file&$top=50`, "file");
  const items = ((await found.json()) as { value?: Item[] }).value ?? [];
  const it = items.find((x) => x.file && x.name.toLowerCase() === fileName.toLowerCase()) ?? items.find((x) => x.file && /\.xlsx$/i.test(x.name) && x.name.toLowerCase().includes(fileName.toLowerCase().replace(/\.xlsx$/i, "")));
  if (!it?.parentReference?.driveId)
    throw logged(new GraphError("file", `No workbook named “${fileName}” on that site`, { status: 404, hint: "Check the file name (Admin → Epilepsy settings) matches the workbook's name on SharePoint exactly." }));
  return asTarget(it);
}

export interface CheckStep {
  name: string;
  ok: boolean;
  detail: string;
}
export interface WorkbookCheck {
  ok: boolean;
  steps: CheckStep[];
  file: WorkbookFile | null;
  sheets: { name: string; columns: string[]; rows: number }[];
  error: ReturnType<GraphError["toJSON"]> | null;
}

/**
 * The test endpoint: sign in to Graph, read the workbook, list its sheets
 * (with each one's columns and number of rows). Each step says how it went;
 * the first failure stops the check and says what to fix.
 */
export async function checkWorkbook(env: Env): Promise<WorkbookCheck> {
  const steps: CheckStep[] = [];
  const out: WorkbookCheck = { ok: false, steps, file: null, sheets: [], error: null };
  try {
    const missing = missingSecrets(env);
    if (missing.length) throw logged(new GraphError("config", `Not configured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`, { hint: "Set the missing secrets with wrangler secret put, then redeploy the API." }));
    steps.push({ name: "Secrets", ok: true, detail: "All five SharePoint secrets are set" });
    await appToken(config(env));
    steps.push({ name: "Microsoft sign-in", ok: true, detail: "The app signed in to Microsoft Graph (client credentials)" });
    out.file = await workbookFile(env);
    steps.push({ name: "Workbook", ok: true, detail: `Found “${out.file.name}”${out.file.lastModified ? `, last changed ${out.file.lastModified}${out.file.lastModifiedBy ? ` by ${out.file.lastModifiedBy}` : ""}` : ""}` });
    const book = await readWorkbook(await downloadWorkbook(env));
    out.sheets = book.map((s) => {
      const h = headerRow(s.grid);
      return { name: s.name, columns: h.columns, rows: h.at < 0 ? 0 : s.grid.slice(h.at + 1).filter((r) => (r ?? []).some((v) => v?.trim())).length };
    });
    steps.push({ name: "Worksheets", ok: true, detail: `Read ${book.length} worksheet${book.length === 1 ? "" : "s"}: ${book.map((s) => s.name).join(", ")}` });
    out.ok = true;
  } catch (err) {
    const e = err instanceof GraphError ? err : logged(new GraphError("read", (err as Error).message, { hint: "An unexpected error: try again." }));
    steps.push({ name: STAGE_NAME[e.stage], ok: false, detail: e.message });
    out.error = e.toJSON();
  }
  return out;
}

const STAGE_NAME: Record<GraphStage, string> = { config: "Secrets", token: "Microsoft sign-in", file: "Workbook", download: "Workbook download", read: "Worksheets" };
