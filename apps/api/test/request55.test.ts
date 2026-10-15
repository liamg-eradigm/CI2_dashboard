import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toXlsxSheets } from "@eradigm/shared";
import { app } from "../src/app";
import { runExcelCron } from "../src/projects/ci-squared/services/excelSync";
import { checkWorkbook } from "../src/services/sharepoint";
import { COMPLETE, call, env, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const SECRETS = {
  SHAREPOINT_TENANT_ID: "11111111-2222-3333-4444-555555555555",
  SHAREPOINT_CLIENT_ID: "66666666-7777-8888-9999-000000000000",
  SHAREPOINT_CLIENT_SECRET: "super-secret-value-do-not-log",
  SHAREPOINT_DRIVE_ID: "b!drive",
  SHAREPOINT_ITEM_ID: "01ITEM",
};
const withSecrets = { ...env, ...SECRETS } as typeof env;

/** Microsoft's sign-in and Graph, answered by `routes` (by URL part); every URL asked is kept. */
function fakeMicrosoft(routes: { token?: () => Response; item?: () => Response; content?: () => Response }) {
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!/login\.microsoftonline\.com|graph\.microsoft\.com/.test(url)) return real(input, init);
    asked.push(url);
    if (url.includes("/oauth2/v2.0/token")) return routes.token?.() ?? Response.json({ access_token: "tok", expires_in: 3600 });
    if (url.endsWith("/content")) return routes.content?.() ?? new Response("no", { status: 500 });
    return routes.item?.() ?? Response.json({ name: "Power_Automate_Test.xlsx", size: 1000, lastModifiedDateTime: "2026-10-13T09:00:00Z", webUrl: "https://eradigm.sharepoint.com/x", cTag: "c1", file: {} });
  }) as typeof fetch;
  return { asked, restore: () => (globalThis.fetch = real) };
}
let ms: ReturnType<typeof fakeMicrosoft> | null = null;
afterEach(() => {
  ms?.restore();
  ms = null;
  vi.restoreAllMocks();
});

/** A workbook with the four sheets (each a header row, then rows). */
const workbook = (sheets: Record<string, string[][]>) => toXlsxSheets(Object.entries(sheets).map(([name, table]) => ({ name, table })));

type Col = { key: string; label: string };
let labels: Record<"primary" | "secondary", Map<string, string>>;
beforeAll(async () => {
  const of = async (stream: string) => new Map(((await json(call(w.a.admin, "GET", `/api/schema?stream=${stream}`))).columns as Col[]).map((c) => [c.key, c.label]));
  labels = { primary: await of("primary"), secondary: await of("secondary") };
});

/** A tracker sheet: the columns of these keys (by their labels), then one row per entry. */
function trackerSheet(stream: "primary" | "secondary", rows: Record<string, string>[], extra: string[] = []): string[][] {
  const keys = ["record_id", ...Object.keys(COMPLETE)];
  const header = [...keys.map((k) => labels[stream].get(k)!), ...extra];
  const base: Record<string, string> = { ...COMPLETE, competitors: "Roche" } as unknown as Record<string, string>;
  return [header, ...rows.map((r) => [...keys.map((k) => r[k] ?? base[k] ?? ""), ...extra.map((e) => r[e] ?? "")])];
}

async function uploadBook(who: string, bytes: Uint8Array, name = "Power_Automate_Test.xlsx") {
  const form = new FormData();
  form.append("file", new File([bytes], name));
  return call(who, "POST", "/api/excel/upload", { form });
}
const TEST = { "x-eradigm-space": "test" };

/** Sync from this workbook until every change is in (a few rows per run); what was applied, in all. */
async function syncAll(bytes: Uint8Array) {
  const total = { created: 0, updated: 0, deleted: 0, trends: 0 };
  let s;
  for (let i = 0; i < 10; i++) {
    s = await json(uploadBook(w.a.admin, bytes));
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += s.applied[k];
    if (!s.more) break;
  }
  return { ...s, applied: total };
}

