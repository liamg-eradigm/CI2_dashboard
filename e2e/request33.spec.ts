import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("request 33: Analytics Dashboard layout", () => {
  for (const [w, h] of [
    [1440, 900],
    [1366, 768],
  ] as const) {
    test(`fits a ${w}×${h} window without scrolling`, async ({ page }) => {
      await signInAs(page, "client");
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/dashboard");
      await expect(page.getByTestId("mix-comp").locator(".bar-row").first()).toBeVisible();
      const dash = page.getByTestId("analytics-dashboard");
      const m = await dash.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, doc: document.documentElement.scrollHeight }));
      expect(m.sh).toBeLessThanOrEqual(m.ch);
      expect(m.doc).toBeLessThanOrEqual(h);
      await expect(page.getByTestId("ad-competitors")).toBeInViewport({ ratio: 1 });
      // Request 34: room below the Trends Analysis buttons.
      const b = (await page.getByTestId("ad-competitors").boundingBox())!;
      expect(h - (b.y + b.height)).toBeGreaterThanOrEqual(w === 1440 ? 48 : 20);
      // The plot sits inside its card.
      const [plot, card] = [(await page.getByTestId("signal-timeline").boundingBox())!, (await page.locator(".tl-card").boundingBox())!];
      expect(plot.y + plot.height).toBeLessThan(card.y + card.height);
    });
  }

  test("the two impact mixes are the same size with level rows; competitors stop at the top 9, Show all keeps the box", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    // More competitors than Macrotrends.
    await page.route("**/api/dashboard?*", async (route) => {
      const real = await (await route.fetch()).json();
      const extra = ["Bayer", "Takeda", "Amgen", "GSK", "Merck & Co. (MSD) Research Laboratories", "Eli Lilly"].map((label, i) => ({ label, n: 6 - i, high: 1, medium: 1, low: 4 - i }));
      await route.fulfill({ json: { ...real, compBars: [...real.compBars, ...extra] } });
    });
    await page.goto("/dashboard");
    const [macro, comp] = [page.getByTestId("mix-macro"), page.getByTestId("mix-comp")];
    await expect(comp.locator(".bar-row")).toHaveCount(9);
    const box = async () => [(await macro.boundingBox())!, (await comp.boundingBox())!];
    const [a, b] = await box();
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
    const ys = (l: typeof macro) => l.locator(".bar-row").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
    const [ym, yc] = [await ys(macro), await ys(comp)];
    ym.forEach((y, i) => expect(Math.abs(y - (yc[i] as number))).toBeLessThanOrEqual(1));
    // Bars start level too.
    const tracks = (l: typeof macro) => l.locator(".bar-row .track").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
    expect(await tracks(macro)).toEqual(await tracks(comp));
    // Show all: every competitor, in the same box (it scrolls).
    await comp.getByRole("button", { name: /^Show all \d+/ }).click();
    expect(await comp.locator(".bar-row").count()).toBeGreaterThan(9);
    const [a2, b2] = await box();
    expect(Math.abs(a2.height - b2.height)).toBeLessThanOrEqual(1);
    await expectAccessible(page, "Analytics Dashboard, all competitors");
    await comp.getByRole("button", { name: "Show top 9" }).click();
    await expect(comp.locator(".bar-row")).toHaveCount(9);
  });

  test("labels stay on one line; a long one is cut off and opens in full", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const macro = page.getByTestId("mix-macro");
    await expect(macro.locator(".bar-row").first()).toBeVisible();
    // Every row the same height (one line).
    const heights = await macro.locator(".bar-row").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
    const cut = macro.locator("button.mix-lbl").first();
    await expect(cut).toHaveAttribute("aria-expanded", "false");
    const full = (await cut.getAttribute("title"))!;
    const rowY = await macro.locator(".bar-row").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
    await cut.click();
    const open = macro.locator("button.mix-lbl[aria-expanded='true']");
    await expect(open).toHaveText(full);
    // Opening it moves no row.
    expect(await macro.locator(".bar-row").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)))).toEqual(rowY);
    await open.click();
    await expect(macro.locator("button.mix-lbl[aria-expanded='true']")).toHaveCount(0);
  });

  test("the timeline's plot is light blue (request 34), and Megatrends / Competitors are 5px smaller", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/dashboard");
    await expect(page.getByTestId("signal-timeline")).toBeVisible();
    expect(await page.getByTestId("signal-timeline").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(228, 241, 248)");
    expect(await page.getByTestId("ad-megatrends").locator("b").evaluate((el) => getComputedStyle(el).fontSize)).toBe("35px");
  });
});
