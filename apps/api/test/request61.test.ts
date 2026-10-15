import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { toXlsxSheets } from "@eradigm/shared";
import { newId, nowIso } from "../src/lib/ids";
import { readSheets } from "../src/projects/epilepsy/services/workbook";
import { call, env, json, seedWorld, type World } from "./helpers";

let w: World;
let epi: { id: string; slug: string };
const EPI = () => ({ "x-project": epi.slug });

beforeAll(async () => {
  w = await seedWorld();
  const r = Math.random().toString(36).slice(2, 8);
  epi = { id: `te_${r}`, slug: `epi-${r}` };
  const users = await env.DB.prepare("SELECT id, email FROM users WHERE email IN (?1, ?2)").bind(w.a.admin, w.a.client).all<{ id: string; email: string }>();
  const id = (email: string) => users.results!.find((u) => u.email === email)!.id;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tenants (id, name, slug, created_at, kind) VALUES (?1, 'Epilepsy', ?2, ?3, 'epilepsy')").bind(epi.id, epi.slug, nowIso()),
    env.DB.prepare("INSERT INTO role_assignments (id, tenant_id, user_id, role, assigned_at) VALUES (?1, ?2, ?3, 'admin', ?4)").bind(newId("rol"), epi.id, id(w.a.admin), nowIso()),
    env.DB.prepare("INSERT INTO role_assignments (id, tenant_id, user_id, role, assigned_at) VALUES (?1, ?2, ?3, 'client', ?4)").bind(newId("rol"), epi.id, id(w.a.client), nowIso()),
  ]);
});

describe("request 61: projects", () => {
  it("lists a person's projects, their first at the root and the others under /p/<slug>", async () => {
    const me = await json(call(w.a.admin, "GET", "/api/me"));
    expect(me.project).toMatchObject({ id: w.a.id, kind: "ci2", path: "" });
    expect(me.projects.map((p: { id: string; path: string }) => [p.id, p.path])).toEqual([
      [w.a.id, ""],
      [epi.id, `/p/${epi.slug}`],
    ]);
    const there = await json(call(w.a.admin, "GET", "/api/me", { headers: EPI() }));
    expect(there.project).toMatchObject({ id: epi.id, kind: "epilepsy", role: "admin" });
    expect(there.tenant.id).toBe(epi.id);
  });

  it("refuses a project the person has no access to", async () => {
    expect((await call(w.a.analyst, "GET", "/api/me", { headers: EPI() })).status).toBe(403);
    expect((await call(w.b.admin, "GET", "/api/me", { headers: { "x-project": "no-such-project" } })).status).toBe(403);
  });

  it("answers a project's routes only for its own workspaces", async () => {
    expect((await call(w.a.admin, "GET", "/api/tracker?stream=primary", { headers: EPI() })).status).toBe(404);
    expect((await call(w.a.admin, "GET", "/api/epilepsy/data")).status).toBe(404);
    expect((await call(w.a.admin, "GET", "/api/epilepsy/data", { headers: EPI() })).status).toBe(200);
    // The platform's routes answer in any project.
    expect((await call(w.a.admin, "GET", "/api/access", { headers: EPI() })).status).toBe(200);
  });
});

