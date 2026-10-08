import { choose, expect, expectAccessible, goTab, navOf, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com", "content-type": "application/json" };
const FIELDS = ["Source Company", "Source Role", "Event Date", "Insight Topic", "Key Intelligence Question", "Key Details", "Key Metrics"];

/** Primary entries pushed to the Tracker through the API (as the admin). */
async function push(page: Page, rows: Record<string, unknown>[]) {
  await page.evaluate(
    async ({ rows, h }) => {
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: h, body: JSON.stringify({ stream: "primary" }) })).json();
        const values = { ...item.draft, macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", growth: "Stable", impact: "Medium", source: "Primary Source", competitors: ["Roche"], action: "Not Actioned", ...r };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: h, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
      }
    },
    { rows, h: ADMIN },
  );
}

test.describe("request 41", () => {
  test("Analytics → Primary Tracker has its own filters, one per column, that never carry over to other pages", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, [
      { title: `Alpha ${tag}`, date: "2026-03-10", source_company: `Alpha Clinic ${tag}`, source_role: "Medical Director", insight_topic: `Topic ${tag}`, key_intelligence_question: "Will payers cover it?", key_details: "Payers push back on price.", key_metrics: "30% rejected" },
      { title: `Beta ${tag}`, date: "2026-08-10", source_company: `Beta Hospital ${tag}`, source_role: "Head of Access", insight_topic: `Topic ${tag}`, key_intelligence_question: "Is uptake growing?", key_details: "Uptake is growing fast.", key_metrics: "12% growth" },
    ]);
    await page.goto("/analytics/primary");
    const bar = page.getByTestId("ptr-filters");
    await expect(bar.getByRole("combobox", { name: "Source Company" })).toBeVisible();
    // One filter per column, in the table's order; none of the shared filters (Macrotrend, search, saved views).
    const labels = (await bar.locator(":scope > .field > span:first-child").allTextContents()).map((t) => t.trim());
    expect(labels).toEqual(FIELDS);
    await expect(page.getByRole("combobox", { name: "Macrotrend", exact: true })).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "Search titles and extracted text" })).toHaveCount(0);
    await expectAccessible(page, "Primary Tracker filters");

    const rows = page.getByTestId("table-scroll").locator("tbody tr");
    // Source Company: chosen from the values in the tracker.
    await choose(bar.getByRole("combobox", { name: "Source Company" }), `Alpha Clinic ${tag}`);
    await expect(page).toHaveURL(/pt\.source_company=/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Payers push back on price.");
    await choose(bar.getByRole("combobox", { name: "Source Company" }), "All");
    // Insight Topic narrows to both; Key Details "contains" narrows to one (any case).
    await choose(bar.getByRole("combobox", { name: "Insight Topic" }), `Topic ${tag}`);
    await expect(rows).toHaveCount(2);
    await bar.getByRole("searchbox", { name: "Key Details contains" }).fill("GROWING");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`Beta Hospital ${tag}`);
    await expect(page.getByRole("region", { name: "Active filters" })).toContainText("Key Details: contains “GROWING”");
    // Event Date: from / to.
    await bar.getByRole("searchbox", { name: "Key Details contains" }).fill("");
    await expect(rows).toHaveCount(2);
    await bar.getByLabel("Event Date to").fill("2026-06-30");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`Alpha Clinic ${tag}`);
    // The Primary Tracker's filters stay on this tab: the Database has none of them…
    await navOf(page).getByRole("link", { name: "Database", exact: true }).click();
    await expect(page).toHaveURL(/\/database/);
    expect(page.url()).not.toContain("pt.");
    await expect(page.getByRole("region", { name: "Active filters" })).not.toContainText(tag);
    // …and the filters set there do not reach the Primary Tracker.
    if (!(await page.getByTestId("db-filters").isVisible())) await page.getByTestId("filters-toggle").click();
    await choose(page.getByTestId("db-filters").getByRole("combobox", { name: "Macrotrend", exact: true }), "AI Investment in R&D");
    await goTab(page, "Analytics", "Primary Tracker");
    await expect(page).toHaveURL(/\/analytics\/primary$/);
    await choose(page.getByTestId("ptr-filters").getByRole("combobox", { name: "Insight Topic" }), `Topic ${tag}`);
    // Both Geopolitics entries show, though the Database was filtered to another Macrotrend.
    await expect(page.getByTestId("table-scroll").locator("tbody tr")).toHaveCount(2);
    // Reset clears them.
    await page.getByRole("button", { name: "Reset filter" }).click();
    await expect(page).not.toHaveURL(/pt\./);
  });
});
