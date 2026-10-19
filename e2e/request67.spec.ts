import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { toXlsxSheets } from "../packages/shared/src/export";

/** The Epilepsy workbook's four sheets (a cover sheet too, as the real one has). */
const WORKBOOK: Record<string, string[][]> = {
  Cover: [["Epilepsy dashboard"]],
  "1. Platform Secondary": [
    ["Date of Newsletter", "Date of News Article", "Article Topic", "Article Title", "URL", "Key Details", "CI Perspective"],
    ["2026-10-01", "2026-09-28", "Regulatory", "FDA accepts Fintepla filing", "https://example.com/fintepla", "The FDA accepted the filing.", "Strengthens UCB's lead in DEE."],
    ["2026-10-01", "2026-09-20", "Pipeline", "Xenon readout due", "example.com/xenon", "Phase 3 data in Q4.", "Watch the tolerability."],
  ],
  "2. Platform Primary": [
    ["Event Date", "Source Role", "Source Company", "Source Location", "Source Confidence", "Employee Status", "Insight Topic", "KIQ", "Key Details"],
    ["2026-06-01", "Neurologist", "Hospital A", "UK", "High", "Current", "Pricing", "How is pricing set?", "Earlier answer on pricing."],
    ["2026-09-01", "Neurologist", "Hospital A", "UK", "High", "Current", "Pricing", "How is pricing set?", "Pricing answer."],
    ["2026-09-01", "Neurologist", "Hospital A", "UK", "High", "Current", "Pipeline", "What launches next?", "Pipeline answer, same conversation."],
    ["2026-08-15", "Pharmacist", "Clinic B", "US", "Medium", "Former", "Access", "Who pays?", "Access answer."],
  ],
  "3, Platform Competitor Profiles": [
    ["Competitor profiles"],
    ["Company/competitor", "Epilepsy Focus", "HQ", "Size", "Market Cap", "2025 Total Revenue", "2025 epilepsy revenue", "Q1 2026 Epilepsy Revenue", "Q2 2026 Epilepsy Revenue", "Q3 2026 Epilepsy Revenue", "Q4 2026 Epilepsy Revenue", "Q1 2026 Marketed Epilepsy Asset Growth", "Total Indication revenue", "Epilepsy Assets", "Recent Relevant Updates", "Number of Pipeline Assets", "Asset Name", "Pod (FFA/STAP)"],
    ["UCB", "DEE and focal", "Brussels, Belgium", "9,000", "$30B", "$6.5B", "$2.1B", "$540M", "$560M", "$580M", "$600M", "4%", "$2.4B", "Fintepla, Briviact", "Filing accepted", "5", "Fintepla", "FFA"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "Briviact", "STAP"],
    ["Xenon", "Focal seizures", "Vancouver, Canada", "300", "$3B", "$0.1B", "$0", "", "", "$10M", "$20M", "", "$0", "XEN1101", "Phase 3 readout", "2", "XEN1101", "STAP"],
  ],
  "4. Platform Trials & Assets": [
    ["Company/competitor", "Asset Name", "Study Name", "RoA", "RoA (+frequency)", "MoA", "Current Phase", "Current Trial Status", "FDA Approval Date", "Approval Date (calculated)", "NCT Number", "Epilepsy Indication/ Syndrome", "Study Duration", "Primary Endpoint Timeframes", "Change in Seizure Frequency from Baseline vs Placebo", "Caregiver Sleep"],
    ["UCB", "Fintepla", "FAIRE-Dravet", "Oral", "Oral, BID", "5-HT release", "Approved", "Completed", "2020-06-25", "", "NCT0001", "Dravet syndrome", "14 weeks", "14 weeks", "-54% at week 6; -62% at week 14", "Improved"],
    ["", "Briviact", "BRV-N01358", "Oral", "Oral, BID", "SV2A", "Approved", "Completed", "2016-02-18", "", "NCT0002", "Focal seizures", "12 weeks", "12 weeks", "-23%", ""],
    ["Xenon", "XEN1101", "X-TOLE2", "Oral", "Oral, QD", "Kv7 opener", "Phase 3", "Recruiting", "", "2028-06-30", "NCT0003", "Focal seizures", "12 weeks", "12 weeks", "-33% at week 12", ""],
  ],
};

const ADMIN = { "x-dev-user": "admin@example.com", "x-project": "epilepsy", "x-eci-request": "1" };

/** Read the Epilepsy workbook from this upload (development only: instead of SharePoint). */
async function uploadEpilepsy(page: Page) {
  await page.goto("/signin");
  const bytes = Array.from(toXlsxSheets(Object.entries(WORKBOOK).map(([name, table]) => ({ name, table }))));
  const status = await page.evaluate(
    async ({ bytes, h }) => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(bytes)], "Epilepsy Dashboard Excel.xlsx"));
      return (await fetch("/api/epilepsy/upload", { method: "POST", headers: h, body: form })).json();
    },
    { bytes, h: ADMIN },
  );
  expect(status).toMatchObject({ status: "idle", counts: { secondary: 2, primary: 4, profiles: 3, assets: 3 } });
}


async function settings(page: Page, json: unknown) {
  const r = await page.evaluate(async ({ json, h }) => (await fetch("/api/epilepsy/settings", { method: "PUT", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(json) })).status, { json, h: ADMIN });
  expect(r).toBe(200);
}

