import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_WORKSTREAMS } from "@eradigm/shared";
import { call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

describe("request 31", () => {
  it("makes the Primary Workstream a dropdown of the nine workstreams (Secondary has none)", async () => {
    const p = await json(call(w.a.analyst, "GET", "/api/schema?stream=primary"));
    const ws = p.columns.find((c: { key: string }) => c.key === "workstream");
    expect(ws).toMatchObject({ label: "Workstream", type: "select", options: DEFAULT_WORKSTREAMS });
    expect(DEFAULT_WORKSTREAMS).toEqual([
      "Digital and Data Platforms",
      "Salesforce Tools Effectiveness",
      "DTP and Hub-adjacent tech",
      "AI Upskilling",
      "Omni-channel and Engagement Platforms",
      "Commercial Excellence",
      "Digital and GenAI training",
      "Digital and GenAI Platforms, Agents, and Implementation",
      "EHR Integrations",
    ]);
    const s = await json(call(w.a.analyst, "GET", "/api/schema?stream=secondary"));
    expect(s.columns.some((c: { key: string }) => c.key === "workstream")).toBe(false);
  });

  it("lets the Primary columns be edited (Edit columns → Primary), apart from the Secondary ones", async () => {
    const r = await call(w.a.admin, "POST", "/api/schema/columns/workstream/options?stream=primary", { body: { value: "Market Access" } });
    expect(r.status, await r.clone().text()).toBeLessThan(300);
    const p = await json(call(w.a.analyst, "GET", "/api/schema?stream=primary"));
    expect(p.columns.find((c: { key: string }) => c.key === "workstream").options).toContain("Market Access");
    const renamed = await call(w.a.admin, "PATCH", "/api/schema/columns/source_role?stream=primary", { body: { label: "Interviewee Role" } });
    expect(renamed.status, await renamed.clone().text()).toBeLessThan(300);
    expect((await json(call(w.a.analyst, "GET", "/api/schema?stream=primary"))).columns.find((c: { key: string }) => c.key === "source_role").label).toBe("Interviewee Role");
  });
});
