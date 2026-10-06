import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("request 32", () => {
  test("Analytics Dashboard: lighter charts, full-width Trends Analysis buttons in large type", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const card = (name: string) => page.locator("section.card", { has: page.getByRole("heading", { name, exact: true }) });
    await expect(card("Impact Mix by Competitor").locator(".bar-row").first()).toBeVisible();
    // Lighter surfaces than the page's night sky.
    const alpha = await card("Signal Timeline").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(alpha).toBe("rgba(32, 82, 108, 0.5)");
    // Megatrends and Competitors line up with the two impact mixes.
    const [m, c] = [(await card("Impact Mix by Macrotrend").boundingBox())!, (await card("Impact Mix by Competitor").boundingBox())!];
    const [bm, bc] = [(await page.getByTestId("ad-megatrends").boundingBox())!, (await page.getByTestId("ad-competitors").boundingBox())!];
    expect(Math.abs(bm.x - m.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(bm.width - m.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(bc.x - c.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(bc.width - c.width)).toBeLessThanOrEqual(1);
    const size = (l: ReturnType<typeof page.locator>) => l.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(await size(page.getByRole("heading", { name: "Trends Analysis" }))).toBeGreaterThanOrEqual(28);
    expect(await size(page.getByTestId("ad-megatrends").locator("b"))).toBe(35);
    await expectAccessible(page, "Analytics Dashboard with time frame sliders");
  });

  test("each impact mix has a time frame slider that updates its bars (and only its own)", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto("/dashboard");
    const card = (name: string) => page.locator("section.card", { has: page.getByRole("heading", { name, exact: true }) });
    const macro = card("Impact Mix by Macrotrend");
    await expect(macro.locator(".bar-row").first()).toBeVisible();
    await expect(page.getByTestId("mix-range-label-macro")).toContainText("All dates");
    const total = async (c: ReturnType<typeof card>) => (await c.locator(".bar-row .n").allInnerTexts()).reduce((sum, t) => sum + t.split("/").reduce((a, x) => a + Number(x.trim()), 0), 0);
    const [macroAll, compAll] = [await total(macro), await total(card("Impact Mix by Competitor"))];
    // Move the last month back to the first: one month only, fetched with its own dates.
    const lastMonth = macro.getByLabel("Last month of Impact Mix by Macrotrend");
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/api/dashboard?") && !r.url().includes("f.")),
      (async () => {
        await lastMonth.focus();
        await page.keyboard.press("Home");
      })(),
    ]);
    const from = new URL(req.url()).searchParams.get("from")!;
    const to = new URL(req.url()).searchParams.get("to")!;
    expect(to.slice(0, 7)).toBe(from.slice(0, 7));
    await expect(page.getByTestId("mix-range-label-macro")).not.toContainText("All dates");
    await expect.poll(() => total(macro)).toBeLessThan(macroAll);
    // The other chart keeps all dates.
    expect(await total(card("Impact Mix by Competitor"))).toBe(compAll);
    await expect(page.getByTestId("mix-range-label-comp")).toContainText("All dates");
    // All dates again.
    await macro.getByRole("button", { name: "All dates" }).click();
    await expect.poll(() => total(macro)).toBe(macroAll);
  });

  test("no N/A bar in Impact Mix by Competitor", async ({ page }) => {
    await signInAs(page, "client");
    // Answer with an N/A competitor among the bars, as a workspace naming "N/A" would.
    await page.route("**/api/dashboard?*", async (route) => {
      const real = await (await route.fetch()).json();
      await route.fulfill({ json: { ...real, compBars: [{ label: "N/A", n: 40, high: 10, medium: 10, low: 20 }, ...real.compBars] } });
    });
    await page.goto("/dashboard");
    const comp = page.locator("section.card", { has: page.getByRole("heading", { name: "Impact Mix by Competitor", exact: true }) });
    await expect(comp.locator(".bar-row").first()).toBeVisible();
    await expect(comp.locator(".bar-row .lbl", { hasText: /^N\/A$/ })).toHaveCount(0);
    await page.goto(`/analytics/megatrends?m=${encodeURIComponent("AI Investment in R&D")}`);
    await page.getByTestId("md-mix-comp").click();
    const mix = page.getByTestId("md-mix");
    await expect(mix.locator(".bar-row").first()).toBeVisible();
    await expect(mix.locator(".bar-row .lbl", { hasText: /^N\/A$/ })).toHaveCount(0);
  });
});