/** As CI SQUARED's Database: the table's card runs from the strip to the bottom of the window, the width of the page; only the table scrolls. */
async function expectBuiltIn(page: Page, card: Locator) {
  await page.waitForTimeout(300);
  const strip = (await page.locator(".epi-strip").boundingBox())!;
  const box = (await card.boundingBox())!;
  const main = (await page.locator("main").boundingBox())!;
  expect(Math.abs(box.y - (strip.y + strip.height))).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x - main.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x + box.width - (main.x + main.width))).toBeLessThanOrEqual(2);
  expect(Math.abs(page.viewportSize()!.height - (box.y + box.height))).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
}

test.describe("request 67: Epilepsy tables", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await uploadEpilepsy(page);
    await settings(page, { columnOrder: {} });
  });
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signInAs(page, "admin");
    await page.goto("/signin");
    await settings(page, { columnOrder: {} });
    await page.close();
  });

  test("Study Name is in the RCA and Trial Tracker tables (and the RCA panel)", async ({ page }) => {
    await page.goto("/p/epilepsy/rca");
    const rca = page.getByTestId("rca-table");
    await expect(rca.locator("thead th").nth(1)).toHaveText("Study Name");
    await expect(rca.locator("tbody tr", { hasText: "XEN1101" })).toContainText("X-TOLE2");
    await rca.getByRole("button", { name: "Open: XEN1101" }).click();
    const panel = page.getByTestId("rca-panel");
    await expect(panel).toContainText("Xenon · X-TOLE2 · NCT0003");
    await expect(panel.locator(".epi-field").nth(2)).toContainText("Study Name");
    await page.goto("/p/epilepsy/trials");
    const trials = page.getByTestId("trial-table");
    await expect(trials.locator("thead th").nth(2)).toHaveText("Study Name");
    await expect(trials.locator("tbody tr", { hasText: "Fintepla" })).toContainText("FAIRE-Dravet");
  });

  test("the tables are built into the page, as CI SQUARED's Database", async ({ page }) => {
    await page.goto("/p/epilepsy/rca");
    await expect(page.getByTestId("rca-table").locator("tbody tr")).toHaveCount(3);
    await expectBuiltIn(page, page.locator("section[aria-label='RCA']"));
    await expectAccessible(page, "Epilepsy RCA, built into the page");
    await page.goto("/p/epilepsy/trials");
    await expect(page.getByTestId("trial-table").locator("tbody tr")).toHaveCount(3);
    await expectBuiltIn(page, page.locator("section[aria-label='Trials']"));
    // Wider than the page: it scrolls across inside the table.
    expect(await page.getByTestId("trial-table").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.goto("/p/epilepsy/news");
    await expect(page.getByTestId("news-primary").locator("tbody tr")).toHaveCount(4);
    await expectBuiltIn(page, page.locator("section[aria-label='Primary news']"));
    await expectAccessible(page, "Epilepsy News, built into the page");
  });

  test("Admin → Table columns moves a table's columns (arrows or drag), and the page follows", async ({ page }) => {
    await page.goto("/p/epilepsy/admin");
    const card = page.getByTestId("epi-table-order");
    await expect(card.getByRole("button", { name: "RCA" })).toHaveAttribute("aria-pressed", "true");
    const list = card.getByTestId("epi-order-list");
    await expect(list.locator(".epi-order-name")).toHaveText(["Asset Name", "Study Name", "RoA (+frequency)", "MoA", "Current Phase", "Epilepsy Indication/ Syndrome", "Approval Date (calculated)", "FDA Approval Date", "NCT Number"]);
    await expectAccessible(page, "Admin → Table columns");
    await card.getByRole("button", { name: "Move Study Name up" }).click();
    await list.locator(".epi-order-item", { hasText: "NCT Number" }).dragTo(list.locator(".epi-order-item", { hasText: "Asset Name" }));
    await expect(list.locator(".epi-order-name")).toHaveText(["Study Name", "NCT Number", /^Asset Name/, "RoA (+frequency)", "MoA", "Current Phase", "Epilepsy Indication/ Syndrome", "Approval Date (calculated)", "FDA Approval Date"]);
    // Trial Tracker: its own order.
    await card.getByRole("button", { name: "Trial Tracker" }).click();
    await card.getByRole("button", { name: "Move Company/competitor down" }).click();
    await card.getByTestId("epi-order-save").click();
    await expect(page.getByText("Column order saved").first()).toBeVisible();

    await page.goto("/p/epilepsy/rca");
    await expect(page.getByTestId("rca-table").locator("thead th")).toHaveText(["Study Name", "NCT Number", /^Asset Name/, "RoA (+frequency)", "MoA", "Current Phase", "Epilepsy Indication/ Syndrome", "Approval Date (calculated)", "FDA Approval Date"]);
    // The first column still opens the row.
    await page.getByTestId("rca-table").getByRole("button", { name: "Open: X-TOLE2" }).click();
    await expect(page.getByTestId("rca-panel")).toBeVisible();
    await page.goto("/p/epilepsy/trials");
    await expect(page.getByTestId("trial-table").locator("thead th").first()).toHaveText("Asset Name");
    await expect(page.getByTestId("trial-table").locator("thead th").nth(1)).toHaveText(/^Company\/competitor/);

    // Reset puts the default order back.
    await page.goto("/p/epilepsy/admin");
    await card.getByRole("button", { name: "Reset to the default order" }).click();
    await card.getByTestId("epi-order-save").click();
    await page.goto("/p/epilepsy/rca");
    await expect(page.getByTestId("rca-table").locator("thead th").first()).toHaveText(/^Asset Name/);
    await page.goto("/p/epilepsy/trials");
    await expect(page.getByTestId("trial-table").locator("thead th").first()).toHaveText("Asset Name");
  });
});
