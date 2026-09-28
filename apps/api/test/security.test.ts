import { CONTRACT_VERSION } from "@eradigm/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { call, env, ingest, approveWith, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

describe("authentication", () => {
  it("serves health without authentication", async () => {
    const r = await call(null, "GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.headers.get("x-contract-version")).toBe(CONTRACT_VERSION);
  });

  it("rejects anonymous and unknown users", async () => {
    expect((await call(null, "GET", "/api/me")).status).toBe(401);
    expect((await call("stranger@nowhere.test", "GET", "/api/me")).status).toBe(403);
  });

  it("returns the caller's role, tenant and permissions", async () => {
    const me = await json(call(w.a.client, "GET", "/api/me"));
    expect(me.role).toBe("client");
    expect(me.tenant.id).toBe(w.a.id);
    expect(me.permissions).not.toContain("submission:create");
  });

  it("audits each sign-in once", async () => {
    await call(w.a.admin, "GET", "/api/me");
    await call(w.a.admin, "GET", "/api/me");
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE chain = ?1 AND action = 'auth.sign_in' AND actor_email = ?2").bind(w.a.id, w.a.admin).first<{ n: number }>();
    expect(r?.n).toBe(1);
  });
});

describe("role checks are enforced by the API, not the interface", () => {
  it.each([
    ["GET", "/api/items"],
    ["GET", "/api/capture-log"],
    ["POST", "/api/submissions"],
    ["POST", "/api/schema/columns"],
    ["GET", "/api/users"],
    ["GET", "/api/audit"],
    ["PATCH", "/api/settings"],
  ])("client cannot %s %s", async (method, path) => {
    const r = await call(w.a.client, method, path, method === "GET" ? {} : { body: { url: "https://example.com", label: "X", type: "text" } });
    expect(r.status).toBe(403);
  });

  it("client can read the dashboard, tracker, schema and settings", async () => {
    for (const p of ["/api/dashboard", "/api/tracker", "/api/schema", "/api/settings", "/api/views"]) {
      expect((await call(w.a.client, "GET", p)).status).toBe(200);
    }
  });

  it("analysts cannot read the audit log or change settings", async () => {
    expect((await call(w.a.analyst, "GET", "/api/audit")).status).toBe(403);
    expect((await call(w.a.analyst, "PATCH", "/api/settings", { body: { timezone: "UTC" } })).status).toBe(403);
  });
});

describe("tenant isolation", () => {
  let itemA: any;
  beforeAll(async () => {
    itemA = await ingest(w.a.analyst, "Tenant A exclusive news", "Roche opened a robotics-enabled lab in Basel for tenant A only. It will double throughput by 2027 according to the company.");
    const ok = await approveWith(w.a.analyst, itemA);
    expect(ok.status).toBe(200);
  });

  it("blocks cross-tenant reads of items, signals and snapshots", async () => {
    expect((await call(w.b.analyst, "GET", `/api/items/${itemA.id}`)).status).toBe(404);
    expect((await call(w.b.analyst, "GET", `/api/signals/${itemA.id}`)).status).toBe(404);
    expect((await call(w.b.analyst, "GET", `/api/items/${itemA.id}/snapshot`)).status).toBe(404);
  });

  it("blocks cross-tenant writes", async () => {
    const r1 = await call(w.b.analyst, "POST", `/api/items/${itemA.id}/reject`, { body: { version: itemA.version } });
    expect(r1.status).toBe(404);
    const r2 = await call(w.b.admin, "DELETE", `/api/items/${itemA.id}`);
    expect(r2.status).toBe(404);
    const r3 = await call(w.b.analyst, "POST", `/api/signals/${itemA.id}/revise`, { body: { values: {}, note: "x" } });
    expect(r3.status).toBe(404);
  });

  it("never returns another tenant's signals in lists, aggregates or exports", async () => {
    const tracker = await json(call(w.b.analyst, "GET", "/api/tracker?from=2000-01-01&to=2100-01-01&pageSize=100"));
    expect(tracker.rows.map((r: any) => r.id)).not.toContain(itemA.id);
    expect(tracker.totalPublished).toBe(0);
    const dash = await json(call(w.b.analyst, "GET", "/api/dashboard?from=2000-01-01&to=2100-01-01"));
    expect(dash.kpis.approved).toBe(0);
    const csv = await (await call(w.b.analyst, "GET", "/api/tracker/export?scope=all&format=csv")).text();
    expect(csv).not.toContain("Tenant A exclusive");
  });

  it("rejects selecting a tenant the user does not belong to", async () => {
    expect((await call(w.b.analyst, "GET", "/api/me", { tenant: w.a.id })).status).toBe(403);
    expect((await call(w.b.analyst, "GET", "/api/me", { tenant: "t_does_not_exist" })).status).toBe(403);
  });

  it("lets a multi-tenant user switch tenants explicitly", async () => {
    const a = await json(call(w.both, "GET", "/api/me", { tenant: w.a.id }));
    const b = await json(call(w.both, "GET", "/api/me", { tenant: w.b.id }));
    expect(a.tenant.id).toBe(w.a.id);
    expect(b.tenant.id).toBe(w.b.id);
    expect((await call(w.both, "GET", `/api/items/${itemA.id}`, { tenant: w.b.id })).status).toBe(404);
    expect((await call(w.both, "GET", `/api/items/${itemA.id}`, { tenant: w.a.id })).status).toBe(200);
  });
});

describe("account administration", () => {
  it("lets analysts create analyst and client accounts only in their tenant", async () => {
    const r1 = await call(w.a.analyst, "POST", "/api/users", { body: { email: "new.client@a.test", name: "New Client", role: "client" } });
    expect(r1.status).toBe(201);
    const r2 = await call(w.a.analyst, "POST", "/api/users", { body: { email: "new.admin@a.test", name: "New Admin", role: "admin" } });
    expect(r2.status).toBe(403);
    const users = await json(call(w.b.admin, "GET", "/api/users"));
    expect(users.map((u: any) => u.email)).not.toContain("new.client@a.test");
  });

  it("lets only admins change roles, keeping role history", async () => {
    const created = await json(call(w.a.admin, "POST", "/api/users", { body: { email: "promote.me@a.test", name: "Promote Me", role: "client" } }));
    expect((await call(w.a.analyst, "PATCH", `/api/users/${created.id}`, { body: { role: "analyst" } })).status).toBe(403);
    const up = await json(call(w.a.admin, "PATCH", `/api/users/${created.id}`, { body: { role: "analyst" } }));
    expect(up.role).toBe("analyst");
    const hist = await env.DB.prepare("SELECT role, revoked_at FROM role_assignments WHERE user_id = ?1 ORDER BY assigned_at").bind(created.id).all<{ role: string; revoked_at: string | null }>();
    expect(hist.results?.map((h) => [h.role, !!h.revoked_at])).toEqual([
      ["client", true],
      ["analyst", false],
    ]);
  });

  it("deactivation blocks access immediately", async () => {
    const u = await json(call(w.a.admin, "POST", "/api/users", { body: { email: "leaver@a.test", name: "Leaver", role: "client" } }));
    expect((await call("leaver@a.test", "GET", "/api/me")).status).toBe(200);
    await call(w.a.admin, "PATCH", `/api/users/${u.id}`, { body: { active: false } });
    expect((await call("leaver@a.test", "GET", "/api/me")).status).toBe(403);
  });

  it("ending sessions rejects tokens issued before the revocation", async () => {
    const u = await json(call(w.a.admin, "POST", "/api/users", { body: { email: "session@a.test", name: "Session", role: "client" } }));
    const old = String(Math.floor(Date.now() / 1000) - 60);
    expect((await call("session@a.test", "GET", "/api/me", { headers: { "x-dev-iat": old } })).status).toBe(200);
    expect((await call(w.a.admin, "POST", `/api/users/${u.id}/sessions/revoke`)).status).toBe(200);
    expect((await call("session@a.test", "GET", "/api/me", { headers: { "x-dev-iat": old } })).status).toBe(401);
    const fresh = String(Math.floor(Date.now() / 1000) + 5);
    expect((await call("session@a.test", "GET", "/api/me", { headers: { "x-dev-iat": fresh } })).status).toBe(200);
  });

  it("keeps at least one admin", async () => {
    const users = await json(call(w.b.admin, "GET", "/api/users"));
    const me = users.find((u: any) => u.email === w.b.admin);
    expect((await call(w.b.admin, "PATCH", `/api/users/${me.id}`, { body: { role: "analyst" } })).status).toBe(403);
  });
});

describe("tamper-resistant audit record", () => {
  it("verifies the hash chain and blocks updates and deletes", async () => {
    const v = await json(call(w.a.admin, "GET", "/api/audit/verify"));
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(5);
    await expect(env.DB.prepare("UPDATE audit_events SET action = 'x' WHERE chain = ?1").bind(w.a.id).run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM audit_events WHERE chain = ?1").bind(w.a.id).run()).rejects.toThrow(/append-only/);
  });

  it("detects modification even if the triggers are bypassed", async () => {
    await env.DB.prepare("DROP TRIGGER audit_events_no_update").run();
    await env.DB.prepare("UPDATE audit_events SET details_json = '{\"forged\":true}' WHERE seq = (SELECT MIN(seq) FROM audit_events WHERE chain = ?1)").bind(w.b.id).run();
    const v = await json(call(w.b.admin, "GET", "/api/audit/verify"));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/modified/);
    await env.DB.prepare("CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END").run();
  });
});
