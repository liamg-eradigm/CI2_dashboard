import { expect, expectAccessible, goTab, menuOf, navLink, navOf, searchDatabase, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { toXlsxSheets } from "../packages/shared/src/export";

const ADMIN = { "x-dev-user": "admin@example.com" };
const BASE: Record<string, string> = {
  date: "2026-09-30",
  macrotrend: "Geopolitics",
  subtrend: "IRA Pricing/Tariffs",
  growth: "Stable",
  impact: "Low",
  source: "PR",
  competitors: "Roche",
  action: "Not Actioned",
};

/** The columns of a stream, key → label (the workbook's headers are the labels). */
async function labelsOf(page: Page, stream: "primary" | "secondary"): Promise<Record<string, string>> {
  return page.evaluate(
    async ({ stream, h }) => {
      const s = await (await fetch(`/api/schema?stream=${stream}`, { headers: h })).json();
      return Object.fromEntries((s.columns as { key: string; label: string }[]).map((c) => [c.key, c.label]));
    },
    { stream, h: ADMIN },
  );
}

/** A tracker sheet: header (labels of the keys used), then one row per entry. */
function trackerSheet(labels: Record<string, string>, rows: Record<string, string>[]): string[][] {
  const keys = [...new Set(["record_id", "title", ...Object.keys(BASE), ...rows.flatMap((r) => Object.keys(r))])].filter((k) => labels[k]);
  return [keys.map((k) => labels[k]!), ...rows.map((r) => keys.map((k) => r[k] ?? BASE[k] ?? ""))];
}

/** Sync the test space from this workbook (development only: instead of SharePoint). */
async function uploadWorkbook(page: Page, sheets: Record<string, string[][]>) {
  const bytes = Array.from(toXlsxSheets(Object.entries(sheets).map(([name, table]) => ({ name, table }))));
  return page.evaluate(
    async ({ bytes, h }) => {
      // A few rows per run (the Workers Free plan's limit): again until every change is in.
      let status;
      for (let i = 0; i < 10; i++) {
        const form = new FormData();
        form.append("file", new File([new Uint8Array(bytes)], "Power_Automate_Test.xlsx"));
        const res = await fetch("/api/excel/upload", { method: "POST", headers: h, body: form });
        if (!res.ok) throw new Error(await res.text());
        status = await res.json();
        if (!status.more) break;
      }
      return status;
    },
    { bytes, h: ADMIN },
  );
}

test.describe("request 55 (and 56)", () => {
  test("admins have a Test tab (Database, Megatrends); its pages are the test space", async ({ page, browser }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    expect(await menuOf(page)).toContain("Test: Database, Megatrends");
    await goTab(page, "Test", "Database");
    await expect(page).toHaveURL(/\/test\/database$/);
    await expect(navLink(page, "Test", "Database")).toHaveAttribute("aria-current", "page");
    await expect(navOf(page).getByRole("link", { name: "Database", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(/^Test · Database/);
    // The same page as the live one.
    await expect(page.getByRole("group", { name: "Database to show" }).getByRole("button")).toHaveText(["Primary Tracker", "Secondary Tracker", "CI Analysis", "Newsletter"]);
    // Request 56: no bar on the Test pages; here (no SharePoint secrets) a ! says the sync needs attention, and leads to Admin.
    await expect(page.getByTestId("test-bar")).toHaveCount(0);
    const alert = page.getByTestId("sync-alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAccessibleName(/not connected to the workbook: see Admin/);
    await expectAccessible(page, "Test → Database");
    // Back to the live pages.
    await navOf(page).getByRole("link", { name: "Database", exact: true }).click();
    await expect(page).toHaveURL(/\/database$/);
    await expect(page.getByTestId("sync-alert")).toHaveCount(0);

    // Not for analysts or clients.
    for (const who of ["analyst", "client"] as const) {
      const ctx = await browser.newContext();
      const other = await ctx.newPage();
      await signInAs(other, who);
      await other.goto("/dashboard");
      expect((await menuOf(other)).some((g) => g.startsWith("Test"))).toBe(false);
      await other.goto("/test/database");
      await expect(other).toHaveURL(/\/dashboard$/);
      await ctx.close();
    }
  });

  test("the Test pages show the workbook's rows, profiles and sections (the live pages do not); Admin lists the rows left out", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const [pl, sl] = [await labelsOf(page, "primary"), await labelsOf(page, "secondary")];
    const status = await uploadWorkbook(page, {
      Primary: trackerSheet(pl, [
        { record_id: `XP-${tag}-1`, title: `Excel KOL first ${tag}`, source_role: "Oncology KOL", source_company: `Clinic ${tag}`, date: "2026-09-30" },
        { record_id: `XP-${tag}-2`, title: `Excel KOL second ${tag}`, source_role: "Oncology KOL", source_company: `Clinic ${tag}`, date: "2026-09-30" },
      ]),
      Secondary: trackerSheet(sl, [
        { record_id: `XS-${tag}-1`, title: `Excel signal ${tag}`, key_details: "Opening line.\n- First point\n- Second point" },
        { record_id: `XS-${tag}-2`, title: `Excel bad row ${tag}`, impact: "Huge" },
      ]),
      "Competitor Trend Analysis": [
        ["Competitor", "Company Profile"],
        ["Roche", `Roche profile from Excel ${tag}`],
      ],
      "Macrotrend Analysis": [
        ["Macrotrend", "Macrotrend overview", "Why does it matter?"],
        ["Geopolitics", `Geopolitics overview from Excel ${tag}`, "It matters."],
      ],
    });
    expect(status.counts).toEqual({ primary: 2, secondary: 1, competitors: 1, macrotrends: 1 });

    // Admin → Test tab · SharePoint workbook: what it holds, and the row left out (and why).
    await page.goto("/admin");
    const card = page.getByTestId("excel-sync");
    await expect(card.getByTestId("test-bar-status")).toContainText("Holds 2 Primary, 1 Secondary, 1 Company Profile, 1 Macrotrend");
    await expect(card.getByTestId("test-issues")).toContainText("Secondary, row 3");
    await expect(card.getByTestId("test-issues")).toContainText("Huge");
    await expectAccessible(page, "Admin with the Test tab's workbook sync");

    // Database: the workbook's entry, its fields in full; not in the live Database.
    await page.goto("/test/database");
    await searchDatabase(page, tag);
    // (The search is saved in the address after a pause: wait for it before opening panes.)
    await expect(page).toHaveURL(/db\.q=/);
    const row = page.getByTestId("table-scroll").getByRole("row", { name: new RegExp(`Excel signal ${tag}`) });
    await expect(row).toBeVisible();
    await row.locator("td").nth(7).click();
    const pane = page.getByTestId("entry-fields");
    await expect(pane.getByTestId("ef-key_details").locator("li")).toHaveText(["First point", "Second point"]);
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    // Its Markdown is made from it.
    await row.getByRole("button", { name: new RegExp(`Open Markdown for Excel signal ${tag}`) }).click();
    await expect(page.getByRole("dialog").getByLabel("Markdown source")).toContainText(`Excel signal ${tag}`);
    await page.keyboard.press("Escape");
    // The ! leads to Admin's section.
    await page.getByTestId("sync-alert").click();
    await expect(page).toHaveURL(/\/admin#excel-sync$/);
    await expect(page.getByTestId("excel-sync")).toBeInViewport();
    await page.goto("/database");
    await searchDatabase(page, tag);
    await expect(page.getByTestId("table-scroll").getByRole("row", { name: new RegExp(`Excel signal ${tag}`) })).toHaveCount(0);

    // The Primary Tracker (Database → Primary Tracker, request 56): the two answers of one conversation (Full Discussion).
    await page.goto("/test/database?stream=primary");
    await expect(navLink(page, "Test", "Database")).toHaveAttribute("aria-current", "page");
    const first = page.getByRole("row", { name: new RegExp(`Excel KOL first ${tag}`) });
    await expect(first.getByRole("button", { name: /^Full Discussion:/ })).toBeVisible();
    // The old Test → Primary Tracker address leads there too.
    await page.goto("/test/analytics/primary");
    await expect(page).toHaveURL(/\/test\/database\?stream=primary$/);

    // Megatrends: the Macrotrend's sections and the competitor's Company Profile, from the workbook.
    await page.goto(`/test/analytics/megatrends?${new URLSearchParams({ m: "Geopolitics" })}`);
    await expect(navLink(page, "Test", "Megatrends")).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(`Geopolitics overview from Excel ${tag}`)).toBeVisible();
    await page.goto(`/test/analytics/competitors?${new URLSearchParams({ c: "Roche" })}`);
    await expect(page.getByText(`Roche profile from Excel ${tag}`)).toBeVisible();
    await page.goto(`/analytics/competitors?${new URLSearchParams({ c: "Roche" })}`);
    await expect(page.getByRole("heading", { name: "Roche" }).first()).toBeVisible();
    await expect(page.getByText(`Roche profile from Excel ${tag}`)).toHaveCount(0);
  });

  test("an open Test page follows the workbook by itself (checked every 10 seconds) and says “Data synced” for a moment", async ({ page }) => {
    test.setTimeout(90_000);
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const sl = await labelsOf(page, "secondary");
    const sheets = (title: string) => ({ Secondary: trackerSheet(sl, [{ record_id: `XA-${tag}`, title }]) });
    await uploadWorkbook(page, sheets(`Before ${tag}`));
    await page.goto("/test/database");
    const table = page.getByTestId("table-scroll");
    await expect(table.getByRole("row", { name: new RegExp(`Before ${tag}`) })).toBeVisible();
    // Let the page's first check go by, then change the workbook (here: uploaded, as SharePoint would have it).
    await page.waitForTimeout(1500);
    await uploadWorkbook(page, sheets(`After ${tag}`));
    // Within a check or two, without reloading: the change shows, with a small green note that goes by itself.
    const note = page.getByTestId("data-synced");
    await expect(note).toBeVisible({ timeout: 25_000 });
    await expect(note).toHaveText("✓ Data synced");
    expect(await note.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(29, 107, 61)");
    await expect(table.getByRole("row", { name: new RegExp(`After ${tag}`) })).toBeVisible();
    await expect(note).toHaveCount(0, { timeout: 6_000 });
  });

  test("Admin → Check connection runs the test endpoint: here (no SharePoint secrets) it says what to set", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/admin");
    const card = page.getByTestId("excel-sync");
    await card.getByTestId("test-check").click();
    const result = card.getByTestId("test-check-result");
    await expect(result).toContainText("Could not read the workbook");
    await expect(result).toContainText("Secrets");
    await expect(result).toContainText("What to do:");
    await expectAccessible(page, "Admin with the connection check");
  });
});
