import path from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("analyst role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "analyst"));

  test("completes an empty Inbox draft from the saved page: validation, manual entry and approve", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    const card = page.locator(".inbox-card", { hasText: "AstraZeneca and Roche form pre-competitive AI alliance" });
    // Manual entry: every tracker field starts empty and no AI output is shown.
    await expect(card.getByText("Awaiting analyst entry")).toBeVisible();
    await expect(card.getByText(/LLM draft/)).toHaveCount(0);
    await expect(card.getByRole("textbox", { name: "News title", exact: true })).toHaveValue("");
    await expect(card.getByRole("combobox", { name: "Macrotrend", exact: true })).toHaveValue("");
    // The analyst opens the saved page to read the source.
    await expect(card.getByRole("link", { name: /Open saved page in new tab/ })).toHaveAttribute("href", /^\/source\/itm_/);
    await card.getByRole("button", { name: "View saved page" }).click();
    await expect(card.frameLocator("iframe.snapshot-frame").getByText("pool de-identified screening data")).toBeVisible();

    await card.getByRole("button", { name: "✓ Approve" }).click();
    await expect(card.getByText(/Validation failed\. Complete: Date, Competitor, Macrotrend, Subtrend, News title/)).toBeVisible();
    await card.getByLabel("Date", { exact: true }).fill("2026-09-24");
    await card.getByRole("textbox", { name: "Competitor", exact: true }).fill("AstraZeneca, Roche");
    await card.getByRole("combobox", { name: "Macrotrend", exact: true }).selectOption("AI Investment in R&D");
    await card.getByRole("combobox", { name: "Subtrend", exact: true }).selectOption("External Partnerships to Accelerate AI");
    await card.getByRole("textbox", { name: "News title", exact: true }).fill("AstraZeneca and Roche form pre-competitive AI alliance");
    await card.getByRole("combobox", { name: "Growth intensity", exact: true }).selectOption("Strong Increase");
    await card.getByRole("combobox", { name: "Impact", exact: true }).selectOption("High");
    await card.getByRole("combobox", { name: "Source", exact: true }).selectOption("PR");
    await card.getByRole("combobox", { name: "Action", exact: true }).selectOption("Not Actioned");
    await card.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker as rev 1/).first()).toBeVisible();
    await page.getByRole("button", { name: /Approved & rejected/ }).click();
    await expect(page.locator(".inbox-card", { hasText: "AstraZeneca and Roche form pre-competitive AI alliance" }).getByText(/Approved · SIG-/)).toBeVisible();
  });

  test("blocks unsafe URLs before anything is fetched", async ({ page }) => {
    await page.goto("/input");
    await page.getByRole("button", { name: "Metadata" }).click();
    await page.getByRole("button", { name: "Capture source" }).click();
    await expect(page.getByText("Stopped at step 2")).toBeVisible();
    await expect(page.locator(".step.failed", { hasText: "Destination check" })).toContainText("link-local / cloud metadata service");
    await page.getByRole("button", { name: "FTP" }).click();
    await page.getByRole("button", { name: "Capture source" }).click();
    await expect(page.getByText("Stopped at step 1")).toBeVisible();
    await expect(page.getByRole("table", { name: "Capture log" })).toContainText("ftp://files.example.com/a.html");
  });

  test("processes a SingleFile upload end-to-end into Needs review", async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
    const file = path.join(dir, "roche-lab.html");
    writeFileSync(
      file,
      `<!DOCTYPE html><html><!--\n Page saved with SingleFile \n url: https://newsroom.example.com/e2e-roche-lab-${Date.now()} \n saved date: Wed Sep 24 2026\n--><head><title>Roche opens robotics-enabled lab</title><meta property="article:published_time" content="2026-09-24"><script>alert(1)</script></head><body><article><h1>Roche opens robotics-enabled autonomous lab in Basel ${Date.now()}</h1><p>Roche has opened an autonomous laboratory where robotics-enabled labs run design-make-test cycles for small molecules around the clock.</p><p>The company said the lab will double experimental throughput for its early discovery teams by 2027.</p></article></body></html>`,
    );
    await page.goto("/input");
    await page.getByRole("button", { name: "HTML file" }).click();
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Process file" }).click();
    await expect(page.getByText("Complete · sent to Needs review")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".step", { hasText: "Content scan before storage" })).toContainText("script(s) stripped");
    await expect(page.locator(".step", { hasText: "Data policy check" })).toContainText("nothing sent to any external service");
    await expect(page.locator(".step", { hasText: "Routed to Needs review" })).toContainText("every tracker field empty");
    await expect(page.getByRole("heading", { name: "Model output" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sent to the Inbox" })).toBeVisible();
    await expectAccessible(page, "/input with results");
    await page.getByRole("button", { name: "Complete in Inbox →" }).click();
    const card = page.locator(".inbox-card", { hasText: "Roche opens robotics-enabled" }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText("Awaiting analyst entry")).toBeVisible();
  });

  test("opens the saved page full-window in a new tab", async ({ page, context }) => {
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto("/inbox");
    const card = page.locator(".inbox-card", { hasText: "Novartis opens AI academy" });
    const [tab] = await Promise.all([context.waitForEvent("page"), card.getByRole("link", { name: /Open saved page in new tab/ }).click()]);
    await tab.waitForLoadState();
    await expect(tab.getByRole("heading", { name: "Novartis opens AI academy with three-tier certification" })).toBeVisible();
    await expect(tab.frameLocator("iframe.snapshot-frame").getByText("foundation tier by the end of 2027")).toBeVisible();
    await expect(tab.getByRole("navigation")).toHaveCount(0);
    await expectAccessible(tab, "/source/:id");
    await tab.close();
  });

  test("edits dropdown options from the Inbox column editor", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Edit columns" }).click();
    const row = page.locator(".schema-grid", { has: page.getByLabel("Rename column Source") });
    await row.getByRole("button", { name: /options/ }).click();
    await page.getByLabel("New option").fill("Analyst Call");
    await page.getByRole("button", { name: "+ Add option" }).click();
    await expect(page.locator(".toast")).toContainText("Added “Analyst Call” to Source");
    await expect(page.getByRole("button", { name: "Chart field · locked" })).toHaveCount(0);
    await expect(page.getByText("Chart field · locked").first()).toBeVisible();
  });

  test("Inbox and Input pass automated accessibility checks", async ({ page }) => {
    for (const p of ["/inbox", "/input"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, p);
    }
  });
});
