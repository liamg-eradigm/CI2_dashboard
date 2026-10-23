import { expect, signInAs, test } from "./fixtures";

test.describe("request 32", () => {
  test("no N/A bar in a Macrotrend's impact mix by competitor", async ({ page }) => {
    await signInAs(page, "client");
    // Answer with an N/A competitor among the bars, as a workspace naming "N/A" would.
    await page.route("**/api/dashboard?*", async (route) => {
      const real = await (await route.fetch()).json();
      await route.fulfill({ json: { ...real, compBars: [{ label: "N/A", n: 40, high: 10, medium: 10, low: 20 }, ...real.compBars] } });
    });
    await page.goto(`/analytics/megatrends?m=${encodeURIComponent("AI Investment in R&D")}`);
    await page.getByTestId("md-mix-comp").click();
    const mix = page.getByTestId("md-mix");
    await expect(mix.locator(".bar-row").first()).toBeVisible();
    await expect(mix.locator(".bar-row .lbl", { hasText: /^N\/A$/ })).toHaveCount(0);
  });
});
