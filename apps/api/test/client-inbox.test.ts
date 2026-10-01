import { beforeAll, describe, expect, it } from "vitest";
import { COMPLETE, call, json, nextRecordId, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=1000";

/** A Secondary manual entry with every field filled in (saved as a draft), still awaiting review. */
async function draftEntry(title: string, extra: Record<string, unknown> = {}) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: "secondary" } }));
  const values = { ...item.draft, ...COMPLETE, record_id: nextRecordId(), title, key_details: "Pfizer signed a $2bn AI deal with a start-up.", ...extra };
  const saved = await json(call(w.a.analyst, "PATCH", `/api/items/${item.id}/draft`, { body: { values, version: item.version } }));
  return saved as { id: string; version: number; code: string };
}
const send = (id: string, version: number, who = w.a.analyst) => call(who, "POST", `/api/items/${id}/send-to-client`, { body: { version } });
const clientList = async (who = w.a.client) => (await json(call(who, "GET", "/api/client-inbox"))) as { id: string; version: number; withClient: boolean; comments: number; returnedByClient: unknown }[];
const eradigm = async () => (await json(call(w.a.analyst, "GET", "/api/items?stream=secondary&status=needs_review"))) as { id: string; version: number; withClient: boolean; comments: number; returnedByClient: { by: string } | null }[];

