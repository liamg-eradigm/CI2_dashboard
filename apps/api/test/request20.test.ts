import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

async function manual(stream: "primary" | "secondary") {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  return item as { id: string; version: number; draft: Record<string, unknown> };
}
async function pushed(stream: "primary" | "secondary", title: string) {
  const item = await manual(stream);
  const res = await approveWith(w.a.analyst, item, { title });
  if (res.status !== 200) throw new Error(await res.text());
  return item.id;
}
async function rejected(stream: "primary" | "secondary") {
  const item = await manual(stream);
  const res = await call(w.a.analyst, "POST", `/api/items/${item.id}/reject`, { body: { version: item.version, reason: "Not relevant" } });
  if (res.status !== 200) throw new Error(await res.text());
  return item.id;
}
const decided = async () => (await json<{ id: string }[]>(call(w.a.analyst, "GET", "/api/items?status=approved,rejected"))).map((i) => i.id);
const trackerIds = async (stream: "primary" | "secondary") =>
  (await json(call(w.a.client, "GET", `/api/tracker?stream=${stream}&from=2000-01-01&to=2100-01-01&pageSize=1000`))).rows.map((r: { id: string }) => r.id);

describe("Delete All in Pushed & Rejected", () => {
  it("deletes rejected entries and clears pushed ones from the Inbox only, one stream at a time", async () => {
    const pPrimary = await pushed("primary", "Pushed primary");
    const rPrimary = await rejected("primary");
    const pSecondary = await pushed("secondary", "Pushed secondary");
    const rSecondary = await rejected("secondary");
    expect(await decided()).toEqual(expect.arrayContaining([pPrimary, rPrimary, pSecondary, rSecondary]));

    // Clients cannot, and nor can another tenant's staff reach these entries.
    expect((await call(w.a.client, "POST", "/api/items/clear-decided", { body: {} })).status).toBe(403);
    expect(await json(call(w.b.admin, "POST", "/api/items/clear-decided", { body: {} }))).toEqual({ rejectedDeleted: 0, pushedCleared: 0 });

    // Secondary only.
    expect(await json(call(w.a.analyst, "POST", "/api/items/clear-decided", { body: { stream: "secondary" } }))).toEqual({ rejectedDeleted: 1, pushedCleared: 1 });
    let ids = await decided();
    expect(ids).not.toContain(pSecondary);
    expect(ids).not.toContain(rSecondary);
    expect(ids).toEqual(expect.arrayContaining([pPrimary, rPrimary]));
    // The pushed entry is still in the Tracker; the rejected one is gone.
    expect(await trackerIds("secondary")).toContain(pSecondary);
    expect((await json(call(w.a.analyst, "GET", `/api/items/${rSecondary}`))).status).toBe("deleted");

    // Then everything; a second run has nothing left to do.
    expect(await json(call(w.a.admin, "POST", "/api/items/clear-decided", { body: {} }))).toEqual({ rejectedDeleted: 1, pushedCleared: 1 });
    ids = await decided();
    expect(ids).not.toContain(pPrimary);
    expect(ids).not.toContain(rPrimary);
    expect(await trackerIds("primary")).toContain(pPrimary);
    expect(await json(call(w.a.admin, "POST", "/api/items/clear-decided", { body: {} }))).toEqual({ rejectedDeleted: 0, pushedCleared: 0 });

    // Entries still awaiting review are untouched; it is in the audit log.
    const pending = await manual("secondary");
    await call(w.a.admin, "POST", "/api/items/clear-decided", { body: {} });
    expect((await json(call(w.a.analyst, "GET", `/api/items/${pending.id}`))).status).toBe("needs_review");
    const audit = await json(call(w.a.admin, "GET", "/api/audit?limit=20"));
    expect(JSON.stringify(audit)).toContain("inbox.cleared");
  });
});

describe("Text ⇄ Long text", () => {
  it("switches a text column to Long text and back, refusing when a value is too long", async () => {
    const add = await json(call(w.a.admin, "POST", "/api/schema/columns?stream=secondary", { body: { label: "Tell Me More", type: "text" } }));
    const col = add.columns.find((c: { label: string }) => c.label === "Tell Me More");
    expect(col.type).toBe("text");
    const toLong = await json(call(w.a.analyst, "PATCH", `/api/schema/columns/${col.key}?stream=secondary`, { body: { type: "long" } }));
    expect(toLong.columns.find((c: { key: string }) => c.key === col.key).type).toBe("long");

    // A long value is now accepted…
    const item = await manual("secondary");
    const res = await approveWith(w.a.analyst, item, { title: "With a long Tell Me More", [col.key]: "- point\n  - sub point\n" + "x".repeat(3000) });
    expect(res.status).toBe(200);
    // …so it cannot go back to short Text.
    const back = await call(w.a.analyst, "PATCH", `/api/schema/columns/${col.key}?stream=secondary`, { body: { type: "text" } });
    expect(back.status).toBe(409);
    expect((await json(back)).error.message).toMatch(/must stay Long text/);

    // Only Text and Long text columns switch type.
    expect((await call(w.a.analyst, "PATCH", "/api/schema/columns/macrotrend?stream=secondary", { body: { type: "long" } })).status).toBe(409);
    // Clients cannot change columns.
    expect((await call(w.a.client, "PATCH", `/api/schema/columns/${col.key}?stream=secondary`, { body: { type: "text" } })).status).toBe(403);
  });
});
