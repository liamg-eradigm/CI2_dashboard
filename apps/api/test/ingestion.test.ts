import { beforeAll, describe, expect, it } from "vitest";
import { captureUrlIsolated, parseUploadIsolated, setInlineCaptureFetcher } from "../src/pipeline/capture-client";
import { peekTestQueue, runJob } from "../src/pipeline/process";
import { COMPLETE, WITH_LLM, approveWith, articleHtml, call, drain, env, ingest, json, seedWorld, upload, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const PAGE = articleHtml({
  title: "Novartis opens AI academy with three-tier certification",
  body: "Novartis has opened an AI academy with a three-tier certification programme for all employees.\nAll employees will be required to complete the foundation tier by the end of 2027, the company said in a press release.\nAdvanced tiers are aimed at data scientists and functional AI leads across the organisation.",
});

/** Fake network: DoH answers + a newsroom that fails with 503 until `healthy` is true. */
function network(state: { healthy: boolean; hits: number }) {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "cloudflare-dns.com") {
      const type = url.searchParams.get("type");
      return Response.json({ Status: 0, Answer: type === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] });
    }
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200 });
    if (url.pathname !== "/novartis-academy") return new Response("not found", { status: 404 });
    state.hits++;
    if (!state.healthy) return new Response("unavailable", { status: 503 });
    return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch;
}

