import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function putLogo(who: string, name: string, bytes: Uint8Array, file = "logo.png") {
  const form = new FormData();
  form.append("file", new File([bytes], file, { type: "image/png" }));
  return call(who, "PUT", `/api/competitor-logos?${new URLSearchParams({ name })}`, { form });
}

describe("request 70: the Dashboard", () => {
  it("gives each entry its Growth Intensity (the Activity sum), and Manufacturing needs no Subtrend", async () => {
    const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: "secondary" } }));
    const res = await approveWith(w.a.analyst, item, { title: "Lilly opens a new plant", macrotrend: "Manufacturing", subtrend: null, growth: "Slight Increase", impact: "Medium", date: new Date().toISOString().slice(0, 10) });
    expect(res.status).toBe(200);
    const mt = await json(call(w.a.client, "GET", "/api/megatrends?stream=all"));
    expect(mt.macrotrends.map((m: { name: string }) => m.name)).toContain("Manufacturing");
    expect(mt.entries.find((e: { title: string }) => e.title === "Lilly opens a new plant")).toMatchObject({ macrotrend: "Manufacturing", subtrend: null, growth: "Slight Increase", impact: "Medium" });
    const comp = await json(call(w.a.client, "GET", "/api/competitors?stream=all"));
    expect(comp.entries.find((e: { title: string }) => e.title === "Lilly opens a new plant")).toMatchObject({ growth: "Slight Increase" });
  });

  it("keeps competitors' logos: admins set and remove them, everyone sees them, only raster images", async () => {
    expect(await json(call(w.a.client, "GET", "/api/competitor-logos"))).toEqual([]);
    expect((await putLogo(w.a.analyst, "Pfizer", PNG)).status).toBe(403);
    const svg = await putLogo(w.a.admin, "Pfizer", SVG, "logo.svg");
    expect(svg.status).toBe(422);
    expect((await putLogo(w.a.admin, "Pfizer", new Uint8Array(300 * 1024).fill(0x89))).status).toBe(422);

    const list = await json(putLogo(w.a.admin, "Pfizer", PNG));
    expect(list).toEqual([{ name: "Pfizer", updatedAt: expect.any(String) }]);
    const img = await call(w.a.client, "GET", "/api/competitor-logos/image?name=Pfizer");
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
    // Another workspace has its own.
    expect((await call(w.b.admin, "GET", "/api/competitor-logos/image?name=Pfizer")).status).toBe(404);

    expect(await json(call(w.a.admin, "DELETE", "/api/competitor-logos?name=Pfizer"))).toEqual([]);
    expect((await call(w.a.client, "GET", "/api/competitor-logos/image?name=Pfizer")).status).toBe(404);
  });
});