describe("request 61: access per project (Admin → Projects and access)", () => {
  const person = () => `p.${Math.random().toString(36).slice(2, 8)}@x.test`;

  it("lists the people of every project the caller manages", async () => {
    const a = await json(call(w.a.admin, "GET", "/api/access"));
    expect(a.projects.map((p: { id: string }) => p.id).sort()).toEqual([w.a.id, epi.id].sort());
    const client = a.people.find((p: { email: string }) => p.email === w.a.client);
    expect(client.access).toEqual({ [w.a.id]: { role: "client", active: true }, [epi.id]: { role: "client", active: true } });
    // An analyst sees only their own project; a client none.
    const b = await json(call(w.a.analyst, "GET", "/api/access"));
    expect(b.projects.map((p: { id: string }) => p.id)).toEqual([w.a.id]);
    expect((await call(w.a.client, "GET", "/api/access")).status).toBe(403);
  });

  it("adds a person to a project (with a sign-in link), gives them another, then takes one away", async () => {
    const email = person();
    const r = await call(w.a.admin, "POST", "/api/access", { body: { email, name: "New Person", projectId: epi.id, role: "analyst" } });
    expect(r.status).toBe(201);
    const added = await r.json<{ invite: { url: string }; userId: string; people: { email: string; access: object }[] }>();
    expect(added.invite.url).toMatch(/\/invite\//);
    expect(added.people.find((p) => p.email === email)?.access).toEqual({ [epi.id]: { role: "analyst", active: true } });
    // They can open Epilepsy, not CI SQUARED.
    expect((await json(call(email, "GET", "/api/me"))).project.id).toBe(epi.id);
    await call(w.a.admin, "PUT", `/api/access/${added.userId}`, { body: { projectId: w.a.id, role: "client" } });
    expect((await json(call(email, "GET", "/api/me"))).projects.map((p: { id: string }) => p.id)).toEqual([w.a.id, epi.id]);
    const after = await json(call(w.a.admin, "PUT", `/api/access/${added.userId}`, { body: { projectId: epi.id, role: null } }));
    expect(after.people.find((p: { email: string }) => p.email === email).access).toEqual({ [w.a.id]: { role: "client", active: true } });
    expect((await call(email, "GET", "/api/me", { headers: EPI() })).status).toBe(403);
  });

  it("nobody changes their own access, and analysts only add analysts and clients", async () => {
    const me = await json(call(w.a.admin, "GET", "/api/me"));
    expect((await call(w.a.admin, "PUT", `/api/access/${me.user.id}`, { body: { projectId: epi.id, role: "client" } })).status).toBe(403);
    // Another admin of Epilepsy can be made and demoted again (the caller stays its admin).
    const other = await json(call(w.a.admin, "POST", "/api/access", { body: { email: person(), name: "Other", projectId: epi.id, role: "admin" } }));
    expect((await call(w.a.admin, "PUT", `/api/access/${other.userId}`, { body: { projectId: epi.id, role: "analyst" } })).status).toBe(200);
    // (The caller is always one of the project's admins, so a project never loses its last admin.)
    // An analyst may add analysts and clients only, and change no one's access.
    expect((await call(w.a.analyst, "POST", "/api/access", { body: { email: person(), name: "X", projectId: w.a.id, role: "admin" } })).status).toBe(403);
    expect((await call(w.a.analyst, "PUT", `/api/access/${other.userId}`, { body: { projectId: w.a.id, role: "client" } })).status).toBe(403);
  });

  it("renames a project (its admins)", async () => {
    const r = await json(call(w.a.admin, "PATCH", `/api/projects/${epi.id}`, { body: { name: "Epilepsy CI" } }));
    expect(r).toMatchObject({ id: epi.id, name: "Epilepsy CI" });
    expect((await json(call(w.a.client, "GET", "/api/me", { headers: EPI() }))).project.name).toBe("Epilepsy CI");
    expect((await call(w.a.client, "PATCH", `/api/projects/${epi.id}`, { body: { name: "No" } })).status).toBe(403);
    // A project the caller is not in is not found.
    expect((await call(w.b.admin, "PATCH", `/api/projects/${epi.id}`, { body: { name: "No" } })).status).toBe(404);
    await call(w.a.admin, "PATCH", `/api/projects/${epi.id}`, { body: { name: "Epilepsy" } });
  });
});

/** The four sheets, as the workbook has them (a title row above sheet 3's header; companies written once per block). */
const WORKBOOK = {
  "Cover": [["Epilepsy dashboard"]],
  "1. Platform Secondary": [
    ["Date of Newsletter", "Date of News Article", "Article Topic", "Article Title", "URL", "Key Details", "CI Perspective"],
    ["2026-10-01", "45930", "Regulatory", "FDA accepts filing", "https://example.com/a", "Details", "Perspective"],
  ],
  "2. Platform Primary": [
    ["Event Date", "Source Role", "Source Company", "Source Location", "Source Confidence", "Employee Status", "Insight Topic", "KIQ", "Key Details"],
    ["2026-09-01", "KOL", "Hospital A", "UK", "High", "Current", "Pipeline", "KIQ 1", "First"],
    ["2026-09-01", "KOL", "Hospital A", "UK", "High", "Current", "Pricing", "KIQ 2", "Same conversation"],
  ],
  "3, Platform Competitor Profiles": [
    ["Competitor profiles (updated monthly)"],
    ["Company/competitor", "HQ", "Size", "Market Cap", "Q1 2026 Epilepsy Revenue", "Epilepsy Assets", "Asset Name"],
    ["UCB", "Brussels", "9,000", "$30B", "$1.2B", "Fintepla, Briviact", "Fintepla"],
    ["", "", "", "", "", "", "Briviact"],
  ],
  "4. Platform Trials & Assets": [
    ["Company/competitor", "Asset Name", "MoA", "RoA (+frequency)", "Current Phase", "FDA Approval Date", "Approval Date (calculated)", "NCT Number"],
    ["UCB", "Fintepla", "5-HT release", "Oral, BID", "Approved", "2020-06-25", "", "NCT1"],
    ["", "Briviact", "SV2A", "Oral, BID", "Phase 3", "", "2028", "NCT2"],
  ],
};

describe("request 61: the Epilepsy workbook", () => {
  it("reads the four sheets: finds each header row, fills a block's company down, and writes dates as YYYY-MM-DD", async () => {
    const s = await readSheets(toXlsxSheets(Object.entries(WORKBOOK).map(([name, table]) => ({ name, table }))));
    expect(s.secondary?.rows[0]?.slice(0, 2)).toEqual(["2026-10-01", "2025-09-30"]);
    expect(s.primary?.rows).toHaveLength(2);
    expect(s.profiles?.columns[0]).toBe("Company/competitor");
    expect(s.profiles?.rows.map((r) => [r[0], r[6]])).toEqual([
      ["UCB", "Fintepla"],
      ["UCB", "Briviact"],
    ]);
    // A year on its own stays a year.
    expect(s.assets?.rows[1]?.[6]).toBe("2028");
    expect(s.assets?.rows[1]?.[0]).toBe("UCB");
  });

  it("syncs from an upload (dev/test) and serves the sheets to everyone in the project", async () => {
    const form = new FormData();
    form.append("file", new File([toXlsxSheets(Object.entries(WORKBOOK).map(([name, table]) => ({ name, table })))], "Epilepsy Dashboard Excel.xlsx"));
    const st = await json(call(w.a.admin, "POST", "/api/epilepsy/upload", { form, headers: EPI() }));
    expect(st).toMatchObject({ status: "idle", counts: { secondary: 1, primary: 2, profiles: 2, assets: 2 } });
    const d = await json(call(w.a.client, "GET", "/api/epilepsy/data", { headers: EPI() }));
    expect(d.sheets.assets.name).toBe("4. Platform Trials & Assets");
    expect(d.sheets.primary.rows).toHaveLength(2);
    expect(d.syncedAt).toBeTruthy();
    // Clients read; only staff sync, and only admins change the settings.
    expect((await call(w.a.client, "POST", "/api/epilepsy/sync", { body: {}, headers: EPI() })).status).toBe(403);
    expect((await call(w.a.client, "PUT", "/api/epilepsy/settings", { body: { colours: { UCB: "#123456" } }, headers: EPI() })).status).toBe(403);
    await call(w.a.admin, "PUT", "/api/epilepsy/settings", { body: { colours: { UCB: "#123456" } }, headers: EPI() });
    expect((await json(call(w.a.client, "GET", "/api/epilepsy/data", { headers: EPI() }))).colours).toEqual({ UCB: "#123456" });
    expect((await call(w.a.admin, "PUT", "/api/epilepsy/settings", { body: { colours: { UCB: "red" } }, headers: EPI() })).status).toBe(422);
  });
});

describe("request 61: the Epilepsy workbook on SharePoint", () => {
  const SECRETS = { SHAREPOINT_TENANT_ID: "t", SHAREPOINT_CLIENT_ID: "c", SHAREPOINT_CLIENT_SECRET: "s" };
  let real: typeof fetch | null = null;
  afterEach(() => {
    if (real) globalThis.fetch = real;
    real = null;
  });

  it("finds the workbook from its sharing link (or, when Graph will not open the link, by name on its site) and reads it", async () => {
    const { syncEpilepsy } = await import("../src/projects/epilepsy/services/workbook");
    const asked: string[] = [];
    const bytes = toXlsxSheets(Object.entries(WORKBOOK).map(([name, table]) => ({ name, table })));
    real = globalThis.fetch;
    const r0 = real;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!/login\.microsoftonline\.com|graph\.microsoft\.com/.test(url)) return r0(input, init);
      asked.push(url);
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
      if (url.includes("/shares/")) return Response.json({ error: { code: "accessDenied", message: "Access denied" } }, { status: 403 });
      if (url.includes("/sites/eradigm.sharepoint.com:/sites/16-42UCBEpilepsyCI2026-2027")) return Response.json({ id: "site1" });
      if (url.includes("/search(")) return Response.json({ value: [{ id: "item9", name: "Epilepsy Dashboard Excel.xlsx", file: {}, parentReference: { driveId: "b!drv" } }] });
      if (url.endsWith("/content")) return new Response(bytes);
      return Response.json({ name: "Epilepsy Dashboard Excel.xlsx", lastModifiedDateTime: "2026-10-15T09:00:00Z", cTag: "v1", webUrl: "https://eradigm.sharepoint.com/x", file: {} });
    }) as typeof fetch;
    const e = { ...env, ...SECRETS } as typeof env;
    await env.DB.prepare("INSERT OR IGNORE INTO epilepsy_workbook (tenant_id) VALUES (?1)").bind(epi.id).run();
    await env.DB.prepare("UPDATE epilepsy_workbook SET link = ?2, drive_id = NULL, item_id = NULL, version = NULL WHERE tenant_id = ?1")
      .bind(epi.id, "https://eradigm.sharepoint.com/:x:/s/16-42UCBEpilepsyCI2026-2027/IQD5Tjpk4jSBSpcwtzM5DXOrAbb8uYKemou1RXkHTjZGnAo?e=2eds7u")
      .run();
    const s = await syncEpilepsy(e, epi.id, null, { force: true });
    expect(s).toMatchObject({ status: "idle", file: { name: "Epilepsy Dashboard Excel.xlsx" }, counts: { primary: 2 } });
    expect(asked.some((u) => u.includes("/drives/b!drv/items/item9/content"))).toBe(true);
    // Unchanged on the next check: one call for the file's version, no download.
    asked.length = 0;
    await env.DB.prepare("UPDATE epilepsy_workbook SET lock_until = NULL WHERE tenant_id = ?1").bind(epi.id).run();
    await syncEpilepsy(e, epi.id, null);
    expect(asked.filter((u) => u.endsWith("/content"))).toHaveLength(0);
  });
});
