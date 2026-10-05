/**
 * D1 rows read per request (the Workers Free plan allows 5 million a day).
 * Every request runs against a tenant with a few hundred entries and the
 * rows each one reads are counted from D1's own `meta.rows_read`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { COMPLETE, call, env, json, seedWorld, type World } from "./helpers";

let w: World;
const N_SECONDARY = 300;
const N_PRIMARY = 120;
const N_REVIEW = 40;

/** A D1 binding that adds up `meta.rows_read` of everything it runs. */
const STATEMENTS = new Map<string, number>();
const SQL = new WeakMap<object, string>();
function counting(db: D1Database) {
  const total = { rows: 0 };
  const add = (r: unknown, sql = "?") => {
    const m = (r as { meta?: { rows_read?: number } })?.meta;
    total.rows += m?.rows_read ?? 0;
    const k = sql.replace(/\s+/g, " ").slice(0, 400);
    STATEMENTS.set(k, (STATEMENTS.get(k) ?? 0) + (m?.rows_read ?? 0));
    return r;
  };
  const wrapStmt = (s: D1PreparedStatement, sql: string): D1PreparedStatement => {
    SQL.set(s, sql);
    return new Proxy(s, {
      get(t, k) {
        if (k === "__target") return t;
        if (k === "bind") return (...a: unknown[]) => wrapStmt(t.bind(...a), sql);
        if (k === "all" || k === "run") return async () => add(await (t[k] as () => Promise<unknown>).call(t), sql);
        if (k === "first")
          return async (col?: string) => {
            // first() hides meta: run all() instead (same rows read).
            const r = (await t.all()) as D1Result<Record<string, unknown>>;
            add(r, sql);
            const row = r.results?.[0] ?? null;
            return col ? (row ? row[col] : null) : row;
          };
        if (k === "raw") return async (o?: { columnNames?: boolean }) => (t.raw as (o?: unknown) => Promise<unknown>).call(t, o);
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  };
  const proxy = new Proxy(db, {
    get(t, k) {
      if (k === "prepare") return (sql: string) => wrapStmt(t.prepare(sql), sql);
      if (k === "batch")
        return async (stmts: D1PreparedStatement[]) => {
          // Our proxies wrap real statements; unwrap by re-preparing is not possible, so run the originals.
          const real = stmts.map((s) => (s as unknown as { __target?: D1PreparedStatement }).__target ?? s);
          const rs = await t.batch(real);
          rs.forEach((r, i) => add(r, SQL.get(real[i] as object) ?? "batch"));
          return rs;
        };
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { db: proxy, total };
}

async function measure(user: string, path: string, method = "GET", body?: unknown): Promise<{ rows: number; res: Response }> {
  const c = counting(env.DB);
  const headers: Record<string, string> = { "x-dev-user": user };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.fetch(new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { ...env, DB: c.db }, {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext);
  expect(res.status, `${path}: ${await res.clone().text()}`).toBeLessThan(300);
  return { rows: c.total.rows, res };
}
const rowsRead = async (user: string, path: string) => (await measure(user, path)).rows;

const row = (i: number, stream: "primary" | "secondary") => ({
  row: i + 2,
  values: {
    ID: `RR-${stream[0]}-${i}`,
    Title: `${stream} entry ${i}`,
    "Event Date": `2026-${String(1 + (i % 9)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`,
    Macrotrend: "AI Investment in R&D",
    Subtrend: i % 2 ? "Agentic AI Platforms" : "Computational Infrastructure",
    "Growth Intensity": "Stable",
    Impact: ["Low", "Medium", "High"][i % 3]!,
    "Source Type": stream === "primary" ? "Primary Source" : "PR",
    Competitors: i % 2 ? "Roche, Pfizer" : "Novartis",
    Action: "Not Actioned",
    ...(stream === "primary" ? { "Source Role": `Role ${i % 15}`, "Source Company": `Company ${i % 7}` } : { Publisher: "Reuters", "Key Details": `Details ${i}` }),
  },
});

beforeAll(async () => {
  w = await seedWorld();
  for (const [stream, n] of [
    ["secondary", N_SECONDARY],
    ["primary", N_PRIMARY],
  ] as const) {
    for (let at = 0; at < n; at += 8) {
      const rows = Array.from({ length: Math.min(8, n - at) }, (_, k) => row(at + k, stream));
      const r = await call(w.a.analyst, "POST", `/api/import?stream=${stream}`, { body: { fileName: "bulk.xlsx", rows } });
      expect(r.status, await r.clone().text()).toBe(200);
    }
  }
  for (let i = 0; i < N_REVIEW; i++) {
    const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: i % 2 ? "primary" : "secondary" } }));
    await call(w.a.analyst, "PATCH", `/api/items/${item.id}/draft`, { body: { values: { ...item.draft, ...COMPLETE, title: `Review ${i}` }, version: item.version } });
  }
}, 120_000);

const ALL = "needs_review,queued,fetching,extracting,failed,approved,rejected";
const RANGE = "from=2000-01-01&to=2100-01-01";
/** [path, rows read the first time (nothing cached), as client] with ~460 entries. Repeats cost the version row plus sign-in (≤ 12). */
const BUDGETS: [string, number, boolean?][] = [
  ["/api/items/counts", 150],
  ["/api/client-inbox/count", 50, true],
  [`/api/items?status=${ALL}`, 3000],
  ["/api/tracker/bounds", 600],
  [`/api/tracker?stream=secondary&${RANGE}&pageSize=10`, 1500],
  [`/api/tracker?stream=primary&${RANGE}&pageSize=10`, 1000],
  [`/api/phantoms?stream=primary&${RANGE}&pageSize=10`, 1800],
  [`/api/dashboard?${RANGE}`, 12000],
  ["/api/megatrends?stream=all", 2500],
  ["/api/competitors?stream=all", 9000],
  ["/api/primary-sources", 800],
  ["/api/schema?stream=primary", 300],
];

describe("D1 rows read per request (Workers Free: 5 million a day)", () => {
  it("stays within budget the first time, and costs a handful of rows when nothing changed since", async () => {
    for (const [path, budget, client] of BUDGETS) {
      const who = client ? w.a.client : w.a.analyst;
      const cold = await rowsRead(who, path);
      const warm = await rowsRead(who, path);
      expect(cold, `${path} (first read)`).toBeLessThanOrEqual(budget);
      expect(warm, `${path} (repeat)`).toBeLessThanOrEqual(12);
    }
  });

  it("keeps Tracker reads cached while only the Inbox changes, and refreshes them when the Tracker does", async () => {
    const tracker = `/api/tracker?stream=secondary&${RANGE}&pageSize=10`;
    await rowsRead(w.a.analyst, tracker);
    expect(await rowsRead(w.a.analyst, tracker)).toBeLessThanOrEqual(12);
    // Typing in the Inbox: the Inbox list and badges are read again, the Tracker is not.
    const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: "secondary" } }));
    const saved = await measure(w.a.analyst, `/api/items/${item.id}/draft`, "PATCH", { values: { ...item.draft, ...COMPLETE, title: "Cache check" }, version: item.version });
    // A change itself stays cheap too (the audit chain is found by index).
    expect(saved.rows, "saving a draft").toBeLessThanOrEqual(600);
    expect(await rowsRead(w.a.analyst, tracker)).toBeLessThanOrEqual(12);
    const list = await measure(w.a.analyst, `/api/items?status=${ALL}`);
    expect(list.res.headers.get("x-read-cache")).toBe("miss");
    expect(((await list.res.json()) as { id: string; draft: { title: string } }[]).find((x) => x.id === item.id)?.draft.title).toBe("Cache check");
    // Pushed to the Tracker: Tracker reads are worked out again and show it.
    const draft = (await saved.res.json()) as { version: number; draft: Record<string, unknown> };
    expect((await call(w.a.analyst, "POST", `/api/items/${item.id}/approve`, { body: { values: draft.draft, version: draft.version } })).status).toBe(200);
    const after = await measure(w.a.analyst, `/api/tracker?stream=secondary&${RANGE}&pageSize=10&q=${encodeURIComponent("Cache check")}`);
    expect(after.res.headers.get("x-read-cache")).toBe("miss");
    expect(((await after.res.json()) as { rows: { id: string }[] }).rows.map((r) => r.id)).toContain(item.id);
    const again = await measure(w.a.analyst, tracker);
    expect(again.res.headers.get("x-read-cache")).toBe("miss");
  });

  it("refreshes reads after background processing and schema changes", async () => {
    const counts = await measure(w.a.analyst, "/api/items/counts");
    const before = (await counts.res.json()) as Record<string, number>;
    expect((await measure(w.a.analyst, "/api/items/counts")).res.headers.get("x-read-cache")).toBe("hit");
    await call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: "primary" } });
    const after = (await (await measure(w.a.analyst, "/api/items/counts")).res.json()) as Record<string, number>;
    expect(after.primary).toBe((before.primary ?? 0) + 1);
    // A new option is in the column set at once.
    expect((await call(w.a.admin, "POST", "/api/schema/columns/competitors/options?stream=secondary", { body: { value: "Cache Pharma" } })).status).toBeLessThan(300);
    const schema = await json(call(w.a.analyst, "GET", "/api/schema?stream=secondary"));
    expect(schema.columns.find((c: { key: string }) => c.key === "competitors").options).toContain("Cache Pharma");
  });
});
