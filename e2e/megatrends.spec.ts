import { expect, expectAccessible, signInAs, test, goTab, navOf, menuOf } from "./fixtures";

const R_AND_D = "AI Investment in R&D";

test.describe("Megatrends", () => {
  test("client: explores Macrotrends and Subtrends with their summaries, filters the timeline and opens an entry's row", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/dashboard");
    // Megatrends opens its two subtabs in the menu (request 27); the knowledge graph is the first.
    await goTab(page, "Megatrends", "Knowledge graph");
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

    // Keyboard: arrows move along the timeline, Enter opens; Esc goes back to the Subtrend's sources (request 26), then closes them.
    await page.getByTestId("mg-ball").first().focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/e=/);
    await expect(sheet.getByTestId("mg-sources")).toBeVisible();
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
  test("admin reorders and renames the menu's groups and tabs for everyone (request 28)", async ({ page, browser }) => {
    await signInAs(page, "admin");
    await page.goto("/admin");
    const card = page.getByTestId("tab-order");
    await expect(card.getByRole("heading", { name: "Menu" })).toBeVisible();
    const groups = () => navOf(page).locator(".nav-group > .nav-parent > span:first-child").allInnerTexts();
    await expect.poll(groups).toEqual(["Trackers", "Megatrends", "Competitors", "Inputs", "Admin"]);
    // Groups move; tabs move within their group.
    await card.getByRole("button", { name: "Move group Inputs up" }).click();
    await expect.poll(groups).toEqual(["Trackers", "Megatrends", "Inputs", "Competitors", "Admin"]);
    await card.getByTestId("menu-group-trackers").getByRole("button", { name: "Move tab Trackers: Phantoms up" }).click();
    await expect(page.locator(".toast").last()).toContainText("Moved");
    // Renamed: a group and a tab.
    await card.getByLabel("Name of the Inputs group").fill("Sources");
    await card.getByLabel("Name of the Inputs group").press("Enter");
    await expect(page.locator(".toast").last()).toContainText("Group renamed to “Sources”");
    await card.getByLabel("Name of the Trackers tab Phantoms").fill("Phantom files");
    await card.getByLabel("Name of the Trackers tab Phantoms").press("Tab");
    await expect(page.locator(".toast").last()).toContainText("Tab renamed to “Phantom files”");
    await expect(card.getByTestId("menu-item-phantoms")).toContainText("was Phantoms");
    await expectAccessible(page, "Administration with the menu editor");
    expect(await menuOf(page)).toEqual([
      "Trackers: Tracker, Phantom files, Dashboard, Trend Analyses",
      "Megatrends: Knowledge graph, Trend analysis",
      "Sources: Input, Eradigm Inbox, Client Inbox",
      "Competitors: Knowledge graph, Trend analysis",
      "Admin: Deliverables, Administration",
    ]);
    await goTab(page, "Trackers", "Phantom files");
    await expect(page).toHaveURL(/\/phantoms/);
    // A client sees the same order and names (without the staff tabs and the Admin group).
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await signInAs(other, "client");
    await other.goto("/dashboard");
    expect(await menuOf(other)).toEqual(["Trackers: Tracker, Phantom files, Dashboard, Trend Analyses", "Megatrends: Knowledge graph, Trend analysis", "Sources: Client Inbox", "Competitors: Knowledge graph, Trend analysis"]);
    await ctx.close();
    // Restore.
    await page.goto("/admin");
    await card.getByRole("button", { name: "Restore the usual menu" }).click();
    await expect.poll(groups).toEqual(["Trackers", "Megatrends", "Competitors", "Inputs", "Admin"]);
    await expect(card.getByLabel("Name of the Trackers tab Phantoms")).toHaveValue("");
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
