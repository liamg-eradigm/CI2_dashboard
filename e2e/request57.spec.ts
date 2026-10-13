import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/** Sync now sits at the right of the header row, level with the bottom of the title. */
async function expectBesideTitle(page: Page, title: Locator, rightInset: number) {
  const bar = page.getByTestId("test-sync-bar");
  await expect(bar).toBeVisible();
  const b = (await bar.boundingBox())!;
  const t = (await title.boundingBox())!;
  const main = (await page.locator("main").boundingBox())!;
  expect(Math.abs(b.y + b.height - (t.y + t.height))).toBeLessThanOrEqual(2);
  expect(Math.abs(main.x + main.width - (b.x + b.width) - rightInset)).toBeLessThanOrEqual(2);
}

test.describe("request 57", () => {
  test("every Test page has Sync now at the top right, aligned with its header; the live pages do not", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    // Database (Secondary and Primary Tracker): in the band, its right padding from the edge.
    await page.goto("/test/database");
    await expectBesideTitle(page, page.locator("h1#page-title"), 32);
    await expect(page.getByTestId("test-sync-checked")).toHaveText(/^Checked (just now|\d+ s ago)$/);
    await expectAccessible(page, "Test → Database with Sync now");
    await page.getByTestId("stream-primary").click();
    await expectBesideTitle(page, page.locator("h1#page-title"), 32);
    // Megatrends Dashboard and the Trends Analysis lists.
    await page.goto("/test/dashboard");
    await expectBesideTitle(page, page.locator("h1").first(), 28);
    await page.goto("/test/analytics/megatrends");
    await expectBesideTitle(page, page.locator("h1").first(), 32);
    // The full-page graph: top right, level with the graph toggle across from it.
    await page.goto("/test/megatrends");
    const toggle = (await page.locator(".mg-crumbs").boundingBox())!;
    const bar = (await page.locator(".mg-stage-end").boundingBox())!;
    const stage = (await page.locator(".mg-stage").boundingBox())!;
    expect(Math.abs(bar.y - toggle.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(bar.height - toggle.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(stage.x + stage.width - (bar.x + bar.width) - (toggle.x - stage.x))).toBeLessThanOrEqual(2);
    // Not on the live pages.
    for (const u of ["/database", "/dashboard", "/analytics/megatrends", "/megatrends"]) {
      await page.goto(u);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByTestId("test-sync-now")).toHaveCount(0);
    }
  });

  test("Sync now reads the workbook at once: here (no SharePoint secrets) it says why it could not", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/test/database");
    const button = page.getByTestId("test-sync-now");
    await expect(button).toHaveText("Sync now");
    const sync = page.waitForRequest((r) => r.url().endsWith("/api/excel/sync") && r.method() === "POST" && (r.postData() ?? "").includes('"force":true'));
    await button.click();
    await sync;
    await expect(page.locator(".toast")).toContainText("Sync failed · Not configured: set SHAREPOINT_");
    await expect(button).toBeEnabled();
  });
});
