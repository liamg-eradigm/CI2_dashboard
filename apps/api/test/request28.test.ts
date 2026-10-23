import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MENU, groupLabel, normaliseMenu, visibleMenu } from "@eradigm/shared";
import { call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

describe("request 28: the menu (request 70: every tab its own, no subtabs)", () => {
  it("makes a stored menu whole: unknown, repeated or misplaced tabs dropped, missing ones back in place, names trimmed", () => {
    const m = normaliseMenu({
      groups: [
        { key: "admin", label: "  Back   office ", items: [{ key: "admin", label: "Settings" }, { key: "tracker" }, { key: "admin" }] },
        { key: "nope", items: [] },
        // Request 63: the Test tab is gone; a menu saved with it drops it.
        { key: "test", items: [{ key: "test-database" }] },
        { key: "trackers", label: "", items: [{ key: "phantoms" }, { key: "tracker", label: "   " }] },
      ],
    });
    // The tabs it left out go back after the tab they follow by default (first when they lead).
    expect(m.groups.map((g) => g.key)).toEqual(["input", "inbox", "clientinbox", "dashboard", "database", "admin"]);
    expect(m.groups[5]).toEqual({ key: "admin", label: "Back office", items: [{ key: "admin", label: "Settings" }] });
    expect(normaliseMenu(undefined)).toEqual(DEFAULT_MENU);
    // A client sees the Client Inbox, the Dashboard and the Database.
    expect(visibleMenu(DEFAULT_MENU, "client").map((g) => `${g.key}:${g.items.map((i) => i.key).join(",")}`)).toEqual(["clientinbox:clientinbox", "dashboard:dashboard", "database:database"]);
    // Request 70: analysts add entries (New Entry) and work the Eradigm Inbox.
    expect(visibleMenu(DEFAULT_MENU, "analyst").map((g) => g.key)).toEqual(["input", "inbox", "dashboard", "database"]);
    expect(DEFAULT_MENU.groups.map((g) => groupLabel(g))).toEqual(["New Entry", "Eradigm Inbox", "Client Inbox", "Dashboard", "Database", "Admin"]);
  });

  it("lays out a menu saved before request 31 afresh, keeping the names given to what remains", () => {
    const m = normaliseMenu({
      groups: [
        { key: "admin", label: "Back office", items: [{ key: "admin" }, { key: "deliverables", label: "Reports" }] },
        { key: "trackers", items: [{ key: "phantoms", label: "Phantom files" }, { key: "tracker" }, { key: "dashboard", label: "Overview" }, { key: "trend-analyses" }] },
        { key: "megatrends", label: "Trends", items: [{ key: "megatrends" }, { key: "megatrends-analysis" }] },
        { key: "competitors", items: [{ key: "competitors" }, { key: "competitors-analysis" }] },
        { key: "inputs", items: [{ key: "inbox" }, { key: "input" }, { key: "clientinbox" }] },
      ],
    });
    expect(m).toEqual({
      groups: [
        { key: "input", items: [{ key: "input" }] },
        { key: "inbox", items: [{ key: "inbox" }] },
        { key: "clientinbox", items: [{ key: "clientinbox" }] },
        { key: "dashboard", label: "Overview", items: [{ key: "dashboard" }] },
        { key: "database", items: [{ key: "database" }] },
        { key: "admin", label: "Back office", items: [{ key: "admin" }] },
      ],
    });
  });

  it("request 70: a menu saved with groups and subtabs keeps its order and names, each tab its own", () => {
    const m = normaliseMenu({
      groups: [
        { key: "admin", label: "Back office", items: [{ key: "admin" }] },
        { key: "inputs", label: "Sources", items: [{ key: "inbox", label: "Leads" }, { key: "input", label: "Add sources" }] },
        { key: "analytics", label: "Insights", items: [{ key: "dashboard" }] },
        { key: "database", items: [{ key: "database" }] },
      ],
    });
    expect(m.groups.map((g) => [g.key, groupLabel(g)])).toEqual([
      ["admin", "Back office"],
      ["inbox", "Leads"],
      ["input", "Add sources"],
      // Left out of the saved group: after the tab it follows by default.
      ["clientinbox", "Client Inbox"],
      ["dashboard", "Insights"],
      ["database", "Database"],
    ]);
  });

  it("is a workspace setting only admins change", async () => {
    const s = await json(call(w.a.client, "GET", "/api/settings"));
    expect(s.menu).toEqual(DEFAULT_MENU);
    const menu = { groups: [{ key: "inbox", label: "Leads", items: [{ key: "inbox" }] }, { key: "input", label: "Add sources", items: [{ key: "input" }] }] };
    expect((await call(w.a.analyst, "PATCH", "/api/settings", { body: { menu } })).status).toBe(403);
    const saved = await json(call(w.a.admin, "PATCH", "/api/settings", { body: { menu } }));
    expect(saved.menu.groups[0]).toEqual({ key: "inbox", label: "Leads", items: [{ key: "inbox" }] });
    expect(saved.menu.groups.find((g: { key: string }) => g.key === "input")).toEqual({ key: "input", label: "Add sources", items: [{ key: "input" }] });
    expect(saved.menu.groups).toHaveLength(6);
    // Other settings leave it alone; another workspace is unaffected.
    const again = await json(call(w.a.admin, "PATCH", "/api/settings", { body: { timezone: "Europe/Paris" } }));
    expect(again.menu.groups[0].label).toBe("Leads");
    expect((await json(call(w.b.admin, "GET", "/api/settings"))).menu).toEqual(DEFAULT_MENU);
    // Unknown groups or tabs are refused.
    expect((await call(w.a.admin, "PATCH", "/api/settings", { body: { menu: { groups: [{ key: "secret", items: [] }] } } })).status).toBe(422);
  });
});
