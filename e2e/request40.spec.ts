import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com", "content-type": "application/json" };
const R_AND_D = "AI Investment in R&D";
const SUB = "Agentic AI Platforms";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Secondary entries in one Subtrend, pushed to the Tracker through the API (as the admin). */
async function push(page: Page, rows: { title: string; date: string }[]) {
  await page.evaluate(
    async ({ rows, h, m, s }) => {
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: h, body: JSON.stringify({ stream: "secondary" }) })).json();
        const values = {
          ...item.draft,
          title: r.title,
          date: r.date,
          record_id: `S-40-${Math.random().toString(36).slice(2, 9)}`,
          macrotrend: m,
          subtrend: s,
          growth: "Stable",
          impact: "High",
          source: "PR",
          competitors: ["Roche"],
          action: "Not Actioned",
        };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: h, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
      }
    },
    { rows, h: ADMIN, m: R_AND_D, s: SUB },
  );
}
const setDays = (page: Page, days: number) =>
  page.evaluate(async ({ h, days }) => (await fetch("/api/settings", { method: "PATCH", headers: h, body: JSON.stringify({ newSignals: { days } }) })).ok, { h: ADMIN, days });

test.describe("request 40", () => {
  test("new signals pulse in the knowledge graph and are tagged NEW (glowing red, left of CI Perspective); admins set the cutoff", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, [
      { title: `Fresh signal ${tag}`, date: daysAgo(3) },
      { title: `Older signal ${tag}`, date: daysAgo(40) },
    ]);
    expect(await setDays(page, 14)).toBe(true);

    // The knowledge graph tab: the Subtrend's signals list.
    await page.goto(`/megatrends?${new URLSearchParams({ m: R_AND_D, s: SUB })}`);
    const list = page.getByTestId("mg-sources");
    const fresh = list.getByRole("button", { name: new RegExp(`Fresh signal ${tag}`) });
    const older = list.getByRole("button", { name: new RegExp(`Older signal ${tag}`) });
    await expect(fresh.getByTestId("new-tag")).toHaveText(/new/i);
    await expect(older.getByTestId("new-tag")).toHaveCount(0);
    // Glowing red, and left of the CI Perspective tag when there is one.
    const shadow = await fresh.getByTestId("new-tag").evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toContain("rgba(255, 90, 100");
    const withCi = list.locator("button").filter({ has: page.getByTestId("new-tag") }).filter({ has: page.getByTestId("ci-tag") }).first();
    if (await withCi.count()) {
      const n = (await withCi.getByTestId("new-tag").boundingBox())!;
      const c = (await withCi.getByTestId("ci-tag").boundingBox())!;
      expect(n.x + n.width).toBeLessThanOrEqual(c.x);
    }
    // The new ones pulse among the Subtrend's signals in orbit.
    const canvas = page.getByTestId("mg-canvas");
    await expect.poll(async () => Number(await canvas.getAttribute("data-fresh"))).toBeGreaterThanOrEqual(1);
    await expectAccessible(page, "Knowledge graph with a new signal");

    // The Macrotrend dashboard's graph too.
    await page.goto(`/analytics/megatrends?${new URLSearchParams({ m: R_AND_D, v: "3", s: SUB })}`);
    await expect(page.getByTestId("md-graph").getByTestId("mg-sources").getByRole("button", { name: new RegExp(`Fresh signal ${tag}`) }).getByTestId("new-tag")).toBeVisible();

    // Administration: the cutoff (60 days makes the older one new too).
    await page.goto("/admin");
    const box = page.getByTestId("new-signal-settings");
    await expect(box.getByLabel("New for (days after its Event Date)")).toHaveValue("14");
    await box.getByLabel("New for (days after its Event Date)").fill("60");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeAttached();
    await page.goto(`/megatrends?${new URLSearchParams({ m: R_AND_D, s: SUB })}`);
    await expect(page.getByTestId("mg-sources").getByRole("button", { name: new RegExp(`Older signal ${tag}`) }).getByTestId("new-tag")).toBeVisible();
    expect(await setDays(page, 14)).toBe(true);
  });
});
