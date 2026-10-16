import { choose, expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { titleDocx } from "../packages/shared/src/docx";

const docx = (name: string, text: string) => ({ name, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(titleDocx(text)) });

/** The table fills the page below the Database's tables strip, as the other tables do. */
async function expectFills(page: Page, card: Locator) {
  await page.waitForTimeout(300);
  const strip = (await page.getByTestId("db-tabs").boundingBox())!;
  const box = (await card.boundingBox())!;
  expect(Math.abs(box.y - (strip.y + strip.height))).toBeLessThanOrEqual(2);
  expect(Math.abs(page.viewportSize()!.height - (box.y + box.height))).toBeLessThanOrEqual(2);
}

test.describe("request 64", () => {
  test("Input → Earnings Call: attach the report and view it, fill in the fields, submit; Database → Earnings Calls lists it with its report and Markdown", async ({ page }) => {
    const tag = `E2E ${Date.now().toString(36)}`;
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/input");
    const card = page.getByTestId("earnings-call-input");
    await expect(card.getByRole("heading", { name: "Input Earnings Call" })).toBeVisible();
    await expect(card.getByTestId("ec-view")).toBeDisabled();

    // Only Word documents.
    await card.locator('input[type="file"]').setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
    await expect(card.getByRole("alert")).toHaveText("Only Word documents (.docx) are accepted.");

    // Attach the report and open it in the side pane before submitting.
    await card.locator('input[type="file"]').setInputFiles(docx("J&J Q3 2024 call.docx", `Report ${tag}`));
    await expect(card.getByTestId("drop-zone-earnings")).toContainText("J&J Q3 2024 call.docx");
    await card.getByTestId("ec-view").click();
    const pane = page.getByRole("dialog");
    await expect(pane.locator(".docx-host")).toContainText(`Report ${tag}`);
    await expect(pane).toContainText("not yet submitted");
    await expectAccessible(page, "Input → Earnings Call, report open");
    await pane.getByRole("button", { name: "Close document" }).click();
    await expect(pane).toHaveCount(0);

    // Quarter and Competitor are needed.
    await card.getByTestId("ec-submit").click();
    await expect(card.getByRole("alert")).toHaveText("Fill in the Quarter and choose the Competitor.");
    await expect(card.getByTestId("ec-quarter")).toHaveAttribute("aria-invalid", "true");

    // One text box per column (not Report or Markdown).
    const labels = await card.locator(".field > span:first-child").allTextContents();
    expect(labels).toEqual([
      "Quarter *",
      "Competitor *",
      "Main Tagline",
      "Patent Expiry / LOE Response",
      "AI & Automation Tools",
      "Direct-to-Patient Strategy",
      "IRA Pricing / Tariffs",
      "Strategic Investment & Redeployment",
      "Observed Trends",
    ]);
    // Request 64b: the competitor comes from the Secondary Tracker's Competitors dropdown, with the same options.
    const secondary = await (await page.request.get("/api/schema?stream=secondary", { headers: { "x-dev-user": "admin@example.com" } })).json();
    const options: string[] = secondary.columns.find((c: { key: string }) => c.key === "competitors").options;
    await card.getByTestId("ec-competitor").click();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText(options);
    await page.keyboard.press("Escape");
    await card.getByTestId("ec-quarter").fill(`Q3 2024 ${tag}`);
    await choose(card.getByTestId("ec-competitor"), "Roche");
    await card.getByTestId("ec-tagline").fill("Growth despite Stelara LOE");
    await card.getByTestId("ec-loe").fill("Biosimilar erosion offset by Tremfya.");
    await card.getByTestId("ec-trends").fill("More direct-to-patient.\nFewer tariffs worries.");
    await expectAccessible(page, "Input → Earnings Call, filled in");
    await card.getByTestId("ec-submit").click();
    await expect(card.getByTestId("ec-saved")).toContainText(`Saved the earnings call Roche Q3 2024 ${tag}`);
    await expect(card.getByTestId("ec-competitor")).toHaveValue("");
    await expect(card.getByTestId("drop-zone-earnings")).toContainText("Drag and drop the report");

    // Database → Earnings Calls.
    await card.getByRole("link", { name: "Database · Earnings Calls →" }).click();
    await expect(page).toHaveURL(/\/database\?db=earnings/);
    await expect(page.getByTestId("db-earnings")).toHaveAttribute("aria-pressed", "true");
    const table = page.getByTestId("earnings-calls-table");
    await expect(table.locator("thead th")).toHaveText([
      "Report",
      "Markdown",
      "Quarter",
      "Competitor",
      "Main Tagline",
      "Patent Expiry / LOE Response",
      "AI & Automation Tools",
      "Direct-to-Patient Strategy",
      "IRA Pricing / Tariffs",
      "Strategic Investment & Redeployment",
      "Observed Trends",
      "Submitted",
      "Remove",
    ]);
    const row = table.locator("tbody tr", { hasText: tag });
    await expect(row).toContainText("Growth despite Stelara LOE");
    await expect(row).toContainText("Biosimilar erosion offset by Tremfya.");
    await expectFills(page, page.locator("section[aria-labelledby='ec-list-title']"));
    await expectAccessible(page, "Database → Earnings Calls");

    // The report, in the same side pane.
    await row.getByRole("button", { name: `Open the report of the earnings call Roche Q3 2024 ${tag}` }).click();
    await expect(page).toHaveURL(/docx=/);
    await expect(page.getByRole("dialog").locator(".docx-host")).toContainText(`Report ${tag}`);
    await expect(page.getByRole("dialog")).toContainText("J&J Q3 2024 call.docx");
    await page.getByRole("dialog").getByRole("button", { name: "Close document" }).click();

    // The Markdown: each column's name, its text below, an empty line between.
    await row.getByRole("button", { name: `Open the Markdown of the earnings call Roche Q3 2024 ${tag}` }).click();
    const md = page.getByTestId("earnings-call-md");
    await expect(md.locator("pre.md-raw")).toHaveText(
      [
        `Quarter\nQ3 2024 ${tag}`,
        "Competitor\nRoche",
        "Main Tagline\nGrowth despite Stelara LOE",
        "Patent Expiry / LOE Response\nBiosimilar erosion offset by Tremfya.",
        "AI & Automation Tools\n",
        "Direct-to-Patient Strategy\n",
        "IRA Pricing / Tariffs\n",
        "Strategic Investment & Redeployment\n",
        "Observed Trends\nMore direct-to-patient.\nFewer tariffs worries.",
      ].join("\n\n") + "\n",
    );
    await expectAccessible(page, "Database → Earnings Calls, Markdown open");
    const download = page.waitForEvent("download");
    await md.getByRole("button", { name: "Download Markdown" }).click();
    expect((await download).suggestedFilename()).toBe(`Roche Q3 2024 ${tag}.md`);
    await md.getByRole("button", { name: "Close Markdown" }).click();

    // Removed (analysts and admins).
    page.once("dialog", (d) => void d.accept());
    await row.getByRole("button", { name: `Remove the earnings call Roche Q3 2024 ${tag}` }).click();
    await expect(table.locator("tbody tr", { hasText: tag })).toHaveCount(0);
  });

  test("a client sees Database → Earnings Calls without the remove buttons, and has no Input page", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/database?db=earnings");
    await expect(page.getByTestId("earnings-calls-table")).toBeVisible();
    await expect(page.getByTestId("earnings-calls-table").locator("thead th")).toHaveCount(12);
    await expect(page.getByRole("link", { name: "+ Input an earnings call" })).toHaveCount(0);
  });
});