describe("Eradigm Inbox → Client Inbox", () => {
  it("sends an entry to the client, who comments and sends it back; Eradigm reads the comments", async () => {
    const e = await draftEntry("Pfizer signs an AI deal");
    // Clients cannot use the Eradigm Inbox, and analysts cannot use the Client Inbox.
    expect((await send(e.id, e.version, w.a.client)).status).toBe(403);
    expect((await call(w.a.analyst, "GET", "/api/client-inbox")).status).toBe(403);
    expect((await call(w.a.client, "GET", `/api/client-inbox/${e.id}`)).status).toBe(404);

    const sent = await json(send(e.id, e.version));
    expect(sent).toMatchObject({ withClient: true, sentToClient: { by: "A Analyst" }, status: "needs_review" });
    expect((await send(e.id, sent.version)).status).toBe(409);
    expect(await json(call(w.a.client, "GET", "/api/client-inbox/count"))).toEqual({ count: expect.any(Number) });
    const mine = (await clientList()).find((i) => i.id === e.id)!;
    expect(mine).toMatchObject({ withClient: true });
    expect((await clientList(w.b.admin)).map((i) => i.id)).not.toContain(e.id);
    // While with the client, Eradigm cannot change or push it.
    expect((await call(w.a.analyst, "PATCH", `/api/items/${e.id}/draft`, { body: { values: { title: "x" }, version: sent.version } })).status).toBe(409);
    expect((await call(w.a.analyst, "POST", `/api/items/${e.id}/approve`, { body: { values: {}, version: sent.version } })).status).toBe(409);
    // The client reads it (details and saved text) and comments on highlighted text.
    const d = await json(call(w.a.client, "GET", `/api/client-inbox/${e.id}`));
    expect(d.draft.title).toBe("Pfizer signs an AI deal");
    const quote = "$2bn AI deal";
    const start = "Pfizer signed a $2bn AI deal with a start-up.".indexOf(quote);
    const add = await call(w.a.client, "POST", `/api/items/${e.id}/comments`, { body: { field: "key_details", start, end: start + quote.length, quote, body: "Is it $2bn upfront or in total?" } });
    expect(add.status).toBe(201);
    const list = await json(add);
    expect(list[0]).toMatchObject({ field: "key_details", quote, body: "Is it $2bn upfront or in total?", author: "A Client", authorRole: "client", mine: true, resolved: null });
    expect((await call(w.a.client, "POST", `/api/items/${e.id}/comments`, { body: { field: "nope", start: 0, end: 2, quote: "Pf", body: "x" } })).status).toBe(422);
    expect((await call(w.a.client, "POST", `/api/items/${e.id}/comments`, { body: { field: "title", start: 0, end: 2, quote: "Pf", body: "  " } })).status).toBe(422);
    // Send to Eradigm: back in the Eradigm Inbox, with the comment.
    const back = await json(call(w.a.client, "POST", `/api/client-inbox/${e.id}/send-to-eradigm`, { body: { version: mine.version } }));
    expect(back).toMatchObject({ withClient: false, returnedByClient: { by: "A Client" }, comments: 1 });
    expect((await clientList()).map((i) => i.id)).not.toContain(e.id);
    const row = (await eradigm()).find((i) => i.id === e.id)!;
    expect(row).toMatchObject({ withClient: false, comments: 1, returnedByClient: { by: "A Client" } });
    // The client no longer sees it, or its comments.
    expect((await call(w.a.client, "GET", `/api/items/${e.id}/comments`)).status).toBe(404);
    const seen = await json(call(w.a.analyst, "GET", `/api/items/${e.id}/comments`));
    expect(seen[0]).toMatchObject({ quote, mine: false, author: "A Client" });
    // Eradigm resolves it (clients cannot); only its author can delete it.
    const resolved = await json(call(w.a.analyst, "PATCH", `/api/items/${e.id}/comments/${seen[0].id}`, { body: { resolved: true } }));
    expect(resolved[0].resolved).toMatchObject({ by: "A Analyst" });
    expect((await call(w.a.analyst, "DELETE", `/api/items/${e.id}/comments/${seen[0].id}`)).status).toBe(403);
    expect((await eradigm()).find((i) => i.id === e.id)!.comments).toBe(0);
    // And Eradigm can push it to the Tracker as usual.
    const ok = await call(w.a.analyst, "POST", `/api/items/${e.id}/approve`, { body: { values: d.draft, version: row.version } });
    expect(ok.status).toBe(200);
  });

  it("lets the client push an entry straight to the Tracker (and its Phantom)", async () => {
    const e = await draftEntry("Novartis opens an AI hub");
    const sent = await json(send(e.id, e.version));
    const pushed = await call(w.a.client, "POST", `/api/client-inbox/${e.id}/push`, { body: { version: sent.version } });
    expect(pushed.status).toBe(200);
    expect(await json(pushed)).toMatchObject({ status: "approved", withClient: false });
    const t = await json(call(w.a.client, "GET", `/api/tracker?stream=secondary&${RANGE}`));
    const r = t.rows.find((x: { id: string }) => x.id === e.id);
    expect(r).toMatchObject({ approvedBy: "A Client" });
    expect((await json(call(w.a.client, "GET", `/api/phantoms?stream=secondary&${RANGE}`))).rows.map((x: { id: string }) => x.id)).toContain(e.id);
    // Only from the Client Inbox.
    expect((await call(w.a.client, "POST", `/api/client-inbox/${e.id}/push`, { body: { version: sent.version + 1 } })).status).toBe(409);
  });

  it("asks the client to send back an incomplete entry, and lets Eradigm recall one", async () => {
    const e = await draftEntry("An incomplete entry", { impact: null });
    const sent = await json(send(e.id, e.version));
    const res = await call(w.a.client, "POST", `/api/client-inbox/${e.id}/push`, { body: { version: sent.version } });
    expect(res.status).toBe(422);
    expect((await json(res)).error.message).toMatch(/Send it to Eradigm/);
    const recalled = await json(call(w.a.analyst, "POST", `/api/items/${e.id}/recall`, { body: { version: sent.version } }));
    expect(recalled).toMatchObject({ withClient: false, returnedByClient: null });
    expect((await clientList()).map((i) => i.id)).not.toContain(e.id);
  });
});

describe("tabs by role", async () => {
  const { canSeeTab, NAV_TABS } = await import("@eradigm/shared");
  it("clients see Dashboard, Tracker, Megatrends, Phantoms and the Client Inbox; analysts the Eradigm Inbox instead; admins all", () => {
    const visible = (role: "admin" | "analyst" | "client") => NAV_TABS.filter((t) => canSeeTab(role, t)).sort();
    expect(visible("client")).toEqual(["clientinbox", "dashboard", "megatrends", "phantoms", "tracker"]);
    expect(visible("analyst")).toEqual(["dashboard", "inbox", "megatrends", "phantoms", "tracker"]);
    expect(visible("admin")).toEqual([...NAV_TABS].sort());
  });
});
