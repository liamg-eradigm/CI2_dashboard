import { expect, expectAccessible, goTab, menuOf, navOf, signInAs, test } from "./fixtures";

test.describe("request 28", () => {
  test("the menu is in groups that open their tabs; a closed group shows its badge", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    const nav = navOf(page);
    // Only the group of the page in view is open.
    await expect(nav.getByRole("button", { name: /^Analytics\b/ })).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("button", { name: /^Inputs\b/ })).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("button", { name: /^Inputs\b/ }).locator(".badge")).toBeVisible();
    await goTab(page, "Inputs", "Input");
    await expect(page).toHaveURL(/\/input$/);
    await expect(nav.getByRole("button", { name: /^Inputs\b/ })).toHaveAttribute("aria-expanded", "true");
    await goTab(page, "Admin", "Administration");
    await expect(page).toHaveURL(/\/admin$/);
    // Four groups and the Database tab (request 43).
    expect(await menuOf(page)).toHaveLength(5);
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
