import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };
const KEYS = ["heading:company-profile", "heading:cd-timeline", "heading:cd-mix"];

/** Set title sizes back to their default (sizes are shared by every test). */
const resetSizes = (page: Page) =>
  page.evaluate(
    async ({ keys, h }) => {
      for (const key of keys) await fetch("/api/settings/text-size", { method: "PUT", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ key, size: 1 }) });
    },
    { keys: KEYS, h: ADMIN },
  );

test.describe("request 50", () => {
  test("a competitor's page: staff size its headings and edit the Company Profile in place, with formatting", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await resetSizes(page);
    await page.goto(`/analytics/competitors?${new URLSearchParams({ c: "Novartis" })}`);
    const profile = page.getByTestId("ta-summary");
    await expect(profile.getByRole("heading", { name: "Company Profile · Novartis" })).toBeVisible();

    // Headings: Company Profile, Signal Timeline and the impact mix.
    const size = (l: ReturnType<Page["locator"]>) => l.locator(".ts-text").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    for (const [key, heading] of [
      ["heading:company-profile", page.locator("#ta-summary-title")],
      ["heading:cd-timeline", page.locator("#ta-tl-title")],
      ["heading:cd-mix", page.locator("#mix-macro")],
    ] as const) {
      const base = await size(heading);
      await heading.hover();
      const sizes = page.getByTestId(`ts-${key}`);
      await sizes.getByTestId("ts-larger").click();
      await expect(sizes).toContainText("115%");
      expect(await size(heading)).toBeCloseTo(base * 1.15, 0);
    }
    await expectAccessible(page, "Competitor page with sized headings");

    // The Company Profile is edited in place: select text to make it larger.
    const before = await page.evaluate(async (h) => {
      const c = (await (await fetch("/api/competitors?stream=all", { headers: h })).json()) as { competitors: { name: string; summary: { text: string; source: string } | null }[] };
      return c.competitors.find((x) => x.name === "Novartis")?.summary ?? null;
    }, ADMIN);
    await profile.getByRole("button", { name: "Edit the Company Profile of Novartis" }).click();
    const field = profile.getByRole("textbox", { name: "Company Profile of Novartis" });
    const tag = `Novartis profile ${Date.now()}`;
    await field.fill(`${tag} with key wins.`);
    await field.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent?.indexOf("key wins") ?? -1;
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + "key wins".length);
        const s = window.getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    });
    const bar = page.getByTestId("format-bar");
    await expect(bar).toBeVisible();
    await bar.getByTestId("fmt-larger").click();
    await bar.getByTestId("fmt-bold").click();
    await expectAccessible(page, "Company Profile being edited");
    await profile.getByRole("button", { name: "Save", exact: true }).click();
    const text = profile.getByTestId("ta-summary-text");
    await expect(text).toContainText(tag);
    await expect(text.locator('span[style*="font-size"]')).toHaveText("key wins");
    await expect(text.locator("strong")).toHaveText("key wins");
    await expect(profile).toContainText("Written by E. Admin");

    // A client sees the sizes and the text, but no buttons.
    await signInAs(page, "client");
    await page.goto(`/analytics/competitors?${new URLSearchParams({ c: "Novartis" })}`);
    await expect(page.getByTestId("ta-summary-text")).toContainText(tag);
    await expect(page.getByRole("button", { name: /Edit the Company Profile/ })).toHaveCount(0);
    await expect(page.getByTestId("ts-heading:company-profile")).toHaveCount(0);
    await expect(page.locator("#ta-summary-title")).toHaveAttribute("data-size", "1.15");

    // Put things back for the other tests.
    await signInAs(page, "admin");
    await resetSizes(page);
    await page.evaluate(
      async ({ text, h }) => {
        await fetch("/api/megatrends/summaries", { method: "PUT", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ level: "competitor", name: "Novartis", text }) });
      },
      { text: before && before.source !== "default" ? before.text : "", h: ADMIN },
    );
  });
});
