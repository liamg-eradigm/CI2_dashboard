import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { toXlsxSheets } from "../packages/shared/src/export";

const ADMIN = { "x-dev-user": "admin@example.com", "x-project": "epilepsy", "x-eci-request": "1" };
const NSO = ["NSO Focus", "NSO Activity", "Core Messaging", "Channels Used", "Imagery and Marketing", "Evidence", "Data Metric (Unit)", "x-axis name", "x1 name", "x1 value", "x2 name", "x2 value", "x3 name", "x3 value", "x4 name", "x4 value", "x5 name", "x5 value", "x6 name", "x6 value"];

/** UCB gives an NSO profile per asset (one per row); Xenon one for the company, in another metric; Neurona none. */
const SHEETS = [
  {
    name: "3. Platform Competitor Profiles",
    table: [
      ["Company/competitor", "HQ", "Epilepsy Assets", ...NSO],
      ["UCB", "Brussels", "Fintepla", "Cognition", "Phase 3 cognition sub-study", "Seizures are not the whole story", "KOL events; congress symposia", "Families at home", "Phase 3 sub-study, n=120", "Patients improved (%)", "Domain", "Attention", "42%", "Memory", "35%", "Mood", "28%", "", "", "", "", "", ""],
      ["", "", "Briviact", "Sleep", "Actigraphy in OLE", "Better nights", "Digital", "Calm bedrooms", "Actigraphy, OLE week 12", "Sleep efficiency (%)", "Visit", "Baseline", "71%", "Week 12", "80%", "", "", "", "", "", "", "", ""],
      ["Xenon", "Vancouver", "XEN1101", "Mood", "HAM-D in X-TOLE2", "Mood matters", "Payers", "Clinical", "X-TOLE2 secondary endpoint", "Change in HAM-D (points)", "", "Placebo", "-1.2", "25 mg", "-4.5", "", "", "", "", "", "", "", ""],
      ["Neurona", "San Diego", "NRTX-1001", ...NSO.map(() => "")],
    ],
  },
  { name: "4. Platform Trials & Assets", table: [["Company/competitor", "Asset Name", "Current Phase"], ["UCB", "Fintepla", "Approved"]] },
];

async function upload(page: Page) {
  await page.goto("/signin");
  const r = await page.evaluate(
    async ({ bytes, h }) => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(bytes)], "Epilepsy Dashboard Excel.xlsx"));
      return (await fetch("/api/epilepsy/upload", { method: "POST", headers: h, body: form })).json();
    },
    { bytes: Array.from(toXlsxSheets(SHEETS)), h: ADMIN },
  );
  expect(r).toMatchObject({ status: "idle", counts: { profiles: 4 } });
}

