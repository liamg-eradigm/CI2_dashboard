import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";
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

test.describe("request 61: projects", () => {
  test("the project's name is under the logo; the logo opens a menu of the person's projects", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    await expect(page.getByTestId("project-name")).toHaveText("CI SQUARED");
    const brand = page.getByTestId("brand");
    await brand.click();
    const menu = page.getByRole("menu", { name: "Projects" });
    await expect(menu.getByRole("menuitemradio")).toHaveText([/CI SQUARED\s*Admin/, /Epilepsy\s*Admin/]);
    await expect(menu.getByRole("menuitemradio", { name: /CI SQUARED/ })).toHaveAttribute("aria-checked", "true");
    await expectAccessible(page, "project menu");
    await menu.getByRole("menuitemradio", { name: /Epilepsy/ }).click();
    await expect(page).toHaveURL(/\/p\/epilepsy\/news$/);
    await expect(page.getByTestId("project-name")).toHaveText("Epilepsy");
    const nav = page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" });
    await expect(nav.getByRole("link")).toHaveText(["News", "Competitor Profiles", "NSO Comparator", "Asset Launches", "RCA", "Trial Tracker", "Admin"]);
    // Escape closes the menu.
    await page.getByTestId("brand").click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Projects" })).toHaveCount(0);
  });

  test("someone without access to a project never sees it", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/p/epilepsy/news");
    await expect(page).toHaveURL(/127\.0\.0\.1:5183\/(dashboard)?$/);
    await page.getByTestId("brand").click();
    await expect(page.getByRole("menu", { name: "Projects" }).getByRole("menuitemradio")).toHaveText([/CI SQUARED/]);
  });

  test("Admin is the same in every project, with a toggle to each project's settings", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/p/epilepsy/admin");
    await expect(page.getByTestId("projects-access")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Settings for Epilepsy" })).toBeVisible();
    await expect(page.getByTestId("epi-workbook")).toBeVisible();
    // CI SQUARED's own settings are not shown here.
    await expect(page.getByRole("heading", { name: "Competitor tiers" })).toHaveCount(0);
    const toggle = page.getByRole("group", { name: "Settings for project" });
    await expect(toggle.getByRole("link", { name: "Epilepsy" })).toHaveAttribute("aria-current", "true");
    await toggle.getByRole("link", { name: "CI SQUARED" }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:5183\/admin$/);
    await expect(page.getByRole("heading", { name: "Settings for CI SQUARED" })).toBeVisible();
    await expect(page.getByTestId("epi-workbook")).toHaveCount(0);
    // Rename a project, then name it back.
    const name = page.getByLabel("Name of Epilepsy");
    await name.fill("Epilepsy CI");
    await name.locator("xpath=ancestor::form").getByRole("button", { name: "Rename" }).click();
    await expect(page.getByLabel("Name of Epilepsy CI")).toBeVisible();
    await page.getByLabel("Name of Epilepsy CI").fill("Epilepsy");
    await page.getByLabel("Name of Epilepsy CI").locator("xpath=ancestor::form").getByRole("button", { name: "Rename" }).click();
    await expect(page.getByLabel("Name of Epilepsy", { exact: true })).toBeVisible();
    await expectAccessible(page, "/admin (projects and access)");
  });
});

