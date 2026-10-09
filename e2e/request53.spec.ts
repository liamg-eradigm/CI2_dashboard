import { expect, expectAccessible, menuOf, navLink, navOf, signInAs, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/** The table's card runs from the tables strip to the bottom of the window, the width of the page (as on the Primary Tracker). */
async function expectFills(page: Page, card: Locator) {
  await page.waitForTimeout(300);
  const strip = (await page.getByTestId("db-tabs").boundingBox())!;
  const box = (await card.boundingBox())!;
  const main = (await page.locator("main").boundingBox())!;
  expect(Math.abs(box.y - (strip.y + strip.height))).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x - main.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x + box.width - (main.x + main.width))).toBeLessThanOrEqual(2);
  expect(Math.abs(page.viewportSize()!.height - (box.y + box.height))).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
}

test.describe("request 53", () => {
  test("Database: its tables on a strip under the filters (where the Primary Tracker has its AI Summary), the table filling the page", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/database");
    const strip = page.getByTestId("db-tabs");
    const tabs = strip.getByRole("group", { name: "Database to show" });
    await expect(tabs.getByRole("button")).toHaveText(["Primary Tracker", "Secondary Tracker", "CI Analysis", "Newsletter"]);
    await expect(tabs.getByRole("button", { name: "Secondary Tracker" })).toHaveAttribute("aria-pressed", "true");
    // Right under the page's band (the filters start hidden).
    const band = (await page.locator(".band").first().boundingBox())!;
    expect(Math.abs((await strip.boundingBox())!.y - (band.y + band.height))).toBeLessThanOrEqual(2);
    // The table: its name as the heading, full width, to the bottom of the window.
    const card = page.locator("section[aria-label='Approved signals table']");
    await expect(card.getByRole("heading", { name: "Secondary Tracker" })).toBeVisible();
    await expect(page.getByTestId("table-scroll").locator("tbody tr").first()).toBeVisible();
    await expectFills(page, card);
    await expectAccessible(page, "Database: tables strip and full-page table");

    // With the filters shown, the strip sits right under them.
    await page.getByTestId("filters-toggle").click();
    const filters = (await page.getByTestId("db-filters").boundingBox())!;
    expect(Math.abs((await strip.boundingBox())!.y - (filters.y + filters.height))).toBeLessThanOrEqual(2);
    await page.getByTestId("filters-toggle").click();

    await tabs.getByRole("button", { name: "Primary Tracker" }).click();
    await expect(card.getByRole("heading", { name: "Primary Tracker" })).toBeVisible();
    await expectFills(page, card);

    // CI Analysis and Newsletter: the same strip, their tables filling the page too.
    await tabs.getByRole("button", { name: "CI Analysis" }).click();
    await expect(page).toHaveURL(/db=ci/);
    await expectFills(page, page.locator("section[aria-labelledby='ta-list-title']"));
    await tabs.getByRole("button", { name: "Newsletter" }).click();
    await expect(page).toHaveURL(/db=newsletters/);
    await expectFills(page, page.getByTestId("newsletters"));
    await expectAccessible(page, "Database → Newsletter, full page");
  });

  test("the Knowledge Graph tab is gone; the full-page graphs count as the Megatrends Dashboard", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto("/dashboard");
    expect(await menuOf(page)).toEqual(["Inputs: Eradigm Inbox", "Analytics: Megatrends Dashboard, Primary Tracker", "Database"]);
    await expect(navOf(page).getByRole("link", { name: /Knowledge Graph/ })).toHaveCount(0);
    await page.goto("/megatrends");
    await expect(page.locator(".mg-stage")).toBeVisible();
    await expect(navLink(page, "Analytics", "Megatrends Dashboard")).toHaveAttribute("aria-current", "page");
  });
});
