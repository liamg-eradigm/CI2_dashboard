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

test.describe("request 55", () => {
  test("admins have a Test tab (Database, Megatrends, Primary Tracker); its pages are the test space", async ({ page, browser }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    expect(await menuOf(page)).toContain("Test: Database, Megatrends, Primary Tracker");
    await goTab(page, "Test", "Database");
    await expect(page).toHaveURL(/\/test\/database$/);
    await expect(page.getByTestId("test-bar")).toBeVisible();
    await expect(navLink(page, "Test", "Database")).toHaveAttribute("aria-current", "page");
    await expect(navOf(page).getByRole("link", { name: "Database", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(/^Test · Database/);
    // The same page as the live one.
    await expect(page.getByRole("group", { name: "Database to show" }).getByRole("button")).toHaveText(["Primary Tracker", "Secondary Tracker", "CI Analysis", "Newsletter"]);
    await expectAccessible(page, "Test → Database");
    // Back to the live pages.
    await navOf(page).getByRole("link", { name: "Database", exact: true }).click();
    await expect(page).toHaveURL(/\/database$/);
    await expect(page.getByTestId("test-bar")).toHaveCount(0);

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

  test("the Test pages show the workbook's rows, profiles and sections, and list the rows left out; the live pages do not", async ({ page }) => {
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

    // Database: the workbook's entry, its fields in full; not in the live Database.
    await page.goto("/test/database");
    const bar = page.getByTestId("test-bar");
    await expect(bar.getByTestId("test-bar-status")).toContainText("2 Primary, 1 Secondary, 1 Company Profile, 1 Macrotrend");
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
    // The row left out, and why.
    await bar.getByTestId("test-bar-issues").click();
    await expect(bar.getByTestId("test-issues")).toContainText("Secondary, row 3");
    await expect(bar.getByTestId("test-issues")).toContainText("Huge");
    await expectAccessible(page, "Test → Database with the rows left out");
    await page.goto("/database");
    await searchDatabase(page, tag);
    await expect(page.getByTestId("table-scroll").getByRole("row", { name: new RegExp(`Excel signal ${tag}`) })).toHaveCount(0);

    // Primary Tracker: the two answers of one conversation (Full Discussion).
    await page.goto("/test/analytics/primary");
    await expect(navLink(page, "Test", "Primary Tracker")).toHaveAttribute("aria-current", "page");
    const first = page.getByRole("row", { name: new RegExp(`Excel KOL first ${tag}`) });
    await expect(first.getByRole("button", { name: /^Full Discussion:/ })).toBeVisible();

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

  test("Check connection runs the test endpoint: here (no SharePoint secrets) it says what to set", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/test/database");
    const bar = page.getByTestId("test-bar");
    await expect(bar.getByTestId("test-bar-status")).toContainText("Not connected: set SHAREPOINT_TENANT_ID");
    await bar.getByTestId("test-check").click();
    const result = bar.getByTestId("test-check-result");
    await expect(result).toContainText("Could not read the workbook");
    await expect(result).toContainText("Secrets");
    await expect(result).toContainText("What to do:");
    await expectAccessible(page, "Test bar with the connection check");
  });
});
