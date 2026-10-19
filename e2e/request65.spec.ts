import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { toXlsxSheets } from "../packages/shared/src/export";

const ADMIN = { "x-dev-user": "admin@example.com", "x-project": "epilepsy", "x-eci-request": "1" };

/**
 * The workbook in US dollars: its market cap column is called “Market
 * Capitalisation” (so the pages do not find it by name), its revenue columns
 * carry “(USD)” and “(USD m)”, and sheet 4's Current Phase is a dropdown.
 */
const SHEETS = [
  {
    name: "3. Platform Competitor Profiles",
    table: [
      ["Company/competitor", "HQ", "Size", "Market Capitalisation", "2025 Total Revenue (USD)", "Q1 2026 Epilepsy Revenue (USD m)", "Epilepsy Assets"],
      ["UCB", "Brussels, Belgium", "9,000", "30,000,000,000", "6500000000", "540", "Fintepla"],
      ["Xenon", "Vancouver, Canada", "300", "$3B", "", "10", "XEN1101"],
    ],
  },
  {
    name: "4. Platform Trials & Assets",
    table: [
      ["Company/competitor", "Asset Name", "MoA", "RoA (+frequency)", "Current Phase", "NCT Number"],
      ["UCB", "Fintepla", "5-HT release", "Oral, BID", "Approved", "NCT1"],
      ["Xenon", "XEN1101", "Kv7 opener", "Oral, QD", "Pre-clinical", "NCT3"],
    ],
    lists: [{ sqref: "E2:E1000", formula: "Lists!$A$1:$A$4" }],
  },
  { name: "Lists", table: [["Phase 1"], ["Phase 2"], ["Phase 3"], ["Approved"]] },
];

async function api(page: Page, path: string, init: { method: string; json?: unknown; file?: number[] }) {
  return page.evaluate(
    async ({ path, init, h }) => {
      let body: BodyInit | undefined;
      const headers: Record<string, string> = { ...h };
      if (init.file) {
        const form = new FormData();
        form.append("file", new File([new Uint8Array(init.file)], "Epilepsy Dashboard Excel.xlsx"));
        body = form;
      } else if (init.json !== undefined) {
        body = JSON.stringify(init.json);
        headers["content-type"] = "application/json";
      }
      const res = await fetch(path, { method: init.method, headers, body });
      return { status: res.status, body: await res.json() };
    },
    { path, init, h: ADMIN },
  );
}

test.describe("request 65: Epilepsy money in USD, column names and dropdown options", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/signin");
    expect((await api(page, "/api/epilepsy/settings", { method: "PUT", json: { columnNames: {}, addedOptions: {} } })).status).toBe(200);
    const up = await api(page, "/api/epilepsy/upload", { method: "POST", file: Array.from(toXlsxSheets(SHEETS)) });
    expect(up.body).toMatchObject({ status: "idle", counts: { profiles: 2, assets: 2 } });
  });
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signInAs(page, "admin");
    await page.goto("/signin");
    await api(page, "/api/epilepsy/settings", { method: "PUT", json: { columnNames: {}, addedOptions: {} } });
    await page.close();
  });

  test("money says (USD) and is abbreviated; a column with another name is picked in Admin → Column names", async ({ page }) => {
    await page.goto("/p/epilepsy/competitors");
    const head = page.getByTestId("profile-head");
    await expect(head.locator("dt", { hasText: "2025 Total Revenue (USD)" }).locator("+ dd")).toHaveText("6.5 bn");
    await expect(page.getByRole("heading", { name: "Market cap (USD)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Epilepsy revenue by quarter, 2026 (USD)" })).toBeVisible();
    // “Market Capitalisation” is not “Market Cap”: not found by its name.
    await expect(page.getByText("No market cap given for this company.")).toBeVisible();

    await page.goto("/p/epilepsy/admin");
    const card = page.getByTestId("epi-columns");
    await expect(card.getByRole("button", { name: "3. Platform Competitor Profiles" })).toHaveAttribute("aria-pressed", "true");
    const row = card.getByRole("row", { name: /Market Cap \(USD\)/ });
    await expect(row).toContainText("Not found");
    await expect(card.getByRole("row", { name: /2025 Total Revenue \(USD\)/ }).getByRole("combobox")).toContainText("Found by its name: “2025 Total Revenue (USD)”");
    await expect(card).toContainText("Other columns in this sheet (not read by the pages): Market Capitalisation");
    await expectAccessible(page, "Admin → Column names");
    await row.getByRole("combobox", { name: "Workbook column for Market Cap" }).selectOption("Market Capitalisation");
    await expect(row).toContainText("30,000,000,000");
    await expect(row).toContainText("reads as 30 bn (USD)");
    await card.getByTestId("epi-columns-save").click();
    await expect(page.getByText("Column names saved").first()).toBeVisible();

    await page.goto("/p/epilepsy/competitors");
    await expect(page.getByRole("img", { name: /market cap: UCB 30 bn/ })).toBeVisible();
    await expect(head.locator("dt", { hasText: "Market Cap (USD)" }).locator("+ dd")).toHaveText("30 bn");
    await page.getByRole("button", { name: "Xenon", exact: true }).click();
    await expect(page.getByRole("img", { name: /combined: UCB 30 bn, Xenon 3 bn/ })).toBeVisible();
    await expectAccessible(page, "Competitor Profiles in USD");
  });

  test("dropdown columns list their options; options added in Admin are accepted by the platform", async ({ page }) => {
    await page.goto("/p/epilepsy/admin");
    const card = page.getByTestId("epi-columns");
    await card.getByRole("button", { name: "4. Platform Trials & Assets" }).click();
    const dd = card.getByTestId("epi-dropdown").filter({ hasText: "Current Phase" });
    await expect(dd.getByRole("list", { name: "Options of Current Phase" }).getByRole("listitem")).toHaveText(["Phase 1", "Phase 2", "Phase 3", "Approved"]);
    // A value the sheet uses that is not an option: one click accepts it.
    await expect(dd).toContainText("In the sheet but not an option:");
    await dd.getByRole("button", { name: "Add Pre-clinical as an option of Current Phase" }).click();
    await expect(page.getByText("“Pre-clinical” added to Current Phase").first()).toBeVisible();
    await dd.getByLabel("New option for Current Phase").fill("Phase 4");
    await dd.getByRole("button", { name: "+ Add option" }).click();
    await expect(dd.getByRole("listitem")).toHaveText(["Phase 1", "Phase 2", "Phase 3", "Approved", /Pre-clinical/, /Phase 4/]);
    await expect(dd).not.toContainText("In the sheet but not an option:");
    await expectAccessible(page, "Admin → dropdown options");

    // The RCA filter offers the accepted options (Phase 4 is in no row yet).
    await page.goto("/p/epilepsy/rca");
    await page.getByTestId("filter-Current Phase").click();
    await expect(page.getByRole("listbox").getByRole("option", { name: "Phase 4", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // Removed again.
    await page.goto("/p/epilepsy/admin");
    await card.getByRole("button", { name: "4. Platform Trials & Assets" }).click();
    await dd.getByRole("button", { name: "Remove the option Phase 4 from Current Phase" }).click();
    await expect(dd.getByRole("listitem")).toHaveCount(5);
  });
});
