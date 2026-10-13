import { describe, expect, it } from "vitest";
import { DEFAULT_MENU, normaliseMenu, visibleMenu } from "@eradigm/shared";

describe("request 53: the Knowledge Graph tab is gone", () => {
  it("is not in the menu; a menu saved with it drops it and keeps the rest", () => {
    expect(DEFAULT_MENU.groups.find((g) => g.key === "analytics")!.items.map((i) => i.key)).toEqual(["dashboard"]);
    const m = normaliseMenu({
      groups: [{ key: "analytics", label: "Insights", items: [{ key: "knowledge-graph", label: "Graph" }, { key: "primary-tracker", label: "Interviews" }, { key: "dashboard" }] }],
    });
    // (Request 56: the Primary Tracker went too.)
    expect(m.groups.find((g) => g.key === "analytics")).toEqual({ key: "analytics", label: "Insights", items: [{ key: "dashboard" }] });
    expect(visibleMenu(m, "client").flatMap((g) => g.items.map((i) => i.key))).not.toContain("knowledge-graph");
  });
});
