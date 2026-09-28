import path from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("analyst role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "analyst"));

  test("reviews an Inbox draft: validation, edit and approve", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    const card = page.locator(".inbox-card", { hasText: "AstraZeneca and Roche form pre-competitive AI alliance" });
    await card.getByRole("button", { name: "✓ Approve" }).click();
    await expect(card.getByText(/Validation failed\. Complete: .*Impact/)).toBeVisible();
    await card.getByRole("combobox", { name: "Impact", exact: true }).selectOption("High");
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
    await expect(page.getByRole("heading", { name: "Model output" })).toBeVisible();
    await expectAccessible(page, "/input with results");
    await page.getByRole("button", { name: "Review in Inbox →" }).click();
    await expect(page.locator(".inbox-card", { hasText: "Roche opens robotics-enabled" }).first()).toBeVisible();
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
