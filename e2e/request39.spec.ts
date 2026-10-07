import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };

/** Primary entries pushed to the Tracker through the API (as the admin). */
async function push(page: Page, rows: Record<string, unknown>[]) {
  return page.evaluate(
    async ({ rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "primary" }) })).json();
        const values = { ...item.draft, macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", growth: "Stable", impact: "Medium", source: "Primary Source", competitors: ["Roche"], action: "Not Actioned", ...r };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
      }
    },
    { rows, h: ADMIN },
  );
}

test.describe("request 39", () => {
  test("Primary Tracker: a row opens its pop-up; the Archived Responses icon opens it on the left beside the archived table, and an archived row opens its own on the right to compare", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const base = { source_role: `Head of Access ${tag}`, source_company: `Clinic ${tag}`, insight_topic: "Pricing" };
    await push(page, [
      { ...base, title: `Oldest ${tag}`, date: "2026-04-01", key_intelligence_question: "Q1", key_details: "Oldest details.", key_metrics: "40%" },
      { ...base, title: `Middle ${tag}`, date: "2026-06-01", key_intelligence_question: "Q2", key_details: "Middle details.", key_metrics: "20%" },
      { ...base, title: `Newest ${tag}`, date: "2026-09-01", key_intelligence_question: "Q3", key_details: "Newest details.", key_metrics: "5%" },
    ]);
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    // The main table has the Archived Responses table's look: a tinted top bar with a teal title.
    const card = page.getByTestId("table-scroll").locator("xpath=ancestor::section[1]");
    await expect(card.getByRole("heading", { name: "Primary Signals" })).toBeVisible();
    const tint = await card.locator(".table-top").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(tint).not.toBe("rgba(0, 0, 0, 0)");
    const table = page.getByTestId("table-scroll");
    const row = (t: string) => table.getByRole("row", { name: new RegExp(t) });

    // Pressing a row (anywhere but its buttons) opens its pop-up, centred.
    await row(`Middle ${tag}`).getByText("Middle details.").click();
    const primary = page.getByTestId("answer-primary");
    await expect(primary).toContainText("Middle details.");
    await expect(primary).toHaveAttribute("aria-modal", "true");
    await expectAccessible(page, "Primary Tracker row pop-up");
    await primary.getByRole("button", { name: "Open the full record →" }).click();
    await expect(page.getByRole("dialog").filter({ hasText: `Middle ${tag}` })).toBeVisible();
    await page.keyboard.press("Escape");

    // The Archived Responses icon: the signal's pop-up on the left, over the main table; the archived table on the right still works.
    await row(`Newest ${tag}`).getByTestId("archived-cell").click();
    await expect(primary).toContainText("Newest details.");
    await expect(primary).toHaveAttribute("aria-modal", "false");
    const panel = page.getByTestId("archived-panel");
    await expect(panel.locator("tbody tr")).toHaveCount(2);
    const p = (await primary.boundingBox())!;
    const pb = (await panel.boundingBox())!;
    const mainBox = (await card.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(mainBox.x - 1);
    expect(p.x + p.width).toBeLessThanOrEqual(pb.x + 1);
    // Press an archived row: both pop-ups open together, side by side.
    await panel.locator("tbody tr").first().click();
    const archived = page.getByTestId("answer-archived");
    await expect(archived).toContainText("Middle details.");
    await expect(primary).toContainText("Newest details.");
    const a = (await archived.boundingBox())!;
    expect(a.x).toBeGreaterThanOrEqual(p.x + p.width - 1);
    expect(Math.abs(a.y - p.y)).toBeLessThan(4);
    await expect(archived).toContainText("1 of 2");
    await expectAccessible(page, "Two pop-ups side by side");
    // Step to the older answer, then Esc closes the right pop-up, then the left one.
    await archived.getByRole("button", { name: "Older archived response" }).click();
    await expect(archived).toContainText("Oldest details.");
    await expect(archived).toContainText("2 of 2");
    await page.keyboard.press("Escape");
    await expect(archived).toHaveCount(0);
    await expect(primary).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(primary).toHaveCount(0);
    await expect(panel).toBeVisible();
  });
});
