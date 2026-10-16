import { beforeAll, describe, expect, it } from "vitest";
import { call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

/** A stand-in .docx: a ZIP archive's first bytes, then enough to span two stored chunks. */
const docx = (size = 1_200_000) => {
  const b = new Uint8Array(size);
  b.set([0x50, 0x4b, 0x03, 0x04]);
  for (let i = 4; i < size; i++) b[i] = i % 251;
  return b;
};

function submit(who: string, values: Record<string, string>, file: { name: string; bytes: Uint8Array } = { name: "J&J Q3 2024 call.docx", bytes: docx() }) {
  const form = new FormData();
  form.append("file", new File([file.bytes], file.name));
  form.append("values", JSON.stringify(values));
  return call(who, "POST", "/api/earnings-calls", { form });
}

describe("request 64: earnings calls", () => {
  it("submits a call's report and fields, writes its Markdown, and lists it in its own workspace", async () => {
    const r = await submit(w.a.analyst, { quarter: "Q3 2024", company: "J&J", tagline: "Growth on track", loe: "Stelara biosimilars", trends: "More DTP\nMore AI" });
    expect(r.status).toBe(201);
    const call1 = await r.json<{ id: string; reportName: string; reportSize: number; company: string }>();
    expect(call1).toMatchObject({ company: "J&J", reportName: "J&J Q3 2024 call.docx", reportSize: 1_200_000 });

    const list = await json(call(w.a.client, "GET", "/api/earnings-calls"));
    expect(list.map((c: { id: string }) => c.id)).toContain(call1.id);
    expect(await json(call(w.b.admin, "GET", "/api/earnings-calls"))).toEqual([]);

    const md = await call(w.a.client, "GET", `/api/earnings-calls/${call1.id}/markdown`);
    expect(await md.text()).toBe(
      [
        "Quarter\nQ3 2024",
        "Company\nJ&J",
        "Main Tagline\nGrowth on track",
        "Patent Expiry / LOE Response\nStelara biosimilars",
        "AI & Automation Tools\n",
        "Direct-to-Patient Strategy\n",
        "IRA Pricing / Tariffs\n",
        "Strategic Investment & Redeployment\n",
        "Observed Trends\nMore DTP\nMore AI",
      ].join("\n\n") + "\n",
    );
    const dl = await call(w.a.client, "GET", `/api/earnings-calls/${call1.id}/markdown?download=1`);
    expect(dl.headers.get("content-disposition")).toContain('attachment; filename="J&J Q3 2024.md"');

    // The report comes back byte for byte (stored in two chunks).
    const rep = await call(w.a.client, "GET", `/api/earnings-calls/${call1.id}/report`);
    expect(rep.headers.get("content-type")).toContain("wordprocessingml");
    expect(new Uint8Array(await rep.arrayBuffer())).toEqual(docx());
    expect((await call(w.b.admin, "GET", `/api/earnings-calls/${call1.id}/report`)).status).toBe(404);
  });

  it("needs a .docx, a quarter and a company; clients cannot submit or remove", async () => {
    expect((await submit(w.a.client, { quarter: "Q1 2025", company: "Pfizer" })).status).toBe(403);
    expect((await submit(w.a.analyst, { quarter: "", company: "Pfizer" })).status).toBe(422);
    expect((await submit(w.a.analyst, { quarter: "Q1 2025", company: "Pfizer" }, { name: "notes.pdf", bytes: docx(10) })).status).toBe(400);
    expect((await submit(w.a.analyst, { quarter: "Q1 2025", company: "Pfizer" }, { name: "fake.docx", bytes: new Uint8Array([1, 2, 3, 4, 5]) })).status).toBe(400);
    const made = await json(submit(w.a.analyst, { quarter: "Q1 2025", company: "Pfizer" }, { name: "p.docx", bytes: docx(100) }));
    expect((await call(w.a.client, "DELETE", `/api/earnings-calls/${made.id}`)).status).toBe(403);
    expect((await call(w.a.analyst, "DELETE", `/api/earnings-calls/${made.id}`)).status).toBe(200);
    expect((await call(w.a.analyst, "GET", `/api/earnings-calls/${made.id}/markdown`)).status).toBe(404);
  });
});
