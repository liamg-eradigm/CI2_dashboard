import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };
const COLUMNS = ["Source Company", "Source Role", "Event Date", "Insight Topic", "Key Intelligence Question", "Key Details", "Key Metrics"];

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

test.describe("request 38", () => {
  test("Analytics → Primary Tracker and its Archived Responses show these seven columns, in order, and nothing else", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const base = { source_role: `Head of Access ${tag}`, source_company: `Clinic ${tag}`, insight_topic: `Pricing ${tag}` };
    await push(page, [
      { ...base, title: `Earlier ${tag}`, date: "2026-05-01", key_intelligence_question: "How will payers react?", key_details: "Payers push back.", key_metrics: "30% rejections" },
      { ...base, title: `Later ${tag}`, date: "2026-09-01", key_intelligence_question: "Has it changed?", key_details: "Payers accept it now.", key_metrics: "5% rejections" },
    ]);
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    const table = page.getByTestId("table-scroll").locator("table");
    await expect(table.getByRole("row", { name: new RegExp(`Later ${tag}`) })).toBeVisible();
    const heads = (await table.locator("thead th").allTextContents()).map((h) => h.replace(/[↓↑]/g, "").trim());
    // After the tick box, Source, Archived Responses and Edit columns: exactly these, in order.
    expect(heads.slice(heads.indexOf("Edit") + 1)).toEqual(COLUMNS);
    expect(heads).not.toContain("Title");
    expect(heads).not.toContain("Macrotrend");
    const row = table.getByRole("row", { name: new RegExp(`Later ${tag}`) });
    await expect(row).toContainText(`Clinic ${tag}`);
    await expect(row).toContainText("1 Sept 2026".replace("Sept", "Sep"));
    await expect(row).toContainText("Has it changed?");
    await expect(row).toContainText("5% rejections");
    // The first column opens the entry's pop-up (request 39).
    await row.getByRole("button", { name: `Open: Later ${tag}` }).click();
    await expect(page.getByTestId("answer-primary")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("answer-primary")).toHaveCount(0);

    // Archived Responses: the same columns, in order, and nothing else.
    await row.getByTestId("archived-cell").click();
    const pop = page.getByTestId("answer-primary");
    await expect(pop.locator("dt")).toHaveText(COLUMNS.slice(0, 3));
    await expect(pop.locator("h3")).toHaveText(COLUMNS.slice(3));
    await expect(pop).toContainText("Has it changed?");
    await expect(pop).not.toContainText(`Later ${tag}`);
    await expectAccessible(page, "Primary Tracker answer popup");
    await pop.getByRole("button", { name: "Close the primary signal" }).click();
    const panel = page.getByTestId("archived-panel");
    await expect(panel.locator("thead th")).toHaveText(COLUMNS);
    const arow = panel.locator("tbody tr").first();
    await expect(arow.locator("td")).toHaveCount(7);
    await expect(arow).toContainText(`Clinic ${tag}`);
    await expect(arow).toContainText("How will payers react?");
    await expect(arow).toContainText("30% rejections");
    await arow.getByRole("button", { name: `Open archived response: Earlier ${tag}` }).click();
    await expect(page.getByTestId("answer-archived")).toContainText("Payers push back.");
    await expectAccessible(page, "Archived Responses with the seven columns");
  });
});
