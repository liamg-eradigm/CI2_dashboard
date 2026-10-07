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

test.describe("request 42", () => {
  test("Primary Tracker: no Source or Edit columns; Full Discussion (chat icon) as before; KIQ Archive links only answers to the same KIQ", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const base = { source_role: `Head of Access ${tag}`, source_company: `Clinic ${tag}`, insight_topic: "Pricing" };
    await push(page, [
      { ...base, title: `Oldest ${tag}`, date: "2026-04-01", key_intelligence_question: "Will payers cover it?", key_details: "Oldest details." },
      { ...base, title: `Middle ${tag}`, date: "2026-06-01", key_intelligence_question: "Is uptake growing?", key_details: "Middle details." },
      { ...base, title: `Newest ${tag}`, date: "2026-09-01", insight_topic: " pricing ", key_intelligence_question: "will payers cover it?", key_details: "Newest details." },
    ]);
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    const table = page.getByTestId("table-scroll").locator("table");
    const row = (t: string) => table.getByRole("row", { name: new RegExp(t) });
    await expect(row(`Newest ${tag}`)).toBeVisible();
    const heads = (await table.locator("thead th").allTextContents()).map((h) => h.replace(/[↓↑]/g, "").trim());
    expect(heads).not.toContain("Source");
    expect(heads).not.toContain("Edit");
    expect(heads).not.toContain("Archived Responses");
    // KIQ Archive sits right of Full Discussion, then the seven columns.
    expect(heads.indexOf("KIQ Archive")).toBe(heads.indexOf("Full Discussion") + 1);
    expect(heads.slice(heads.indexOf("KIQ Archive") + 1)).toEqual(COLUMNS);
    await expect(table.getByRole("button", { name: /^Edit/ })).toHaveCount(0);

    // Full Discussion: a chat icon, every earlier answer from the source, as before.
    await expect(table.getByTestId("archived-cell")).toHaveCount(2);
    await expect(row(`Newest ${tag}`).getByTestId("archived-cell").locator('svg[data-icon="chat"]')).toHaveCount(1);
    // KIQ Archive: a link icon only where an earlier answer has the same Insight Topic and KIQ.
    await expect(table.getByTestId("kiq-cell")).toHaveCount(1);
    await expect(row(`Newest ${tag}`).getByTestId("kiq-cell").locator('svg[data-icon="link"]')).toHaveCount(1);
    await expect(row(`Middle ${tag}`).getByTestId("kiq-cell")).toHaveCount(0);
    await expectAccessible(page, "Primary Tracker with Full Discussion and KIQ Archive");

    // KIQ Archive opens the pop-up on the left and only the matching answer on the right.
    await row(`Newest ${tag}`).getByTestId("kiq-cell").click();
    const primary = page.getByTestId("answer-primary");
    await expect(primary).toContainText("Newest details.");
    const panel = page.getByTestId("archived-panel");
    await expect(panel.getByRole("heading", { name: "KIQ Archive" })).toBeVisible();
    await expect(panel.locator("tbody tr")).toHaveCount(1);
    await expect(panel.locator("tbody tr")).toContainText("Oldest details.");
    await panel.locator("tbody tr").first().click();
    await expect(page.getByTestId("answer-archived")).toContainText("Oldest details.");
    await expect(page.getByTestId("answer-archived")).toContainText("1 of 1");
    await expectAccessible(page, "KIQ Archive split screen");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("answer-archived")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(primary).toHaveCount(0);
    await panel.getByRole("button", { name: "Close KIQ Archive" }).click();
    await expect(panel).toHaveCount(0);

    // Full Discussion is unchanged: both earlier answers.
    await row(`Newest ${tag}`).getByTestId("archived-cell").click();
    await expect(primary).toContainText("Newest details.");
    await expect(panel.getByRole("heading", { name: "Archived Responses" })).toBeVisible();
    await expect(panel.locator("tbody tr")).toHaveCount(2);
  });
});
