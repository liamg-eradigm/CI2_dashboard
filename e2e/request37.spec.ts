import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("request 37", () => {
  for (const [w, h] of [
    [1366, 768],
    [1536, 864],
  ] as const) {
    test(`database tables scroll inside a box that fits a ${w}×${h} screen, the header row staying in view`, async ({ page }) => {
      await signInAs(page, "admin");
      await page.setViewportSize({ width: w, height: h });
      for (const url of ["/tracker?all=1", "/tracker?stream=primary", "/phantoms?all=1", "/analytics/primary", "/trend-analyses"]) {
        await page.goto(url);
        const box = page.getByTestId(url === "/trend-analyses" ? "trend-analyses-table" : "table-scroll");
        const scroller = url === "/trend-analyses" ? box.locator("xpath=..") : box;
        await expect(scroller).toBeVisible();
        await scroller.scrollIntoViewIfNeeded();
        // (CI analyses may have no rows yet)
        if (url !== "/trend-analyses") await expect(scroller.locator("tbody tr").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        const card = scroller.locator("xpath=ancestor::section[1]");
        const hasBar = (await page.locator(".filterbar").count()) > 0;
        // The whole card sits below the sticky filter bar, and the box (so its horizontal scrollbar) is on screen.
        await expect
          .poll(async () => {
            await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
            const c = (await card.boundingBox())!;
            const b = (await scroller.boundingBox())!;
            const bar = hasBar ? await page.locator(".filterbar").boundingBox() : null;
            return c.y >= (bar ? bar.y + bar.height : 0) - 1 && c.y + c.height <= h + 1 && b.y + b.height <= h + 1;
          }, { message: url })
          .toBe(true);
        expect(await scroller.evaluate((el) => getComputedStyle(el).overflowY), url).toBe("auto");
      }
      // A long table scrolls inside its box, both ways, with its header row kept in view.
      await page.goto("/tracker?all=1");
      const box = page.getByTestId("table-scroll");
      await expect(box.locator("tbody tr").nth(20)).toBeAttached();
      expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(await box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      const head = box.locator("thead th").nth(3);
      const y0 = (await head.boundingBox())!.y;
      await box.evaluate((el) => el.scrollBy(0, 400));
      await expect.poll(async () => Math.abs((await head.boundingBox())!.y - y0)).toBeLessThan(2);
      await box.evaluate((el) => el.scrollBy(300, 0));
      expect(await box.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await expectAccessible(page, "Signals Database with the table scrolling in its box");
    });
  }
});