test.describe("request 61: the Epilepsy project", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "admin");
    await uploadEpilepsy(page);
  });

  test("News: Primary with Full Discussion and KIQ Archive, Secondary, and a row's fields", async ({ page }) => {
    await page.goto("/p/epilepsy/news");
    const table = page.getByTestId("news-primary");
    await expect(table.locator("tbody tr")).toHaveCount(4);
    // Newest first.
    await expect(table.locator("tbody tr").first()).toContainText("1 Sep 2026");
    const row = table.locator("tbody tr", { hasText: "Pricing answer." });
    await row.getByRole("button", { name: /^Full Discussion/ }).click();
    const panel = page.getByTestId("archived-panel");
    await expect(panel.getByRole("heading", { name: "Full Discussion" })).toBeVisible();
    await expect(panel.locator("tbody tr")).toHaveCount(1);
    await expect(panel).toContainText("Pipeline answer, same conversation.");
    await row.getByRole("button", { name: /^KIQ Archive/ }).click();
    await expect(panel.getByRole("heading", { name: "KIQ Archive" })).toBeVisible();
    await expect(panel).toContainText("Earlier answer on pricing.");
    await expectAccessible(page, "Epilepsy News (Primary, KIQ Archive)");
    await table.getByRole("button", { name: "Open: 15 Aug 2026" }).click();
    const fields = page.getByTestId("news-panel");
    await expect(fields).toContainText("Clinic B");
    await expect(fields).toContainText("Access answer.");
    await page.keyboard.press("Escape");
    await page.getByTestId("stream-secondary").click();
    const sec = page.getByTestId("news-secondary");
    await expect(sec.locator("tbody tr")).toHaveCount(2);
    await expect(sec.getByRole("link", { name: "example.com/fintepla" })).toHaveAttribute("href", "https://example.com/fintepla");
  });

  test("Competitor Profiles: one company, then two compared", async ({ page }) => {
    await page.goto("/p/epilepsy/competitors");
    const ucb = page.getByRole("button", { name: "UCB", exact: true });
    await expect(ucb).toHaveAttribute("aria-pressed", "true");
    const head = page.getByTestId("profile-head");
    await expect(head).toHaveCount(1);
    await expect(head).toContainText("HQ");
    await expect(head).toContainText("Brussels, Belgium");
    await expect(head).toContainText("Headcount");
    await expect(head).toContainText("9,000");
    await expect(page.getByRole("img", { name: /market cap: UCB 30 bn/ })).toBeVisible();
    await expect(page.getByTestId("profile-assets").locator("tbody tr")).toHaveText([/UCB\s*Fintepla\s*5-HT release\s*Oral, BID\s*Approved/, /UCB\s*Briviact\s*SV2A\s*Oral, BID\s*Approved/]);
    await expect(page.getByTestId("on-market")).toContainText("Fintepla, Briviact");
    await page.getByRole("button", { name: "Xenon", exact: true }).click();
    await expect(head).toHaveCount(2);
    await expect(page.getByRole("img", { name: /combined: UCB 30 bn, Xenon 3 bn/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Epilepsy revenue \(USD\) by quarter in 2026 for UCB, Xenon/ })).toBeVisible();
    await expect(page.getByTestId("profile-assets").locator("tbody tr")).toHaveCount(3);
    await expect(page.getByTestId("on-market")).toContainText("Fintepla, Briviact");
    await expect(page.getByTestId("on-market")).not.toContainText("XEN1101");
    await expectAccessible(page, "Epilepsy Competitor Profiles");
  });

  test("Asset Launches: confirmed (FDA) and calculated dates, filtered by competitor", async ({ page }) => {
    await page.goto("/p/epilepsy/launches");
    const points = page.getByTestId("launch-point");
    await expect(points).toHaveCount(3);
    await expect(page.locator('[data-testid="launch-point"][data-confirmed="true"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="launch-point"][data-confirmed="false"]')).toContainText("XEN1101");
    const comp = page.getByTestId("filter-Competitor");
    await comp.click();
    await comp.fill("Xenon");
    await page.getByRole("listbox").getByRole("option", { name: "Xenon", exact: true }).click();
    await comp.press("Escape");
    await expect(points).toHaveCount(1);
    await expectAccessible(page, "Epilepsy Asset Launches");
  });

  test("RCA: a row opens every field in a half-screen panel", async ({ page }) => {
    await page.goto("/p/epilepsy/rca");
    const table = page.getByTestId("rca-table");
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await table.getByRole("button", { name: "Open: XEN1101" }).click();
    const panel = page.getByTestId("rca-panel");
    await expect(panel.locator(".epi-field")).toHaveCount(86);
    await expect(panel.locator(".epi-field").first()).toContainText("Company/competitor");
    await expect(panel.locator(".epi-field").last()).toContainText("Caregiver Sleep");
    const box = (await panel.boundingBox())!;
    expect(box.width).toBeGreaterThan(1440 * 0.45);
    expect(box.x + box.width).toBeGreaterThan(1430);
    await expectAccessible(page, "Epilepsy RCA panel");
  });

  test("Trial Tracker: a wide table, and a row's data viewer", async ({ page }) => {
    await page.goto("/p/epilepsy/trials");
    const wrap = page.getByTestId("trial-table");
    await expect(wrap.locator("tbody tr")).toHaveCount(3);
    // Wider than the page: it scrolls across inside its box (the scrollbar stays on screen).
    expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const box = (await wrap.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(1000 + 1);
    await wrap.getByRole("button", { name: "Open: UCB" }).first().click();
    const viewer = page.getByTestId("data-viewer");
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("img", { name: /-54% at week 6, -62% at week 14/ })).toBeVisible();
    await expectAccessible(page, "Epilepsy data viewer");
    await viewer.getByRole("button", { name: "✕ Close" }).click();
    await expect(viewer).toHaveCount(0);
  });
});

test.describe("request 61: CI SQUARED", () => {
  test("the signals list has a heading per month (request 70: on the Knowledge Graph page)", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto(`/megatrends?${new URLSearchParams({ m: "AI Investment in R&D", s: "Computational Infrastructure" })}`);
    const sources = page.getByTestId("mg-sources");
    await expect(sources.locator("li").first()).toBeVisible();
    const months = sources.getByTestId("signal-month");
    expect(await months.count()).toBeGreaterThan(0);
    await expect(months.first()).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
    // By Impact: no month headings.
    await page.getByTestId("mg-order-impact").click();
    await expect(months).toHaveCount(0);
  });

  test("an alert generated for a Database entry is reworded and saved in its viewer", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto("/database?stream=secondary");
    await page.getByRole("button", { name: /^Open the alert for / }).first().click();
    const pane = page.getByRole("dialog");
    await pane.getByTestId("alert-edit").click();
    const title = pane.locator("#alert-title");
    const tag = `Reworded ${Date.now()}`;
    await title.fill(tag);
    await pane.getByTestId("alert-save").click();
    await expect(pane.locator(".docx-host")).toContainText(tag, { timeout: 15_000 });
  });
});
