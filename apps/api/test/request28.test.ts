import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MENU, normaliseMenu, visibleMenu } from "@eradigm/shared";
import { call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

describe("request 28: the menu in groups", () => {
  it("makes a stored menu whole: unknown, repeated or misplaced tabs dropped, missing ones back in place, names trimmed", () => {
    const m = normaliseMenu({
      groups: [
        { key: "admin", label: "  Back   office ", items: [{ key: "admin", label: "Settings" }, { key: "tracker" }, { key: "admin" }] },
        { key: "nope", items: [] },
        { key: "trackers", label: "", items: [{ key: "phantoms" }, { key: "tracker", label: "   " }] },
      ],
    });
    expect(m.groups.map((g) => g.key)).toEqual(["admin", "trackers", "megatrends", "competitors", "inputs"]);
    // Deliverables was missing: it leads the group by default, so it goes first.
    expect(m.groups[0]).toEqual({ key: "admin", label: "Back office", items: [{ key: "deliverables" }, { key: "admin", label: "Settings" }] });
    // Dashboard was missing: it goes back after the tab it follows by default (Tracker); Trend Analyses (request 29) after Phantoms.
    expect(m.groups[1]).toEqual({ key: "trackers", items: [{ key: "phantoms" }, { key: "trend-analyses" }, { key: "tracker" }, { key: "dashboard" }] });
    expect(normaliseMenu(undefined)).toEqual(DEFAULT_MENU);
    // A client sees no Admin group and only the Client Inbox in Inputs.
    expect(visibleMenu(DEFAULT_MENU, "client").map((g) => `${g.key}:${g.items.map((i) => i.key).join(",")}`)).toEqual([
      "trackers:tracker,dashboard,phantoms,trend-analyses",
      "megatrends:megatrends,megatrends-analysis",
      "competitors:competitors,competitors-analysis",
      "inputs:clientinbox",
    ]);
  });

  it("is a workspace setting only admins change", async () => {
    const s = await json(call(w.a.client, "GET", "/api/settings"));
    expect(s.menu).toEqual(DEFAULT_MENU);
    const menu = { groups: [{ key: "inputs", label: "Sources", items: [{ key: "inbox" }, { key: "input", label: "Add sources" }] }] };
    expect((await call(w.a.analyst, "PATCH", "/api/settings", { body: { menu } })).status).toBe(403);
    const saved = await json(call(w.a.admin, "PATCH", "/api/settings", { body: { menu } }));
    // The Client Inbox (left out) goes back after the Eradigm Inbox, the tab it follows by default.
    expect(saved.menu.groups[0]).toEqual({ key: "inputs", label: "Sources", items: [{ key: "inbox" }, { key: "clientinbox" }, { key: "input", label: "Add sources" }] });
    expect(saved.menu.groups).toHaveLength(5);
    // Other settings leave it alone; another workspace is unaffected.
    const again = await json(call(w.a.admin, "PATCH", "/api/settings", { body: { timezone: "Europe/Paris" } }));
    expect(again.menu.groups[0].label).toBe("Sources");
    expect((await json(call(w.b.admin, "GET", "/api/settings"))).menu).toEqual(DEFAULT_MENU);
    // Unknown groups or tabs are refused.
    expect((await call(w.a.admin, "PATCH", "/api/settings", { body: { menu: { groups: [{ key: "secret", items: [] }] } } })).status).toBe(422);
  });
});
