import { expect, expectAccessible, goTab, menuOf, navOf, signInAs, test } from "./fixtures";

test.describe("request 28", () => {
  test("request 70: every tab is its own (no groups); the Eradigm Inbox shows its count", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    const nav = navOf(page);
    await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("button")).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /^Eradigm Inbox/ }).locator(".badge")).toBeVisible();
    await goTab(page, "New Entry");
    await expect(page).toHaveURL(/\/input$/);
    await expect(nav.getByRole("link", { name: "New Entry", exact: true })).toHaveAttribute("aria-current", "page");
    await navOf(page).getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    // Inputs, and the Megatrends Dashboard, Database and Admin tabs (request 63: the Test group is gone).
    expect(await menuOf(page)).toEqual(["New Entry", "Eradigm Inbox", "Client Inbox", "Dashboard", "Database", "Admin"]);
    await expectAccessible(page, "Menu with every group open");
  });

  test("the capture log is a short scrollable table with its header in view", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/input");
    const log = page.getByTestId("capture-log");
    await expect(log).toBeVisible();
    expect(await log.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    expect((await log.boundingBox())!.height).toBeLessThanOrEqual(362);
    expect(await log.locator("thead th").first().evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  });
});
