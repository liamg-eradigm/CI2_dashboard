import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const R_AND_D = "AI Investment in R&D";
const SUB = "Computational Infrastructure";

/** A Secondary entry with a long CI Perspective, pushed to the Tracker (as the admin). */
async function pushLong(page: Page, title: string, ci: string) {
  await page.evaluate(
    async ({ title, ci }) => {
      const j = { "x-dev-user": "admin@example.com", "content-type": "application/json" };
      const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "secondary" }) })).json();
      const values = {
        ...item.draft,
        title,
        record_id: `S-36-${Math.random().toString(36).slice(2, 9)}`,
        date: "2026-09-20",
        macrotrend: "AI Investment in R&D",
        subtrend: "Computational Infrastructure",
        growth: "Stable",
        impact: "High",
        source: "PR",
        competitors: ["Pfizer"],
        action: "Not Actioned",
        key_details: `Key details. ${"More detail on the deal. ".repeat(40)}`,
        ci_perspective: ci,
      };
      const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
      if (!res.ok) throw new Error(await res.text());
    },
    { title, ci },
  );
}

test.describe("request 36", () => {
  test("the signal pop-up: 'Signals', no ID, the title beside the Impact dot, and everything readable above the CI Perspective", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const title = `Long perspective ${tag}`;
    await pushLong(page, title, `Watch this closely ${tag}. ${"A long CI Perspective that runs on. ".repeat(60)}`);
    // Request 70: the Knowledge Graph page (the Macrotrend page has no graph row any more).
    await page.goto(`/megatrends?${new URLSearchParams({ m: R_AND_D, s: SUB })}`);
    const sheet = page.getByTestId("mg-sheet");
    const list = sheet.getByTestId("mg-sources");
    await expect(list.locator(".mg-pages-label")).toHaveText("Signals");
    await expect(sheet.getByRole("list", { name: `Signals of ${SUB}` })).toBeVisible();
    await expect(sheet).toHaveAttribute("aria-label", "Signals");
    await list.getByRole("button", { name: new RegExp(title) }).click();

    const head = sheet.locator(".mg-sheet-head.entry");
    const h2 = head.getByRole("heading", { level: 2, name: title });
    await expect(h2).toBeVisible();
    await expect(head.locator(".mono")).toHaveCount(0);
    await expect(head).not.toContainText("S-36-");
    // The title beside the dot, and a little smaller than before.
    const dot = (await head.locator(".mg-sheet-titlebar .dot").boundingBox())!;
    const hb = (await h2.boundingBox())!;
    expect(dot.x).toBeLessThan(hb.x);
    expect(Math.abs(dot.y - hb.y)).toBeLessThan(12);
    expect(Number.parseFloat(await h2.evaluate((el) => getComputedStyle(el).fontSize))).toBeLessThanOrEqual(15);
    // The drawer reaches near the top of the graph.
    const sb = (await sheet.boundingBox())!;
    const gb = (await page.locator(".mg-stage").boundingBox())!;
    expect(sb.y - gb.y).toBeLessThan(12);

    // Fields, then the CI Perspective, in one scroll: the CI Perspective never covers the fields; its text scrolls in its own box.
    const body = sheet.locator(".mg-entry-body");
    const ci = sheet.getByTestId("mg-ci");
    await ci.scrollIntoViewIfNeeded();
    await expect(ci).toContainText(`Watch this closely ${tag}.`);
    const lastField = (await sheet.locator(".mg-field").last().boundingBox())!;
    const cb = (await ci.boundingBox())!;
    expect(cb.y).toBeGreaterThanOrEqual(lastField.y + lastField.height);
    const text = ci.locator(".mg-ci-text");
    expect(await text.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await text.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    expect(await body.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    await expectAccessible(page, "Signal with a long CI Perspective");

    // ← back to the signals.
    await sheet.getByRole("button", { name: `Back to the signals of ${SUB}` }).click();
    await expect(list).toBeVisible();
  });
});