describe("request 55: the SharePoint workbook (Microsoft Graph, client credentials)", () => {
  it("the check says what is missing when the secrets are not set (and is for admins only)", async () => {
    expect((await call(w.a.analyst, "GET", "/api/excel/check")).status).toBe(403);
    const r = await json(call(w.a.admin, "GET", "/api/excel/check"));
    expect(r.ok).toBe(false);
    expect(r.steps).toEqual([{ name: "Secrets", ok: false, detail: expect.stringContaining("SHAREPOINT_TENANT_ID") }]);
    expect(r.error).toMatchObject({ stage: "config" });
  });

  it("signs in, reads the workbook and lists its worksheets with their columns", async () => {
    const bytes = workbook({ Primary: [["ID", "Title"], ["P-1", "One"], ["", ""], ["P-2", "Two"]], Secondary: [["ID"]], "Competitor Trend Analysis": [["Competitor", "Company Profile"]], "Macrotrend Analysis": [["Macrotrend"]] });
    ms = fakeMicrosoft({ content: () => new Response(bytes) });
    const r = await checkWorkbook(withSecrets);
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual(["Secrets", "Microsoft sign-in", "Workbook", "Worksheets"]);
    expect(r.file).toMatchObject({ name: "Power_Automate_Test.xlsx", version: "c1" });
    expect(r.sheets).toEqual([
      { name: "Primary", columns: ["ID", "Title"], rows: 2 },
      { name: "Secondary", columns: ["ID"], rows: 0 },
      { name: "Competitor Trend Analysis", columns: ["Competitor", "Company Profile"], rows: 0 },
      { name: "Macrotrend Analysis", columns: ["Macrotrend"], rows: 0 },
    ]);
    // The app's own token (client credentials, Graph's default scope), then the file by drive and item id.
    const token = ms.asked.find((u) => u.includes("/oauth2/v2.0/token"));
    expect(token).toBe(`https://login.microsoftonline.com/${SECRETS.SHAREPOINT_TENANT_ID}/oauth2/v2.0/token`);
    expect(ms.asked).toContain("https://graph.microsoft.com/v1.0/drives/b!drive/items/01ITEM/content");
  });

  it("a wrong client secret: the sign-in error, what to fix, and a log line without the secret", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: string) => void logs.push(l));
    ms = fakeMicrosoft({
      token: () => Response.json({ error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x", error_codes: [7000215], trace_id: "trace-1" }, { status: 401 }),
    });
    const r = await checkWorkbook({ ...withSecrets, SHAREPOINT_CLIENT_ID: "another-client" } as typeof env);
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ stage: "token", status: 401, code: "AADSTS7000215", requestId: "trace-1" });
    expect(r.error?.hint).toMatch(/Value \(not its Secret ID\)/);
    expect(r.steps.at(-1)).toMatchObject({ name: "Microsoft sign-in", ok: false });
    const line = logs.find((l) => l.includes("sharepoint_graph_error"))!;
    expect(JSON.parse(line)).toMatchObject({ level: "error", stage: "token", code: "AADSTS7000215" });
    expect(logs.join("\n")).not.toContain(SECRETS.SHAREPOINT_CLIENT_SECRET);
  });

  it("no access to the site (403) or a wrong id (404): what Graph said and what to fix", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ms = fakeMicrosoft({ item: () => Response.json({ error: { code: "accessDenied", message: "Access denied" } }, { status: 403, headers: { "request-id": "rq-403" } }) });
    let r = await checkWorkbook({ ...withSecrets, SHAREPOINT_CLIENT_ID: "client-403" } as typeof env);
    expect(r.error).toMatchObject({ stage: "file", status: 403, code: "accessDenied", requestId: "rq-403" });
    expect(r.error?.hint).toMatch(/Sites\.Selected/);
    ms.restore();
    ms = fakeMicrosoft({ item: () => Response.json({ error: { code: "itemNotFound", message: "The resource could not be found." } }, { status: 404 }) });
    r = await checkWorkbook({ ...withSecrets, SHAREPOINT_CLIENT_ID: "client-404" } as typeof env);
    expect(r.error).toMatchObject({ stage: "file", status: 404, code: "itemNotFound" });
    expect(r.error?.hint).toMatch(/SHAREPOINT_DRIVE_ID/);
  });
});

