import { expect, expectAccessible, signInAs, test } from "./fixtures";

const R_AND_D = "AI Investment in R&D";

test.describe("Megatrends", () => {
  test("client: explores Macrotrends and Subtrends with their summaries, filters the timeline and opens an entry's row", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/dashboard");
    await page.getByRole("navigation").getByRole("link", { name: "Megatrends" }).click();
    await expect(page.getByTestId("mg-panel")).toBeVisible();
    const rail = page.getByTestId("mg-macros");
    // Only Macrotrends with entries are listed, with their counts.
    await expect(rail.getByRole("button", { name: new RegExp(`^${R_AND_D.replace(/[()&]/g, "\\$&")}\\s*\\d+$`) })).toBeVisible();
    const total = await page.getByTestId("mg-ball").count();
    expect(total).toBeGreaterThan(5);
    await expect(page.getByTestId("mg-timeline")).toContainText(`${total} entries · coloured by Macrotrend`);
    await expectAccessible(page, "Megatrends");

    // Select a Macrotrend: its summary, its Subtrends, and only its entries on the timeline.
    await rail.getByRole("button", { name: new RegExp(`^${R_AND_D}`) }).click();
    await expect(page).toHaveURL(/m=AI\+Investment/);
    const panel = page.getByTestId("mg-panel");
    await expect(panel.getByRole("heading", { name: R_AND_D })).toBeVisible();
    await expect(panel.getByTestId("mg-summary")).toContainText("Competitors are investing in R&D compute and data partnerships (BMS–NVIDIA, Regeneron–TriNetX)");
    await expect(panel).toContainText("Summary provided with the dashboard");
    // Clients read summaries but cannot edit them.
    await expect(panel.getByRole("button", { name: "Edit summary" })).toHaveCount(0);
    const inMacro = await page.getByTestId("mg-ball").count();
    expect(inMacro).toBeLessThan(total);
    await expect(page.getByTestId("mg-timeline")).toContainText(`in ${R_AND_D} · coloured by Subtrend`);

    // Then a Subtrend (from the timeline legend).
    await page.getByRole("list", { name: "Legend" }).getByRole("button", { name: /Computational Infrastructure/ }).click();
    await expect(panel.getByRole("heading", { name: "Computational Infrastructure" })).toBeVisible();
    await expect(panel.getByTestId("mg-summary")).toContainText('BMS\'s NVIDIA "AI factory" scales proprietary models');
    const inSub = await page.getByTestId("mg-ball").count();
    expect(inSub).toBeLessThanOrEqual(inMacro);

    // Hover shows the title; click slides the row in from the right (request 23), and ✕ slides it away.
    const ball = page.getByTestId("mg-ball").first();
    await ball.hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    const tlBefore = (await page.getByTestId("mg-timeline").boundingBox())!;
    await ball.click();
    const sheet = page.getByTestId("mg-sheet");
    await expect(sheet).toHaveClass(/open/);
    await expect(page).toHaveURL(/\/megatrends\?.*e=/);
    await expect(sheet.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(sheet.getByText("Subtrend", { exact: true })).toBeVisible();
    await expect(sheet.locator("dd", { hasText: "Computational Infrastructure" })).toBeVisible();
    await page.waitForTimeout(600);
    const box = (await sheet.boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(vw - (box.x + box.width)).toBeLessThan(40);
    expect(box.height).toBeGreaterThan(page.viewportSize()!.height * 0.8);
    // The timeline stays where it was.
    expect(Math.abs((await page.getByTestId("mg-timeline").boundingBox())!.y - tlBefore.y)).toBeLessThan(2);
    await expectAccessible(page, "Megatrends with an entry open");
    await sheet.getByRole("button", { name: "Close entry" }).click();
    await expect(sheet).not.toHaveClass(/open/);
    await expect(page).not.toHaveURL(/e=/);

    // Keyboard: arrows move along the timeline, Enter opens, Esc closes.
    await page.getByTestId("mg-ball").first().focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(sheet).not.toHaveClass(/open/);

    // Back to all Macrotrends.
    await page.getByRole("navigation", { name: "Graph level" }).getByRole("button", { name: "All macrotrends" }).click();
    await expect(page.getByTestId("mg-ball")).toHaveCount(total);
    // No tracker or period filters: the page shows both trackers and every date.
    await expect(page.getByRole("group", { name: "Tracker" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Event Date period" })).toHaveCount(0);
  });

  test("analyst: writes a summary by hand and resets it; AI is off until the API is connected", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto(`/megatrends?m=${encodeURIComponent("Geopolitics")}`);
    const panel = page.getByTestId("mg-panel");
    await expect(panel.getByRole("heading", { name: "Geopolitics" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "✦ Write with AI" })).toBeDisabled();
    await panel.getByRole("button", { name: "Edit summary" }).click();
    await panel.getByLabel("Summary of Geopolitics").fill("MFN pricing keeps spreading.");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByTestId("mg-summary")).toHaveText("MFN pricing keeps spreading.");
    await expect(panel).toContainText("Written by L. Griffith");
    await panel.getByRole("button", { name: "Edit summary" }).click();
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(panel.getByTestId("mg-summary")).toContainText("The most-favored-nation (MFN) pricing framework is expanding");
  });
});

test.describe("tab order", () => {
  test("admin reorders the tabs for everyone", async ({ page, browser }) => {
    await signInAs(page, "admin");
    await page.goto("/admin");
    const card = page.getByTestId("tab-order");
    await expect(card.getByRole("button", { name: /Sort Tabs/ })).toHaveCount(0);
    await card.getByRole("button", { name: "Move tab Megatrends up" }).click();
    await expect(card.getByTestId("tab-megatrends")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" });
    const labels = () => nav.getByRole("link").allInnerTexts();
    await expect.poll(async () => (await labels()).map((t) => t.replace(/\d+$/, "").trim()).slice(3, 5)).toEqual(["Megatrends", "Deliverables"]);
    // A client sees the same order (without the staff tabs).
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await signInAs(other, "client");
    await other.goto("/dashboard");
    await expect.poll(async () => (await other.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" }).getByRole("link").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim())).toEqual(["Dashboard", "Tracker", "Phantoms", "Megatrends", "Competitors", "Client Inbox"]);
    await ctx.close();
    // Restore.
    await card.getByRole("button", { name: "Move tab Megatrends down" }).click();
    await expect.poll(async () => (await labels()).map((t) => t.replace(/\d+$/, "").trim()).slice(3, 5)).toEqual(["Deliverables", "Megatrends"]);
    await expectAccessible(page, "Administration with tab order");
  });

  test("admin sets how AI summaries are written", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/admin");
    const fs = page.getByTestId("megatrends-settings");
    await fs.getByLabel("Time frame: entries from the last (days)").fill("60");
    await fs.getByLabel("Summary length (at most, sentences)").fill("3");
    await fs.getByLabel("Claude model").selectOption("claude-sonnet-5-5");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeAttached();
    const s = await page.evaluate(async () => (await fetch("/api/settings", { headers: { "x-dev-user": "admin@example.com" } })).json());
    expect(s.megatrends).toMatchObject({ summaryDays: 60, summarySentences: 3, model: "claude-sonnet-5-5" });
    await page.evaluate(() =>
      fetch("/api/settings", { method: "PATCH", headers: { "x-dev-user": "admin@example.com", "content-type": "application/json" }, body: JSON.stringify({ megatrends: { summaryDays: 90, summarySentences: 2, model: "claude-opus-5-5" } }) }),
    );
  });
});
