import { expect, expectAccessible, signInAs, test, goTab, navOf, menuOf } from "./fixtures";

const R_AND_D = "AI Investment in R&D";

test.describe("Megatrends", () => {
  test("client: explores Macrotrends and Subtrends, filters the timeline and opens an entry's row", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/dashboard");
    // Analytics → Knowledge Graph (request 31) opens on Megatrends; no left-hand menus (request 34).
    await goTab(page, "Analytics", "Knowledge Graph");
    await expect(page.locator(".mg-stage")).toBeVisible();
    await expect(page.locator(".mg-panel, .mg-rail")).toHaveCount(0);
    const legend = page.getByRole("list", { name: "Legend" });
    // Only Macrotrends with entries are listed, with their counts.
    await expect(legend.getByRole("button", { name: new RegExp(`^${R_AND_D.replace(/[()&]/g, "\\$&")}\\s*\\d+$`) })).toBeVisible();
    const total = await page.getByTestId("mg-ball").count();
    expect(total).toBeGreaterThan(5);
    await expect(page.getByTestId("mg-timeline")).toContainText(`${total} entries · coloured by Macrotrend`);
    await expectAccessible(page, "Megatrends");

    // Select a Macrotrend: its Subtrends, and only its entries on the timeline.
    await page.goto(`/megatrends?${new URLSearchParams({ m: R_AND_D })}`);
    const crumbs = page.getByRole("navigation", { name: "Graph level" });
    await expect(crumbs.getByRole("button", { name: R_AND_D })).toBeVisible();
    const inMacro = await page.getByTestId("mg-ball").count();
    expect(inMacro).toBeLessThan(total);
    await expect(page.getByTestId("mg-timeline")).toContainText(`in ${R_AND_D} · coloured by Subtrend`);

    // Then a Subtrend (from the timeline legend): its sources take half the page.
    await legend.getByRole("button", { name: /Computational Infrastructure/ }).click();
    await expect(crumbs).toContainText("Computational Infrastructure");
    const sheet = page.getByTestId("mg-sheet");
    await expect(sheet.getByTestId("mg-sources")).toBeVisible();
    const inSub = await page.getByTestId("mg-ball").count();
    expect(inSub).toBeLessThanOrEqual(inMacro);
    await sheet.getByRole("button", { name: "Close the signals list" }).click();
    await expect(sheet).not.toHaveClass(/open/);

    // Hover shows the title; click slides the row in from the right (request 23), and ✕ slides it away.
    const ball = page.getByTestId("mg-ball").first();
    await ball.hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    const tlBefore = (await page.getByTestId("mg-timeline").boundingBox())!;
    await ball.click();
    await expect(sheet).toHaveClass(/open/);
    await expect(page).toHaveURL(/\/megatrends\?.*e=/);
    await expect(sheet.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(sheet.getByText("Subtrend", { exact: true })).toBeVisible();
    await expect(sheet.locator("dd", { hasText: "Computational Infrastructure" })).toBeVisible();
    await page.waitForTimeout(600);
    const box = (await sheet.boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(vw - (box.x + box.width)).toBeLessThan(40);
    expect(box.height).toBeGreaterThan(page.viewportSize()!.height * 0.6);
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
    await crumbs.getByRole("button", { name: "Megatrends", exact: true }).click();
    await expect(page.getByTestId("mg-ball")).toHaveCount(total);
    // No tracker or period filters: the page shows both trackers and every date.
    await expect(page.getByRole("group", { name: "Tracker" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Event Date period" })).toHaveCount(0);
  });
});

test.describe("tab order", () => {
  test("admin reorders and renames the menu's groups and tabs for everyone (request 28)", async ({ page, browser }) => {
    await signInAs(page, "admin");
    await page.goto("/admin");
    const card = page.getByTestId("tab-order");
    await expect(card.getByRole("heading", { name: "Menu" })).toBeVisible();
    const groups = () => navOf(page).locator(".nav-group > .nav-parent > span:first-child").allInnerTexts();
    await expect.poll(groups).toEqual(["Inputs", "Analytics", "Admin"]);
    // Groups move; tabs move within their group (Admin moves past the Database tab, then Analytics).
    await card.getByRole("button", { name: "Move group Admin up" }).click();
    await expect(page.locator(".toast").last()).toContainText("Moved");
    await card.getByRole("button", { name: "Move group Admin up" }).click();
    await expect.poll(groups).toEqual(["Inputs", "Admin", "Analytics"]);
    await card.getByTestId("menu-group-analytics").getByRole("button", { name: "Move tab Analytics: Primary Tracker up" }).click();
    await expect(page.locator(".toast").last()).toContainText("Moved");
    // Renamed: a group and a tab.
    await card.getByLabel("Name of the Inputs group").fill("Sources");
    await card.getByLabel("Name of the Inputs group").press("Enter");
    await expect(page.locator(".toast").last()).toContainText("Group renamed to “Sources”");
    await card.getByLabel("Name of the Analytics tab Primary Tracker").fill("Interviews");
    await card.getByLabel("Name of the Analytics tab Primary Tracker").press("Tab");
    await expect(page.locator(".toast").last()).toContainText("Tab renamed to “Interviews”");
    await expect(card.getByTestId("menu-item-primary-tracker")).toContainText("was Primary Tracker");
    await expectAccessible(page, "Administration with the menu editor");
    expect(await menuOf(page)).toEqual([
      "Sources: Input, Eradigm Inbox, Client Inbox",
      "Admin: Deliverables, Administration",
      "Analytics: Megatrends Dashboard, Interviews, Knowledge Graph",
      "Database",
    ]);
    await goTab(page, "Analytics", "Interviews");
    await expect(page).toHaveURL(/\/analytics\/primary/);
    // A client sees the same order and names (without the staff tabs and the Admin group).
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await signInAs(other, "client");
    await other.goto("/dashboard");
    expect(await menuOf(other)).toEqual(["Sources: Client Inbox", "Analytics: Megatrends Dashboard, Interviews, Knowledge Graph", "Database"]);
    await ctx.close();
    // Restore.
    await page.goto("/admin");
    await card.getByRole("button", { name: "Restore the usual menu" }).click();
    await expect.poll(groups).toEqual(["Inputs", "Analytics", "Admin"]);
    await expect(card.getByLabel("Name of the Analytics tab Primary Tracker")).toHaveValue("");
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
