import { choose, expect, expectAccessible, menuOf, navOf, signInAs, test } from "./fixtures";

test.describe("request 48", () => {
  test("the Databases tab and its Signals, Phantoms and CI analyses tabs are gone; Database stays; old links open the Database", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    const menu = await menuOf(page);
    expect(menu).toContain("Database");
    expect(menu.join(" | ")).not.toMatch(/Databases|Signals Database|Phantoms Database|CI analyses/);
    await expect(navOf(page).getByRole("link", { name: "Database", exact: true })).toBeVisible();

    // Old addresses (bookmarks, links) open the Database with the same view.
    await page.goto("/tracker?stream=primary&q=Pfizer&f.impact=High");
    await expect(page).toHaveURL(/\/database\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("stream")).toBe("primary");
    expect(url.searchParams.get("db.q")).toBe("Pfizer");
    expect(url.searchParams.get("db.f.impact")).toBe("High");
    await expect(page.getByRole("heading", { name: "Database", level: 1 })).toBeVisible();
    await page.goto("/phantoms");
    await expect(page).toHaveURL(/\/database$/);
    await page.goto("/trend-analyses");
    await expect(page).toHaveURL(/\/database\?db=ci$/);
    await expect(page.getByTestId("db-ci")).toHaveAttribute("aria-pressed", "true");
  });

  test("Database: the filters start hidden; Show filters opens them (remembered)", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    await page.evaluate(() => {
      for (const k of ["eradigm.filters.db", "eradigm.filters.db.closed"]) localStorage.removeItem(k);
    });
    await page.goto("/database");
    const filters = page.getByTestId("db-filters");
    const toggle = page.getByTestId("filters-toggle");
    await expect(page.getByTestId("table-scroll").locator("tbody tr").first()).toBeVisible();
    await expect(filters).toBeHidden();
    await expect(toggle).toHaveText(/Show filters/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(filters).toBeVisible();
    await page.reload();
    await expect(filters).toBeVisible();
    await toggle.click();
    await expect(filters).toBeHidden();
    await page.reload();
    await expect(filters).toBeHidden();
  });

  test("a competitor's page: Company Profile, then its timeline and impact mix, then Explore Signals opens the knowledge graph of its signals", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });

    // Input → Input Trend Analysis → Competitor writes the Company Profile.
    await page.goto("/input");
    const card = page.getByTestId("trend-analysis-input");
    await card.getByTestId("tai-competitor").click();
    await choose(card.getByRole("combobox", { name: "Competitor" }), "Pfizer");
    const text = `Pfizer profile ${Date.now()}`;
    await expect(card.getByText("Company Profile · Pfizer", { exact: true })).toBeVisible();
    await card.getByRole("textbox", { name: "Company Profile of Pfizer" }).fill(text);
    await card.getByRole("button", { name: "Submit Company Profile" }).click();
    await expect(card.getByTestId("tai-saved")).toContainText("Saved as the Company Profile of Pfizer");
    await card.getByRole("link", { name: "Open its Company Profile →" }).click();
    await expect(page).toHaveURL(/\/analytics\/competitors\?c=Pfizer/);

    // Company Profile at the top, then the Signal Timeline, then the impact mix by Macrotrend.
    const profile = page.getByTestId("ta-summary");
    await expect(profile.getByRole("heading", { name: "Company Profile · Pfizer" })).toBeVisible();
    await expect(profile).toContainText(text);
    await expect(page.getByText("Trend analysis", { exact: false })).toHaveCount(0);
    const timeline = page.getByRole("heading", { name: "Signal Timeline" });
    const mix = page.getByRole("heading", { name: /Impact mix by Macrotrend/i });
    await expect(timeline).toBeVisible();
    const y = async (l: typeof profile) => (await l.boundingBox())!.y;
    expect(await y(profile)).toBeLessThan(await y(timeline));
    expect(await y(timeline)).toBeLessThan(await y(mix));
    await expectAccessible(page, "Competitor page: Company Profile");

    // At the bottom, Explore Signals (as on a Macrotrend's dashboard).
    const down = page.getByTestId("cd-down");
    await expect(down).toHaveAccessibleName("Next: Explore Signals");
    await down.click();
    await expect(page).toHaveURL(/v=signals/);
    await expect(page.getByTestId("ta-name")).toHaveText("Explore Signals");
    const graph = page.getByTestId("cd-graph");
    await expect(graph.getByTestId("mg-canvas")).toBeVisible();
    await expect(graph.getByRole("navigation", { name: "Graph level" })).toContainText("Pfizer");
    // Filling the page below the header.
    const g = (await graph.boundingBox())!;
    expect(g.height).toBeGreaterThan(600);
    await expectAccessible(page, "Competitor page: Explore Signals");
    // Back up with its arrow.
    await page.getByTestId("cd-up").click();
    await expect(page.getByTestId("ta-name")).toHaveText("Pfizer");
    await expect(page).not.toHaveURL(/v=signals/);

    // Scrolling on past the end of the page opens it too.
    await page.getByTestId("cd-profile").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 200);
    await expect(page).toHaveURL(/v=signals/);
    await expect(page.getByTestId("ta-name")).toHaveText("Explore Signals");
  });
});
