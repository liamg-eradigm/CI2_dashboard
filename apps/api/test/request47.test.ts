import { beforeAll, describe, expect, it } from "vitest";
import { call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

describe("request 47: title and heading sizes", () => {
  it("staff set a size for everyone; 1 puts it back; clients and bad keys or sizes are refused", async () => {
    const s = await json(call(w.a.analyst, "PUT", "/api/settings/text-size", { body: { key: "entry-title", size: 1.3 } }));
    expect(s.textSizes).toEqual({ "entry-title": 1.3 });
    const h = await json(call(w.a.admin, "PUT", "/api/settings/text-size", { body: { key: "heading:ai-summary", size: 0.85 } }));
    expect(h.textSizes).toEqual({ "entry-title": 1.3, "heading:ai-summary": 0.85 });
    // Everyone reads them with the settings.
    expect((await json(call(w.a.client, "GET", "/api/settings"))).textSizes["entry-title"]).toBe(1.3);
    // Other settings saved later keep them.
    expect((await json(call(w.a.admin, "PATCH", "/api/settings", { body: { timezone: "UTC" } }))).textSizes["heading:ai-summary"]).toBe(0.85);
    const back = await json(call(w.a.analyst, "PUT", "/api/settings/text-size", { body: { key: "entry-title", size: 1 } }));
    expect(back.textSizes).toEqual({ "heading:ai-summary": 0.85 });
    expect((await call(w.a.client, "PUT", "/api/settings/text-size", { body: { key: "entry-title", size: 1.3 } })).status).toBe(403);
    expect((await call(w.a.admin, "PUT", "/api/settings/text-size", { body: { key: "Bad Key!", size: 1.3 } })).status).toBe(422);
    expect((await call(w.a.admin, "PUT", "/api/settings/text-size", { body: { key: "entry-title", size: 9 } })).status).toBe(422);
    // Tenants keep their own sizes.
    expect((await json(call(w.b.admin, "GET", "/api/settings"))).textSizes).toEqual({});
  });
});