describe("URL submissions", () => {
  it("rejects blocked destinations before creating anything and logs the outcome", async () => {
    const r = await call(w.a.analyst, "POST", "/api/submissions", { body: { url: "http://169.254.169.254/latest/meta-data" } });
    expect(r.status).toBe(422);
    const body = await r.json<any>();
    expect(body.error.fields[0].code).toBe("BLOCKED_HOST");
    const log = await json(call(w.a.analyst, "GET", "/api/capture-log"));
    expect(log[0]).toMatchObject({ ok: false, input: "http://169.254.169.254/latest/meta-data" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM intelligence_items WHERE tenant_id = ?1").bind(w.a.id).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("is idempotent per Idempotency-Key, but never blocks re-submitting a source that is not in the tracker", async () => {
    const first = await call(w.a.analyst, "POST", "/api/submissions", { body: { url: "https://news.example.com/dup-story?utm_source=x" } });
    expect(first.status).toBe(201);
    const a = await first.json<any>();
    // The same URL again (e.g. after a failed capture) creates a new Inbox item: nothing is in the tracker yet.
    const again = await call(w.a.analyst, "POST", "/api/submissions", { body: { url: "http://www.news.example.com/dup-story/#frag" } });
    expect(again.status).toBe(201);
    const b = await again.json<any>();
    expect(b.duplicate).toBe(false);
    expect(b.item.id).not.toBe(a.item.id);
    expect(b.item.duplicateOf).toBeNull();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => call(w.a.analyst, "POST", "/api/submissions", { body: { url: "https://news.example.com/race" }, headers: { "idempotency-key": "race-1" } })),
    );
    const bodies = await Promise.all(results.map((r) => r.json<any>()));
    expect(new Set(bodies.map((b) => b.item.id)).size).toBe(1);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM intelligence_items WHERE tenant_id = ?1 AND url_key = 'news.example.com/race'").bind(w.a.id).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("warns (but proceeds) when the source is already in the tracker, and approval requires an explicit override", async () => {
    const html = articleHtml({ url: "https://news.example.com/in-tracker", title: "Already tracked story", body: "Roche expands its robotics-enabled lab network across three new sites in Europe.\nThe expansion completes in 2027." });
    const r1 = await upload(w.a.analyst, html, "tracked.html");
    expect(r1.status).toBe(201);
    await drain();
    const firstItem = await json(call(w.a.analyst, "GET", `/api/items/${(await r1.json<any>()).item.id}`));
    expect(firstItem.status).toBe("needs_review");
    const published = await json(approveWith(w.a.analyst, firstItem));
    expect(published.status).toBe("approved");
    expect(published.duplicateOf).toBeNull();

    // Same URL typed on the Input page: created and sent to the Inbox, flagged as a duplicate.
    const byUrl = await call(w.a.analyst, "POST", "/api/submissions", { body: { url: "https://news.example.com/in-tracker" } });
    expect(byUrl.status).toBe(201);
    const u = await byUrl.json<any>();
    expect(u.duplicate).toBe(false);
    expect(u.item).toMatchObject({ duplicateOf: published.signalCode, duplicateItemId: published.id, duplicateBasis: "url" });

    // The same file uploaded again: also allowed, and flagged.
    const r2 = await upload(w.a.analyst, html, "tracked-again.html");
    expect(r2.status).toBe(201);
    const second = (await r2.json<any>()).item;
    expect(second.duplicateOf).toBe(published.signalCode);
    await drain();
    const draft = await json(call(w.a.analyst, "GET", `/api/items/${second.id}`));
    expect(draft.status).toBe("needs_review");

    // Approval refuses without the override, with a clear message and machine-readable details.
    const refused = await approveWith(w.a.analyst, draft);
    expect(refused.status).toBe(409);
    const err = (await refused.json<any>()).error;
    expect(err.code).toBe("DUPLICATE");
    expect(err.message).toContain(`duplicate of ${published.signalCode}`);
    expect(err.details).toMatchObject({ duplicateOf: published.signalCode, duplicateItemId: published.id });
    expect((await json(call(w.a.analyst, "GET", `/api/items/${second.id}`))).status).toBe("needs_review");

    // Explicit override: published as a separate entry, and the override is audited.
    const ok = await call(w.a.analyst, "POST", `/api/items/${draft.id}/approve`, { body: { values: { ...draft.draft, ...COMPLETE }, version: draft.version, overrideDuplicate: true } });
    expect(ok.status).toBe(200);
    const pub2 = await ok.json<any>();
    expect(pub2.status).toBe("approved");
    expect(pub2.signalCode).not.toBe(published.signalCode);
    const ev = await env.DB.prepare("SELECT details_json FROM audit_events WHERE action = 'item.approved' AND target_id = ?1").bind(draft.id).first<{ details_json: string }>();
    expect(JSON.parse(ev!.details_json).duplicateOverride).toMatchObject({ of: published.signalCode });
    const dupEvents = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'submission.duplicate' AND target_id IN (?1, ?2)").bind(u.item.id, second.id).first<{ n: number }>();
    expect(dupEvents?.n).toBe(2);
  });

  it("does not count rejected or failed copies as duplicates", async () => {
    const html = articleHtml({ url: "https://news.example.com/rejected-once", title: "Rejected once story", body: "Pfizer pilots an autonomous chemistry platform with two academic partners.\nResults are expected next year." });
    const r1 = await upload(w.a.analyst, html, "rej.html");
    const first = (await r1.json<any>()).item;
    await drain();
    const d1 = await json(call(w.a.analyst, "GET", `/api/items/${first.id}`));
    expect((await call(w.a.analyst, "POST", `/api/items/${first.id}/reject`, { body: { version: d1.version } })).status).toBe(200);
    const r2 = await upload(w.a.analyst, html, "rej-again.html");
    expect(r2.status).toBe(201);
    const second = (await r2.json<any>()).item;
    expect(second.id).not.toBe(first.id);
    expect(second.duplicateOf).toBeNull();
    await drain();
    const d2 = await json(call(w.a.analyst, "GET", `/api/items/${second.id}`));
    expect((await approveWith(w.a.analyst, d2)).status).toBe(200);
  });

  it("retries failed capture safely and never duplicates records", async () => {
    const state = { healthy: false, hits: 0 };
    setInlineCaptureFetcher(network(state));
    try {
      const sub = await json(call(w.a.analyst, "POST", "/api/submissions", { body: { url: "https://newsroom.example.com/novartis-academy" } }));
      const job = peekTestQueue().find((j) => j.itemId === sub.item.id);
      expect(job).toBeTruthy();
      // First delivery: transient 503 -> retry requested.
      expect(await runJob(env, job!, 1, 3)).toBe("retry");
      // Final delivery still failing -> item Failed with a clear message.
      expect(await runJob(env, job!, 3, 3)).toBe("done");
      let item = await json(call(w.a.analyst, "GET", `/api/items/${sub.item.id}`));
      expect(item.status).toBe("failed");
      expect(item.error.code).toBe("HTTP_ERROR");

      // Analyst retries once the source recovers.
      state.healthy = true;
      const rp = await call(w.a.analyst, "POST", `/api/items/${sub.item.id}/reprocess`, { body: { version: item.version } });
      expect(rp.status).toBe(200);
      // A second click with the same version is rejected (no double processing).
      expect((await call(w.a.analyst, "POST", `/api/items/${sub.item.id}/reprocess`, { body: { version: item.version } })).status).toBe(409);
      await drain();
      item = await json(call(w.a.analyst, "GET", `/api/items/${sub.item.id}`));
      expect(item.error).toBeNull();
      expect(item.status).toBe("needs_review");
      expect(item.attempts).toBe(2);
      expect(item.hasSnapshot).toBe(true);
      expect(item.attemptsDetail.map((a: any) => a.status)).toEqual(["succeeded", "failed"]);
      expect(item.attemptsDetail[0].steps.map((s: any) => s.label)).toEqual([
        "Validate and normalise",
        "Destination check",
        "Isolated capture worker",
        "Access restrictions",
        "Content scan before storage",
        "Data policy check",
        "Routed to Needs review",
      ]);
      expect(item.attemptsDetail[0].provider).toBe("none");

      // Replaying the stale attempt-1 message is a no-op.
      expect(await runJob(env, job!, 1, 3)).toBe("skipped");
      const revs = await env.DB.prepare("SELECT COUNT(*) AS n FROM item_revisions WHERE item_id = ?1").bind(sub.item.id).first<{ n: number }>();
      expect(revs?.n).toBe(0);
      const snaps = await env.DB.prepare("SELECT COUNT(*) AS n FROM source_snapshots WHERE item_id = ?1").bind(sub.item.id).first<{ n: number }>();
      expect(snaps?.n).toBe(1);
    } finally {
      setInlineCaptureFetcher(null);
    }
  });
});