test.describe("request 68 and 69: NSO Comparator", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await upload(page);
  });

  test("a company opens its NSO card: five coloured rows with icons and its metric's chart; several sit side by side", async ({ page }) => {
    await page.goto("/p/epilepsy/news");
    await page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" }).getByRole("link", { name: "NSO Comparator" }).click();
    await expect(page).toHaveURL(/\/p\/epilepsy\/nso$/);
    await expect(page.getByRole("heading", { name: "NSO Comparator", level: 1 })).toBeVisible();
    const buttons = page.getByRole("group", { name: "Companies (pick one or more)" }).getByRole("button");
    await expect(buttons).toHaveText(["UCB", "Xenon", "Neurona"]);
    await expect(page.getByTestId("nso-card")).toHaveCount(0);

    await page.getByRole("button", { name: "UCB", exact: true }).click();
    const ucb = page.getByTestId("nso-card").filter({ hasText: "UCB" });
    await expect(ucb.locator(".nso-label")).toHaveText(["NSO Focus", "NSO Activity", "Core Messaging", "Channels Used", "Imagery and Marketing", "Evidence", "Patients improved (%)"]);
    // Request 69: Evidence just before the chart; the x-axis titled under the bars' names.
    await expect(ucb.locator(".nso-row").nth(5)).toContainText("Phase 3 sub-study, n=120");
    await expect(ucb.getByTestId("nso-x-axis")).toHaveText("Domain");
    await expect(ucb.locator(".nso-row").first()).toContainText("Cognition");
    // Each row its own colour: the icon strong, the row a light shade of it.
    const colours = await ucb.locator(".nso-row").evaluateAll((rows) => rows.map((r) => [getComputedStyle(r.querySelector(".nso-icon")!).backgroundColor, getComputedStyle(r).backgroundColor]));
    expect(new Set(colours.map((c) => c[0])).size).toBe(7);
    expect(new Set(colours.map((c) => c[1])).size).toBe(7);
    for (const [strong, light] of colours) expect(strong).not.toBe(light);
    await expect(ucb.getByRole("img", { name: "UCB: Patients improved (%): Domain: Attention 42%, Memory 35%, Mood 28%" })).toBeVisible();
    // A profile per asset (UCB's block of rows).
    await ucb.getByRole("button", { name: "Briviact" }).click();
    await expect(ucb.locator(".nso-row").first()).toContainText("Sleep");
    await expect(ucb.getByRole("img", { name: /Sleep efficiency \(%\): Visit: Baseline 71%, Week 12 80%/ })).toBeVisible();

    // Several: side by side, each chart on its own axis.
    await page.getByRole("button", { name: "Xenon", exact: true }).click();
    const cards = page.getByTestId("nso-card");
    await expect(cards).toHaveCount(2);
    // (Once the new card has finished popping in.)
    await cards.nth(1).evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished)));
    const [a, b] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(b.x).toBeGreaterThan(a.x + a.width);
    const xenon = cards.filter({ hasText: "Xenon" });
    await expect(xenon.getByRole("img", { name: "Xenon: Change in HAM-D (points): Placebo -1.2, 25 mg -4.5" })).toBeVisible();
    // No x-axis name given: no title under the bars.
    await expect(xenon.locator(".epi-axis-title")).toHaveText("Change in HAM-D (points)");
    await expect(xenon.getByTestId("nso-x-axis")).toHaveCount(0);
    await expect(ucb.locator(".epi-axis-title")).toHaveText(["Sleep efficiency (%)", "Visit"]);
    await expectAccessible(page, "NSO Comparator, two companies");

    // A company without NSO data says so; ✕ closes a card.
    await page.getByRole("button", { name: "Neurona", exact: true }).click();
    await expect(cards.filter({ hasText: "Neurona" })).toContainText("No NSO data for Neurona");
    await ucb.getByRole("button", { name: "Close UCB" }).click();
    await expect(cards).toHaveCount(2);
    await expect(page.getByRole("button", { name: "UCB", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  test("request 69: staff format the text (bold, size, bullet points) but cannot reword it", async ({ page, browser }) => {
    await page.goto("/p/epilepsy/nso?c=UCB");
    const card = page.getByTestId("nso-card");
    await card.getByTestId("nso-format").click();
    const focus = card.getByTestId("nso-edit-nso-focus");
    await expect(focus).toHaveText("Cognition");
    // Typing, pasting or deleting does nothing to the words.
    await focus.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" and more");
    await page.keyboard.press("Backspace");
    await expect(focus).toHaveText("Cognition");
    // Bold, larger and a bullet point.
    await focus.selectText();
    await page.getByTestId("fmt-bold").click();
    await page.getByTestId("fmt-larger").click();
    await page.getByTestId("fmt-bullets").click();
    await expect(focus.locator("li strong")).toHaveText("Cognition");
    await expectAccessible(page, "NSO Comparator, formatting the text");
    await card.getByTestId("nso-format-save").click();
    await expect(page.getByText("Formatting saved").first()).toBeVisible();
    const row = card.locator(".nso-row").first();
    await expect(row.locator("li strong")).toHaveText("Cognition");
    expect(await row.locator("li strong span, li span strong, li [style*='font-size']").count()).toBeGreaterThan(0);

    // Kept for everyone (here another person; clients cannot format: see the API test).
    const other = await browser.newPage();
    await signInAs(other, "analyst");
    await other.goto("/p/epilepsy/nso?c=UCB");
    await expect(other.getByTestId("nso-card").locator(".nso-row").first().locator("li strong")).toHaveText("Cognition");
    await other.close();

    // Back to the workbook's plain text.
    await card.getByTestId("nso-format").click();
    await card.getByRole("button", { name: "Back to the workbook's plain text" }).first().click();
    await card.getByTestId("nso-format-save").click();
    await expect(row.locator("strong")).toHaveCount(0);
    await expect(row).toContainText("Cognition");
  });

  test("Admin → Column names lists the NSO columns", async ({ page }) => {
    await page.goto("/p/epilepsy/admin");
    const card = page.getByTestId("epi-columns");
    for (const name of ["NSO Focus", "Evidence", "Data Metric (Unit)", "x-axis name", "x6 value"]) await expect(card.getByRole("row", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })).toContainText("NSO Comparator");
  });
});
