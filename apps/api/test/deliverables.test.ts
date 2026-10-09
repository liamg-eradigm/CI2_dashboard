import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=100";

/** A manual entry, approved with these values; returns its signal id. */
async function entry(stream: "primary" | "secondary", title: string, impact: string) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  const res = await approveWith(w.a.analyst, item, { title, impact });
  expect(res.status).toBe(200);
  return item.id as string;
}

type Row = { id: string; alertId?: string | null };
const row = async (stream: string, id: string) => ((await json(call(w.a.client, "GET", `/api/database?stream=${stream}&${RANGE}`))).rows as Row[]).find((r) => r.id === id)!;
/** The .docx is stored uncompressed, so its XML can be read from the bytes. */
const docxText = async (res: Response) => new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));

// Request 52: Admin → Deliverables is gone; alerts open from the Database and newsletters are listed on Database → Newsletter.
describe("Deliverables (alerts and newsletters)", () => {
  it("serves each Database entry's alert as a .docx, inline or as a download, only in its own tenant", async () => {
    const high = await entry("primary", "Roche launches an AI lab & <pilot>", "High");
    const r = await row("primary", high);
    expect(r.alertId).toMatch(/^dlv_/);
    // Stored once: listing again returns the same alert.
    expect((await row("primary", high)).alertId).toBe(r.alertId);

    const res = await call(w.a.client, "GET", `/api/deliverables/${r.alertId}/docx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="[^"]+-alert\.docx"$/);
    const xml = await docxText(res);
    // Written into the alert template, the Title XML-escaped.
    expect(xml).toContain('<w:t xml:space="preserve">Roche launches an AI lab &amp; &lt;pilot&gt;</w:t>');
    expect(xml).not.toContain("&lt;Insert Title&gt;");
    const dl = await call(w.a.client, "GET", `/api/deliverables/${r.alertId}/docx?download=1`);
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; /);
    expect((await call(w.b.admin, "GET", `/api/deliverables/${r.alertId}/docx`)).status).toBe(404);
  });

  it("the removed Deliverables endpoints are gone", async () => {
    expect((await call(w.a.client, "GET", `/api/deliverables/alerts?stream=primary&${RANGE}`)).status).toBe(404);
    expect((await call(w.a.client, "GET", `/api/deliverables/newsletter?stream=primary&${RANGE}`)).status).toBe(404);
    const high = await entry("primary", "Newsletter high", "High");
    expect((await call(w.a.analyst, "POST", "/api/newsletters", { body: { name: "Old", itemIds: [high] } })).status).toBe(404);
  });

  it("lists generated newsletters newest first in the tenant, each downloadable, keeping entries deleted later (marked)", async () => {
    const a = await entry("secondary", "Newsletter list one", "Low");
    const b = await entry("primary", "Newsletter list two", "Medium");
    const gen = (ids: string[], who = w.a.analyst) => call(who, "POST", "/api/newsletters/generate", { body: { itemIds: ids, sections: Object.fromEntries(ids.map((id) => [id, "technology"])) } });
    expect((await gen([a, b], w.a.client)).status).toBe(403);
    const first = await json(gen([a, b]));
    const second = await json(gen([b]));
    const list = await json(call(w.a.client, "GET", "/api/newsletters"));
    expect(list.map((x: { id: string }) => x.id).slice(0, 2)).toEqual([second.id, first.id]);
    expect(await json(call(w.b.admin, "GET", "/api/newsletters"))).toEqual([]);
    const doc = await call(w.a.client, "GET", `/api/deliverables/${first.id}/docx?download=1`);
    expect(doc.status).toBe(200);
    expect(doc.headers.get("content-disposition")).toMatch(/^attachment; filename="[^"]+\.docx"$/);

    await call(w.a.analyst, "DELETE", `/api/items/${b}`);
    const n = (await json(call(w.a.client, "GET", "/api/newsletters"))).find((x: { id: string }) => x.id === first.id);
    expect(n.items.find((i: { id: string }) => i.id === b).deleted).toBe(true);
  });
});