describe("capture worker failures", () => {
  it("turns a capture-worker crash or CPU-limit error into a clear, non-retryable failure", async () => {
    const e = { ...env, ENVIRONMENT: "staging" as const, CAPTURE: { fetch: async () => new Response("Worker exceeded resource limits", { status: 503 }) } as unknown as Fetcher };
    const r = await captureUrlIsolated(e, "https://news.example.com/huge");
    expect(r).toMatchObject({ ok: false, code: "PROCESSING_LIMIT", retryable: false });
    expect(!r.ok && r.message).toMatch(/SingleFile/);
    const u = await parseUploadIsolated(e, new TextEncoder().encode("<html></html>").buffer as ArrayBuffer, "a.html");
    expect(u).toMatchObject({ ok: false, code: "PROCESSING_LIMIT" });
  });
});

describe("file submissions and the review lifecycle", () => {
  it("scans and sanitises uploads before storage and serves them sandboxed", async () => {
    const item = await ingest(w.a.analyst, "Pfizer extends direct-to-patient offering to Europe", "Pfizer will make its direct-to-patient platform available in Germany, France, Italy, Spain and the UK from early 2027.\nThe expansion follows a pilot on shared fulfilment infrastructure.", "https://pharma.example.com/pfizer-dtp");
    expect(item.status).toBe("needs_review");
    const snap = await call(w.a.analyst, "GET", `/api/items/${item.id}/snapshot`);
    expect(snap.headers.get("content-security-policy")).toMatch(/sandbox/);
    const html = await snap.text();
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("direct-to-patient");
    // Clients cannot see snapshots of unpublished items.
    expect((await call(w.a.client, "GET", `/api/items/${item.id}/snapshot`)).status).toBe(404);
  });

  it("manual entry (default): sends the capture to the Inbox with every tracker field empty and calls no external service", async () => {
    const outbound: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      outbound.push(String(input instanceof Request ? input.url : input));
      return realFetch(input, init);
    }) as typeof fetch;
    let item;
    try {
      item = await ingest(w.a.analyst, "Merck launches AI upskilling hub", "Merck has launched a central AI enablement hub for all employees.\nThe hub offers role-based learning paths.");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(outbound).toEqual([]);
    expect(item.status).toBe("needs_review");
    const schema = await json(call(w.a.analyst, "GET", "/api/schema"));
    for (const c of schema.columns) expect(item.draft[c.key] ?? null).toBeNull();
    expect(item.extraction).toBeNull();
    expect(item.warningsCount).toBe(0);
    expect(item.revisions).toEqual([]);
    expect(item.attemptsDetail[0]).toMatchObject({ provider: "none", model: null });
    expect(item.attemptsDetail[0].steps.slice(-2).map((s: any) => s.label)).toEqual(["Data policy check", "Routed to Needs review"]);
    expect(item.attemptsDetail[0].steps.at(-1).detail).toMatch(/every tracker field empty/);
    // The captured page is kept for the analyst to read.
    expect(item.hasSnapshot).toBe(true);
    expect(item.title).toBe("Merck launches AI upskilling hub");
    const me = await json(call(w.a.analyst, "GET", "/api/me"));
    expect(me.features).toEqual({ prefill: "manual" });

    // The analyst fills the fields; the edits are provenance "analyst" and the approval has no "AI corrections".
    const saved = await json(call(w.a.analyst, "PATCH", `/api/items/${item.id}/draft`, { body: { values: { ...COMPLETE, title: "Merck launches AI hub" }, version: item.version } }));
    expect(saved.provenance.title).toBe("analyst");
    const ok = await approveWith(w.a.analyst, saved, { title: "Merck launches AI hub" });
    expect(ok.status).toBe(200);
    const dec = await env.DB.prepare("SELECT corrected_keys FROM review_decisions WHERE item_id = ?1 AND decision = 'approve'").bind(item.id).first<{ corrected_keys: string }>();
    expect(JSON.parse(dec?.corrected_keys ?? "null")).toEqual([]);
    const events = await env.DB.prepare("SELECT action FROM audit_events WHERE chain = ?1 AND target_id = ?2 ORDER BY seq").bind(w.a.id, item.id).all<{ action: string }>();
    expect(events.results?.map((e) => e.action)).toEqual(["submission.created", "item.routed", "item.edited", "item.approved"]);
  });

  it("a reprocess in manual mode keeps the values the analyst already entered", async () => {
    const item = await ingest(w.a.analyst, "GSK expands DTP pilot", "GSK is expanding its direct-to-patient pilot to three new markets.\nThe company cited strong patient uptake.");
    const saved = await json(call(w.a.analyst, "PATCH", `/api/items/${item.id}/draft`, { body: { values: { impact: "High", title: "GSK expands DTP" }, version: item.version } }));
    await call(w.a.analyst, "POST", `/api/items/${item.id}/reprocess`, { body: { version: saved.version } });
    await drain();
    const again = await json(call(w.a.analyst, "GET", `/api/items/${item.id}`));
    expect(again.status).toBe("needs_review");
    expect(again.attempts).toBe(2);
    expect(again.draft).toMatchObject({ impact: "High", title: "GSK expands DTP" });
    expect(again.provenance).toMatchObject({ impact: "analyst", title: "analyst" });
  });

  it("optional LLM pre-fill: stores output as a Needs review draft with evidence, confidence and taxonomy enforcement", async () => {
    const item = await ingest(w.a.analyst, "Roche opens robotics-enabled autonomous lab", "Roche has opened an autonomous laboratory in Basel where robotics-enabled labs run design-make-test cycles.\nThe company said the lab will double experimental throughput by 2027.", undefined, WITH_LLM);
    expect(item.status).toBe("needs_review");
    expect(item.draft.competitors).toEqual(["Roche"]);
    expect(item.extraction.competitors.evidence).toBeTruthy();
    expect(item.extraction.action.warnings[0]).toMatch(/analyst-owned/);
    expect(item.provenance.title).toBe("source");
    expect(item.revisions[0].kind).toBe("llm_draft");
    // Never auto-published.
    const tracker = await json(call(w.a.client, "GET", "/api/tracker?from=2000-01-01&to=2100-01-01"));
    expect(tracker.rows.map((r: any) => r.id)).not.toContain(item.id);
  });

  it("enforces review-state transitions and server-side validation", async () => {
    const item = await ingest(w.a.analyst, "Sanofi signs direct-to-employer agreement", "Sanofi announced an agreement with a coalition of large US employers to offer selected medicines directly to covered employees.\nThe arrangement bypasses traditional benefit intermediaries.", undefined, WITH_LLM);
    // Missing required fields -> 422 listing them.
    const bad = await call(w.a.analyst, "POST", `/api/items/${item.id}/approve`, { body: { values: { ...item.draft, impact: null, action: null }, version: item.version } });
    expect(bad.status).toBe(422);
    expect((await bad.json<any>()).error.fields.map((f: any) => f.key)).toEqual(expect.arrayContaining(["impact", "action"]));
    // Values outside the taxonomy are rejected even if the UI were bypassed.
    const invented = await approveWith(w.a.analyst, item, { impact: "Catastrophic" });
    expect(invented.status).toBe(422);
    const allValue = await approveWith(w.a.analyst, item, { subtrend: "All" });
    expect(allValue.status).toBe(422);
    // Analyst edits are saved as a revision and marked as analyst-provided.
    const saved = await json(call(w.a.analyst, "PATCH", `/api/items/${item.id}/draft`, { body: { values: { ...item.draft, impact: "Medium" }, version: item.version } }));
    expect(saved.provenance.impact).toBe("analyst");
    // Stale version -> conflict.
    expect((await approveWith(w.a.analyst, item)).status).toBe(409);
    const ok = await approveWith(w.a.analyst, saved);
    expect(ok.status).toBe(200);
    const approved = await ok.json<any>();
    expect(approved.status).toBe("approved");
    expect(approved.signalCode).toMatch(/^SIG-\d+$/);
    expect(approved.publishedRev).toBe(1);
    // Cannot approve or reject twice.
    expect((await approveWith(w.a.analyst, approved)).status).toBe(409);
    expect((await call(w.a.analyst, "POST", `/api/items/${item.id}/reject`, { body: { version: approved.version } })).status).toBe(409);
    // Provenance and audit trail exist for the published item.
    const sig = await json(call(w.a.client, "GET", `/api/signals/${item.id}`));
    expect(sig.revisions.some((r: any) => r.kind === "published" && r.rev === 1)).toBe(true);
    expect(sig.extraction.model).toBe("mock-heuristic");
    expect(sig.extraction.promptVersion).toMatch(/^prompt\//);
    const events = await env.DB.prepare("SELECT action FROM audit_events WHERE chain = ?1 AND target_id = ?2 ORDER BY seq").bind(w.a.id, item.id).all<{ action: string }>();
    expect(events.results?.map((e) => e.action)).toEqual(["submission.created", "item.classified", "item.edited", "item.approved"]);
  });

  it("rejects, then reprocesses a rejected draft", async () => {
    const item = await ingest(w.a.analyst, "AstraZeneca pilots agentic AI", "AstraZeneca is piloting agentic AI platforms across early research workflows.\nThe pilot covers target identification and literature review.");
    const rej = await json(call(w.a.analyst, "POST", `/api/items/${item.id}/reject`, { body: { version: item.version, reason: "Not relevant" } }));
    expect(rej.status).toBe("rejected");
    const rp = await json(call(w.a.analyst, "POST", `/api/items/${item.id}/reprocess`, { body: { version: rej.version } }));
    expect(rp.status).toBe("queued");
    await drain();
    const again = await json(call(w.a.analyst, "GET", `/api/items/${item.id}`));
    expect(again.status).toBe("needs_review");
    expect(again.attempts).toBe(2);
  });

  it("lets analysts and admins (never clients) delete a tracker entry, with an audited reason", async () => {
    const item = await ingest(w.a.analyst, "Entry to delete", "Sanofi signs a licensing deal for an oncology asset with a biotech partner.\nThe deal includes milestone payments.");
    const pub = await json(approveWith(w.a.analyst, item));
    expect((await call(w.a.client, "GET", `/api/signals/${pub.id}`)).status).toBe(200);
    expect((await call(w.a.client, "DELETE", `/api/items/${pub.id}`)).status).toBe(403);
    const del = await call(w.a.analyst, "DELETE", `/api/items/${pub.id}`, { body: { reason: "Published in error" } });
    expect(del.status).toBe(200);
    expect((await del.json<any>()).status).toBe("deleted");
    expect((await call(w.a.client, "GET", `/api/signals/${pub.id}`)).status).toBe(404);
    const t = await json(call(w.a.client, "GET", "/api/tracker?from=2000-01-01&to=2100-01-01&pageSize=100"));
    expect(t.rows.find((r: any) => r.id === pub.id)).toBeUndefined();
    const ev = await env.DB.prepare("SELECT details_json FROM audit_events WHERE action = 'item.deleted' AND target_id = ?1").bind(pub.id).first<{ details_json: string }>();
    expect(JSON.parse(ev!.details_json)).toMatchObject({ from: "approved", signalCode: pub.signalCode, reason: "Published in error" });
    // Once deleted it no longer counts as a duplicate, and cannot be deleted twice.
    expect((await call(w.a.admin, "DELETE", `/api/items/${pub.id}`)).status).toBe(409);
  });

  it("flags duplicate content across different uploads only once a copy is in the tracker", async () => {
    const body = "Unique duplicate-content body about Roche and robotics-enabled labs in Basel.\nThe lab doubles throughput by 2027.";
    const first = await ingest(w.a.analyst, "Duplicate content test", body);
    expect(first.status).toBe("needs_review");
    const res = await upload(w.a.analyst, articleHtml({ title: "Duplicate content test", body }) + "<!-- different bytes -->", "copy.html");
    const { item } = await res.json<any>();
    await drain();
    const second = await json(call(w.a.analyst, "GET", `/api/items/${item.id}`));
    // Never failed: the first copy is only in review, so this is not a duplicate yet.
    expect(second.status).toBe("needs_review");
    expect(second.duplicateOf).toBeNull();
    const pub = await json(approveWith(w.a.analyst, first));
    const after = await json(call(w.a.analyst, "GET", `/api/items/${item.id}`));
    expect(after).toMatchObject({ duplicateOf: pub.signalCode, duplicateBasis: "content" });
  });

  it("quarantines content that violates the data policy without sending it anywhere", async () => {
    const res = await upload(w.a.analyst, articleHtml({ title: "Board minutes", body: "STRICTLY CONFIDENTIAL. Board minutes for the oncology franchise.\nDo not distribute outside the leadership team." }), "minutes.html");
    const { item } = await res.json<any>();
    await drain();
    const q = await json(call(w.a.analyst, "GET", `/api/items/${item.id}`));
    expect(q.status).toBe("failed");
    expect(q.quarantined).toBe(true);
    expect(q.bodyText).toBeNull();
    expect(q.hasSnapshot).toBe(false);
    expect(q.attemptsDetail[0].model).toBeNull();
    const inc = await json(call(w.a.admin, "GET", "/api/incidents"));
    expect(inc[0]).toMatchObject({ category: "confidentiality_marking", itemCode: q.code });
    expect(JSON.stringify(inc)).not.toMatch(/Board minutes|oncology/);
    expect((await call(w.a.analyst, "POST", `/api/items/${item.id}/reprocess`, { body: {} })).status).toBe(409);
  });

  it("rejects non-HTML and oversized uploads", async () => {
    expect((await upload(w.a.analyst, "%PDF-1.7", "report.pdf")).status).toBe(415);
    const big = "<html><body>" + "x".repeat(6 * 1024 * 1024) + "</body></html>";
    expect([413, 422]).toContain((await upload(w.a.analyst, big, "big.html")).status);
  });
});
