import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };

/** Entries pushed to a tracker through the API (as the admin). */
async function push(page: Page, stream: "primary" | "secondary", rows: Record<string, unknown>[]) {
  return page.evaluate(
    async ({ stream, rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const ids: string[] = [];
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream }) })).json();
        const values = { ...item.draft, macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", growth: "Stable", impact: "Medium", source: stream === "primary" ? "Primary Source" : "PR", competitors: ["Roche"], action: "Not Actioned", ...r };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
        ids.push(item.id);
      }
      return ids;
    },
    { stream, rows, h: ADMIN },
  );
}

/** Set a title size back to its default (sizes are shared by every test). */
const resetSize = (page: Page, key: string) =>
  page.evaluate(async ({ key, h }) => void (await fetch("/api/settings/text-size", { method: "PUT", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ key, size: 1 }) })), { key, h: ADMIN });

const px = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

test.describe("request 47", () => {
  test("Primary Tracker and Database: close the filters to give the table more room (remembered)", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    await page.evaluate(() => {
      for (const k of ["eradigm.filters.ptr", "eradigm.filters.db", "eradigm.filters.ptr.closed", "eradigm.filters.db.closed"]) localStorage.removeItem(k);
      localStorage.removeItem("eradigm.ptr.aiSummaryHeight");
    });
    const tag = Math.random().toString(36).slice(2, 8);
    await push(
      page,
      "primary",
      Array.from({ length: 14 }, (_, i) => ({ title: `Row ${i} ${tag}`, date: "2026-09-01", source_role: "Lead", source_company: `Clinic ${tag}`, key_intelligence_question: `Q${i}` })),
    );

    // Primary Tracker.
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    const scroll = page.getByTestId("table-scroll");
    await expect(scroll.locator("tbody tr")).toHaveCount(10);
    const filters = page.getByTestId("ptr-filters");
    const toggle = page.getByTestId("filters-toggle");
    await expect(filters).toBeVisible();
    await expect(toggle).toHaveText(/Hide filters/);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(250);
    const open = (await scroll.boundingBox())!.height;
    await toggle.click();
    await expect(filters).toBeHidden();
    await expect(toggle).toHaveText(/Show filters/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.waitForTimeout(250);
    const closed = (await scroll.boundingBox())!;
    expect(closed.height - open).toBeGreaterThan(60);
    // Still fits the window: the table's room grows, the page does not scroll.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(865);
    // The active filters stay in view, and the AI Summary stays attached under the band.
    await expect(page.getByRole("region", { name: "Active filters" })).toContainText(`Clinic ${tag}`);
    await expectAccessible(page, "Primary Tracker with the filters closed");
    await page.reload();
    await expect(scroll.locator("tbody tr")).toHaveCount(10);
    await expect(filters).toBeHidden();
    await toggle.click();
    await expect(filters).toBeVisible();

    // Database: its own setting (closed at first since request 48).
    await page.goto(`/database?${new URLSearchParams({ stream: "primary", "db.t.source_company": tag })}`);
    const dbFilters = page.getByTestId("db-filters");
    await expect(page.getByTestId("table-scroll").locator("tbody tr").first()).toBeVisible();
    await expect(dbFilters).toBeHidden();
    await page.getByTestId("filters-toggle").click();
    await expect(dbFilters).toBeVisible();
    await page.waitForTimeout(250);
    const dbOpen = (await page.getByTestId("table-scroll").boundingBox())!.height;
    await page.getByTestId("filters-toggle").click();
    await expect(dbFilters).toBeHidden();
    await page.waitForTimeout(250);
    expect((await page.getByTestId("table-scroll").boundingBox())!.height - dbOpen).toBeGreaterThan(40);
    await page.reload();
    await expect(dbFilters).toBeHidden();
    await page.getByTestId("filters-toggle").click();
    await expect(dbFilters).toBeVisible();
  });

  test("editing a text box keeps its size and scrolls (record editor and AI Summary)", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await page.evaluate(() => localStorage.removeItem("eradigm.ptr.aiSummaryHeight"));
    const tag = Math.random().toString(36).slice(2, 8);
    const long = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the details.`).join("\n");
    await push(page, "secondary", [{ title: `Scrolling ${tag}`, date: "2026-09-01", key_details: long }]);
    await page.goto(`/tracker?${new URLSearchParams({ q: tag })}`);
    await page.getByRole("button", { name: `Edit Scrolling ${tag}` }).click();
    const field = page.getByRole("dialog").getByRole("textbox", { name: "Key Details" });
    await expect(field).toContainText("Line 30");
    const box = async () => field.evaluate((el) => ({ h: el.getBoundingClientRect().height, sh: el.scrollHeight, ch: el.clientHeight }));
    const before = await box();
    // Six lines high, the rest scrolls inside the box.
    expect(before.h).toBeLessThan(220);
    expect(before.sh).toBeGreaterThan(before.ch + 100);
    await field.click();
    await page.keyboard.press("Control+End");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Enter");
      await page.keyboard.type(`Added ${i}`);
    }
    const after = await box();
    expect(Math.abs(after.h - before.h)).toBeLessThan(1);
    expect(await field.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press("Escape");

    // The Primary Tracker's AI Summary: editing keeps the box's size (the text scrolls).
    await push(page, "primary", [
      { title: `First ${tag}`, date: "2026-09-01", source_role: "Lead", source_company: `Clinic ${tag}`, key_intelligence_question: "Q1" },
      { title: `Second ${tag}`, date: "2026-09-01", source_role: "Lead", source_company: `Clinic ${tag}`, key_intelligence_question: "Q2" },
    ]);
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    await page.getByTestId("table-scroll").getByRole("row", { name: new RegExp(`First ${tag}`) }).getByTestId("archived-cell").click();
    const summary = page.getByTestId("ai-summary");
    await summary.getByRole("button", { name: "Write the summary" }).click();
    const editor = summary.getByLabel(/AI Summary of this Full Discussion/);
    await editor.fill(long);
    await summary.getByRole("button", { name: "Save", exact: true }).click();
    await expect(summary.getByTestId("ai-summary-text")).toContainText("Line 30");
    await page.waitForTimeout(250);
    const shown = (await summary.boundingBox())!.height;
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await summary.getByRole("button", { name: /^Edit/ }).click();
    await expect(editor).toBeVisible();
    await page.waitForTimeout(250);
    const editing = (await summary.boundingBox())!.height;
    expect(Math.abs(editing - shown)).toBeLessThan(2);
    expect(await editor.evaluate((el) => el.scrollHeight > el.clientHeight + 50)).toBe(true);
    // Nothing below moves: the page is no taller than before.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(pageHeight + 1);
    await expectAccessible(page, "AI Summary being edited at its own size");
  });

  test("title sizes: staff change the entry Title and section headings with A− / A+, for everyone", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    for (const k of ["entry-title", "heading:ai-summary", "label:key_details"]) await resetSize(page, k);
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, "secondary", [{ title: `Sized ${tag}`, date: "2026-09-01", key_details: "Some details." }]);
    await page.goto(`/tracker?${new URLSearchParams({ q: tag })}`);
    await page.getByRole("row", { name: new RegExp(`Sized ${tag}`) }).getByRole("button", { name: `Open record: Sized ${tag}` }).click();
    const drawer = page.getByRole("dialog");
    // The dialog is still named by the title alone.
    await expect(page.getByRole("dialog", { name: `Sized ${tag}` })).toBeVisible();
    const title = drawer.locator("#drawer-title .ts-text");
    expect(await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(20, 0);
    const sizes = drawer.getByTestId("ts-entry-title");
    await drawer.locator("#drawer-title").hover();
    await expect(sizes.getByTestId("ts-larger")).toBeVisible();
    await expect(sizes).toContainText("100%");
    await sizes.getByRole("button", { name: "Larger entry titles" }).click();
    await sizes.getByRole("button", { name: "Larger entry titles" }).click();
    await expect(sizes).toContainText("130%");
    expect(await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(26, 0);
    // A heading in the record: the Key Details heading.
    const kd = drawer.getByTestId("ts-label:key_details");
    await kd.getByRole("button", { name: "Larger Key Details headings" }).focus();
    await page.keyboard.press("Enter");
    await expect(kd).toContainText("115%");
    await expectAccessible(page, "Record with sized titles");

    // Saved for everyone: a client sees the sizes (and no buttons).
    await page.waitForTimeout(300);
    await signInAs(page, "client");
    await page.goto(`/tracker?${new URLSearchParams({ q: tag })}`);
    await page.getByRole("row", { name: new RegExp(`Sized ${tag}`) }).getByRole("button", { name: `Open record: Sized ${tag}` }).click();
    await expect(page.locator("#drawer-title .ts-text")).toHaveCSS("font-size", "26px");
    await expect(page.getByRole("dialog").getByTestId("ts-entry-title")).toHaveCount(0);
    expect(await page.evaluate(async () => (await fetch("/api/settings/text-size", { method: "PUT", headers: { "x-dev-user": "client@example.com", "content-type": "application/json" }, body: JSON.stringify({ key: "entry-title", size: 2 }) })).status)).toBe(403);

    // The Title box in the record editor is at the same size, with A− / A+ beside its label.
    await signInAs(page, "admin");
    await page.goto(`/tracker?${new URLSearchParams({ q: tag })}`);
    await page.getByRole("button", { name: `Edit Sized ${tag}` }).click();
    const input = page.getByRole("dialog").getByRole("textbox", { name: /^Title/ });
    await expect(input).toHaveValue(`Sized ${tag}`);
    expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(13 * 1.3, 0);
    await input.focus();
    const editSizes = page.getByRole("dialog").locator(".ts-label-row").getByTestId("ts-entry-title");
    await expect(editSizes.getByTestId("ts-smaller")).toBeVisible();
    await editSizes.getByRole("button", { name: "Smaller entry titles" }).click();
    await expect(editSizes).toContainText("115%");
    expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(13 * 1.15, 0);
    await page.keyboard.press("Escape");

    // The Inbox: its Title box and the item's title.
    await page.goto("/inbox");
    const inboxTitle = page.locator(".inbox-title .ts-text").first();
    await expect(inboxTitle).toBeVisible();
    expect(await px(page, ".inbox-title .ts-text")).toBeCloseTo(15.5 * 1.15, 0);

    // Section headings: the AI Summary heading on the Primary Tracker.
    await page.goto("/analytics/primary");
    const head = page.getByTestId("ai-summary").locator("#ai-summary-title");
    const base = await head.locator(".ts-text").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await head.hover();
    await page.getByTestId("ts-heading:ai-summary").getByRole("button", { name: "Larger AI Summary heading" }).click();
    await expect(page.getByTestId("ts-heading:ai-summary")).toContainText("115%");
    expect(await head.locator(".ts-text").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(base * 1.15, 0);
    await expect(page.getByRole("heading", { name: /^✦? ?AI Summary/ })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("ts-heading:ai-summary")).toContainText("115%");

    for (const k of ["entry-title", "heading:ai-summary", "label:key_details"]) await resetSize(page, k);
  });
});