describe("request 55: the test space, kept in step with the workbook", () => {
  it("is for admins only; its pages answer from the test space, never the live workspace", async () => {
    expect((await call(w.a.analyst, "GET", "/api/database?stream=secondary", { headers: TEST })).status).toBe(403);
    const me = await json(call(w.a.admin, "GET", "/api/me", { headers: TEST }));
    expect(me.space).toBe("test");
    expect(me.tenant.name).toMatch(/ · Test$/);
    expect(me.tenant.id).toBe(`${w.a.id}-test`);
    expect((await json(call(w.a.admin, "GET", "/api/me"))).space).toBe("live");
  });

  it("publishes the rows, lists the ones it leaves out, then follows every change (edits, removals, profiles, sections)", async () => {
    const v1 = workbook({
      Primary: trackerSheet("primary", [{ record_id: "XP-1", title: "Excel primary one" }, { record_id: "XP-2", title: "Excel bad impact", impact: "Huge" }], ["Notes"]),
      Secondary: trackerSheet("secondary", [{ record_id: "XS-1", title: "Excel secondary one" }]),
      "Competitor Trend Analysis": [["Competitor", "Company Profile"], ["Roche", "Roche profile v1"]],
      "Macrotrend Analysis": [["Macrotrend", "Macrotrend overview", "Why does it matter?"], ["Geopolitics", "Overview v1", "Why v1"]],
    });
    expect((await uploadBook(w.a.analyst, v1)).status).toBe(403);
    const s1 = await syncAll(v1);
    expect(s1).toMatchObject({ linked: true, status: "idle", more: false, applied: { created: 2, updated: 0, deleted: 0, trends: 2 }, counts: { primary: 1, secondary: 1, competitors: 1, macrotrends: 1 } });
    expect(s1.issues).toEqual([expect.objectContaining({ sheet: "Primary", row: 3, column: expect.any(String), message: expect.stringMatching(/Huge/) })]);
    expect(s1.sheets.map((s: { name: string; kind: string }) => [s.name, s.kind])).toEqual([
      ["Primary", "primary"],
      ["Secondary", "secondary"],
      ["Competitor Trend Analysis", "competitor"],
      ["Macrotrend Analysis", "macrotrend"],
    ]);
    expect(s1.sheets[0].ignored).toEqual(["Notes"]);

    // In the test space only.
    const rows = async (headers: Record<string, string> = TEST) => (await json(call(w.a.admin, "GET", "/api/database?stream=secondary&from=2000-01-01&to=2100-01-01", { headers }))).rows as { id: string; values: Record<string, unknown> }[];
    const [entry] = (await rows()).filter((r) => r.values.record_id === "XS-1");
    expect(entry!.values.title).toBe("Excel secondary one");
    expect((await rows({})).some((r) => r.values.record_id === "XS-1")).toBe(false);

    // v2: a changed title, a removed row, a new profile, one section changed and one emptied.
    const v2 = workbook({
      Primary: trackerSheet("primary", []),
      Secondary: trackerSheet("secondary", [{ record_id: "XS-1", title: "Excel secondary renamed" }]),
      "Competitor Trend Analysis": [["Competitor", "Company Profile"], ["Roche", "Roche profile v2"]],
      "Macrotrend Analysis": [["Macrotrend", "Macrotrend overview", "Why does it matter?"], ["Geopolitics", "Overview v2", ""]],
    });
    const s2 = await syncAll(v2);
    expect(s2.applied).toEqual({ created: 0, updated: 1, deleted: 1, trends: 2 });
    expect(s2.counts).toEqual({ primary: 0, secondary: 1, competitors: 1, macrotrends: 1 });
    const [renamed] = (await rows()).filter((r) => r.values.record_id === "XS-1");
    expect(renamed!.id).toBe(entry!.id);
    expect(renamed!.values.title).toBe("Excel secondary renamed");
    // Its Markdown (from its Phantom) shows the workbook as it is now.
    const md = await (await call(w.a.admin, "GET", `/api/signals/${entry!.id}/markdown`, { headers: TEST })).text();
    expect(md).toContain("Excel secondary renamed");
    const sections = await json(call(w.a.admin, "GET", "/api/macrotrends/sections", { headers: TEST }));
    expect(sections.map((s: { section: string; text: string }) => [s.section, s.text])).toEqual([["overview", "Overview v2"]]);
    const comps = await json(call(w.a.admin, "GET", "/api/competitors?stream=all", { headers: TEST }));
    expect(comps.competitors.find((c: { name: string }) => c.name === "Roche").summary.text).toBe("Roche profile v2");
    // The live workspace has none of it.
    expect(await json(call(w.a.admin, "GET", "/api/macrotrends/sections"))).toEqual([]);

    // The same workbook again changes nothing (the workbook's Review Date is kept, so no edit comes back).
    const s3 = await syncAll(v2);
    expect(s3.applied).toEqual({ created: 0, updated: 0, deleted: 0, trends: 0 });
    const status = await json(call(w.a.admin, "GET", "/api/excel/status"));
    expect(status).toMatchObject({ linked: true, configured: false, status: "idle", file: { name: "Power_Automate_Test.xlsx" } });
  });

  it("a large first sync is applied a few rows at a time over several runs", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ record_id: `XM-${i + 1}`, title: `Excel many ${i + 1}` }));
    const book = workbook({ Primary: trackerSheet("primary", []), Secondary: trackerSheet("secondary", many), "Competitor Trend Analysis": [["Competitor", "Company Profile"]], "Macrotrend Analysis": [["Macrotrend", "Macrotrend overview"]] });
    const first = await json(uploadBook(w.a.admin, book));
    expect(first.more).toBe(true);
    expect(first.status).toBe("syncing");
    expect(first.applied.created).toBeGreaterThan(0);
    expect(first.applied.created).toBeLessThan(12);
    let s = first;
    for (let i = 0; i < 6 && s.more; i++) s = await json(uploadBook(w.a.admin, book));
    expect(s.more).toBe(false);
    expect(s.counts.secondary).toBe(12);
  });

  it("the every-minute check reads the workbook only when it changed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Not configured: nothing is asked of Microsoft.
    ms = fakeMicrosoft({});
    await runExcelCron(env);
    expect(ms.asked).toEqual([]);
    const book = workbook({ Primary: trackerSheet("primary", []), Secondary: trackerSheet("secondary", [{ record_id: "XC-1", title: "From the cron" }]), "Competitor Trend Analysis": [["Competitor", "Company Profile"]], "Macrotrend Analysis": [["Macrotrend", "Macrotrend overview"]] });
    let tag = "cron-1";
    ms.restore();
    ms = fakeMicrosoft({
      item: () => Response.json({ name: "Power_Automate_Test.xlsx", lastModifiedDateTime: "2026-10-13T10:00:00Z", cTag: tag, file: {} }),
      content: () => new Response(book),
    });
    await runExcelCron(withSecrets);
    const status = async () => json(call(w.a.admin, "GET", "/api/excel/status"));
    expect((await status()).counts.secondary).toBe(1);
    expect(ms.asked.filter((u) => u.endsWith("/content")).length).toBeGreaterThan(0);
    // Unchanged: only the file's version is asked for, and (request 56: checks come every 10 seconds) nothing is written.
    const checkedAt = async () => (await env.DB.prepare("SELECT last_checked_at AS at FROM excel_sync WHERE tenant_id = ?1").bind(w.a.id).first<{ at: string }>())?.at;
    const before = await checkedAt();
    ms.asked.length = 0;
    await runExcelCron(withSecrets);
    expect(ms.asked.some((u) => u.endsWith("/content"))).toBe(false);
    expect(ms.asked.some((u) => u.includes("/items/01ITEM?"))).toBe(true);
    expect(await checkedAt()).toBe(before);
    // The Test pages' check (Sync without force) says nothing was applied.
    const quiet = await app.fetch(new Request("https://api.test/api/excel/sync", { method: "POST", headers: { "x-dev-user": w.a.admin, "content-type": "application/json" }, body: "{}" }), withSecrets);
    expect(((await quiet.json()) as { applied: unknown }).applied).toEqual({ created: 0, updated: 0, deleted: 0, trends: 0 });
    // A new version is read again.
    tag = "cron-2";
    ms.asked.length = 0;
    await runExcelCron(withSecrets);
    expect(ms.asked.some((u) => u.endsWith("/content"))).toBe(true);
    // Sync now (force) through the API, with the secrets set.
    const res = await app.fetch(new Request("https://api.test/api/excel/sync", { method: "POST", headers: { "x-dev-user": w.a.admin, "content-type": "application/json" }, body: JSON.stringify({ force: true }) }), withSecrets);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: true, status: "idle", file: { name: "Power_Automate_Test.xlsx" } });
  });
});
