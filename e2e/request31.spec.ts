import { expect, expectAccessible, goTab, menuOf, navLink, navOf, signInAs, test } from "./fixtures";

const R_AND_D = "AI Investment in R&D";

test.describe("request 31", () => {
  test("the menu is Inputs, Analytics, Databases and Admin (renamed in request 34)", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    expect(await menuOf(page)).toEqual([
      "Inputs: Input, Eradigm Inbox, Client Inbox",
      "Analytics: Megatrends Dashboard, Knowledge Graph, Primary Tracker",
      "Databases: Signals Database, Phantoms Database, CI analyses",
      "Admin: Deliverables, Administration",
    ]);
    await expect(navOf(page).getByRole("link", { name: /Trend analysis$/ })).toHaveCount(0);
  });

  test("Knowledge Graph: one tab with a Megatrends / Competitors toggle at the top left", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto("/dashboard");
    await goTab(page, "Analytics", "Knowledge Graph");
    await expect(page).toHaveURL(/\/megatrends$/);
    const toggle = page.getByRole("group", { name: "Knowledge graph of" });
    await expect(toggle.getByRole("button", { name: "Megatrends" })).toHaveAttribute("aria-pressed", "true");
    // Top left of the graph.
    const [t, stage] = [(await toggle.boundingBox())!, (await page.locator(".mg-stage").boundingBox())!];
    expect(t.y - stage.y).toBeLessThan(60);
    expect(t.x - stage.x).toBeLessThan(60);
    await toggle.getByRole("button", { name: "Competitors" }).click();
    await expect(page).toHaveURL(/\/competitors$/);
    await expect(toggle.getByRole("button", { name: "Competitors" })).toHaveAttribute("aria-pressed", "true");
    // Still the Knowledge Graph tab.
    await expect(navLink(page, "Analytics", "Knowledge Graph")).toHaveAttribute("aria-current", "page");
    await expectAccessible(page, "Knowledge Graph on Competitors");
    await toggle.getByRole("button", { name: "Megatrends" }).click();
    await expect(page).toHaveURL(/\/megatrends$/);
  });

  test("Analytics Dashboard: the timeline at the top (zoomable), the two impact mixes side by side, then Trends Analysis", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const dash = page.getByTestId("analytics-dashboard");
    await expect(dash.getByRole("heading", { name: "Megatrends Dashboard", level: 1 })).toBeVisible();
    // No figures band, no filter bar.
    await expect(page.locator(".kpi")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Filters", exact: true })).toHaveCount(0);
    // The knowledge graph's night sky.
    expect(await dash.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("gradient");
    const card = (name: string) => page.locator("section.card", { has: page.getByRole("heading", { name, exact: true }) });
    const [tl, macro, comp] = [(await card("Signal Timeline").boundingBox())!, (await card("Impact Mix by Macrotrend").boundingBox())!, (await card("Impact Mix by Competitor").boundingBox())!];
    expect(tl.y).toBeLessThan(macro.y);
    expect(Math.abs(macro.y - comp.y)).toBeLessThanOrEqual(1);
    expect(comp.x).toBeGreaterThan(macro.x + macro.width - 1);
    await expect(card("Impact Mix by Competitor").locator(".bar-row").first()).toBeVisible();
    // Zoom: scroll on the timeline, then Reset.
    const range = page.getByTestId("tl-range");
    await expect(range).toHaveText("All dates");
    const plot = page.getByTestId("signal-timeline");
    const before = await plot.locator(".tl-pt").count();
    const b = (await plot.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -240);
    await expect(range).not.toHaveText("All dates");
    expect(await plot.locator(".tl-pt").count()).toBeLessThan(before);
    // Drag moves across the dates.
    const zoomed = await range.innerText();
    await page.mouse.move(b.x + b.width * 0.5, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.2, b.y + 20, { steps: 6 });
    await page.mouse.up();
    await expect(range).not.toHaveText(zoomed);
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(range).toHaveText("All dates");
    // Trends Analysis: a centred subtitle, then Megatrends and Competitors.
    const title = page.getByRole("heading", { name: "Trends Analysis", level: 2 });
    await expect(title).toBeVisible();
    expect(await title.evaluate((el) => getComputedStyle(el).textAlign)).toBe("center");
    await expectAccessible(page, "Analytics Dashboard");
    await page.getByTestId("ad-megatrends").click();
    await expect(page).toHaveURL(/\/analytics\/megatrends$/);
    await expect(navLink(page, "Analytics", "Megatrends Dashboard")).toHaveAttribute("aria-current", "page");
  });

  test("Trends Analysis: a Macrotrend opens its own dashboard (request 34)", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.setViewportSize({ width: 1440, height: 900 });
    // The old address still works.
    await page.goto("/megatrends/analysis");
    await expect(page).toHaveURL(/\/analytics\/megatrends$/);
    const list = page.getByRole("list", { name: "Macrotrends" });
    await list.getByRole("button", { name: new RegExp(`^${R_AND_D.replace(/[&]/g, "\\$&")}`) }).click();
    await expect(page).toHaveURL(/m=AI\+Investment/);
    await expect(page.getByTestId("ta-name")).toHaveText(R_AND_D);
    await expect(page.getByTestId("md-mix").locator(".bar-row").first()).toBeVisible();
    // Back to the list.
    await page.getByRole("button", { name: "← All megatrends" }).click();
    await expect(list).toBeVisible();
  });

  test("Trends Analysis: a competitor opens its timeline, impact mix by Macrotrend and its analysis", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/analytics/competitors");
    await page.getByLabel("Find a competitor").fill("pfiz");
    await page.getByRole("list", { name: "Competitors" }).getByRole("button", { name: /^Pfizer/ }).click();
    await expect(page).toHaveURL(/c=Pfizer/);
    await expect(page.getByTestId("ta-subtrend")).toHaveCount(0);
    const card = (name: string) => page.locator("section.card", { has: page.getByRole("heading", { name, exact: true }) });
    await expect(card("Impact Mix by Macrotrend").locator(".bar-row").first()).toBeVisible();
    await expect(card("Impact Mix by Competitor")).toHaveCount(0);
    await expect(page.getByTestId("ta-summary")).toContainText("PfizerForAll");
    // A client reads it but has no Input link.
    await expect(page.getByRole("link", { name: "Input a new trend analysis →" })).toHaveCount(0);
  });

  test("Input: what happened to an added source shows right under the Add a source card", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/input");
    const card = page.getByTestId("source-card");
    await card.getByTestId("stream-secondary").click();
    await card.getByRole("button", { name: "✎ Manual entry" }).click();
    const sent = page.getByRole("heading", { name: "Blank entry sent to the Eradigm Inbox (Secondary)" });
    await expect(sent).toBeVisible();
    const [src, msg, imp] = [(await card.boundingBox())!, (await sent.boundingBox())!, (await page.getByTestId("import-card").boundingBox())!];
    expect(msg.y).toBeGreaterThan(src.y + src.height - 1);
    expect(msg.y).toBeLessThan(imp.y);
  });

  test("Edit columns works on the Primary columns too, and follows the Primary view", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/inbox");
    const cols = page.locator("section.card", { has: page.locator("#cols-title") });
    // The switch is there before the editor opens.
    await expect(cols.getByRole("group", { name: "Columns of" })).toBeVisible();
    await page.getByRole("group", { name: "Show entries from" }).getByRole("button", { name: "Primary", exact: true }).click();
    await expect(page.locator("#cols-title")).toHaveText("Columns · Primary");
    await cols.getByRole("button", { name: "Edit columns" }).click();
    await expect(page.locator("#cols-inbox h3")).toHaveText("Primary Inbox columns");
    // Workstream is a dropdown with the nine workstreams.
    const ws = page.getByTestId("col-row-workstream");
    await expect(ws).toContainText("Dropdown");
    await expect(ws.getByRole("button", { name: /9 options/ })).toBeVisible();
  });
});
