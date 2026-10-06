import { expect, expectAccessible, signInAs, test } from "./fixtures";

const R_AND_D = "AI Investment in R&D";

test.describe("request 35", () => {
  test("the Macrotrend dashboard's knowledge graph has no timeline and no 'All Tracker entries' globe; the arrows' names are large", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/analytics/megatrends?${new URLSearchParams({ m: R_AND_D })}`);
    const dash = page.getByTestId("macro-dashboard");
    const label = dash.getByTestId("md-down").locator(".md-arrow-label");
    await expect(label).toHaveText("Long-Term Landscape");
    expect(Number.parseFloat(await label.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);
    // The four cells still fit the window, with the arrow below them.
    const cell = (await dash.getByTestId("md-section-current").boundingBox())!;
    const arrow = (await dash.getByTestId("md-down").boundingBox())!;
    expect(cell.y + cell.height).toBeLessThanOrEqual(arrow.y);
    expect(arrow.y + arrow.height).toBeLessThanOrEqual(900);

    // The impact mix: no line under its title.
    await expect(dash.getByTestId("md-mix").locator(".card-sub")).toHaveCount(0);

    // The timeline: no subtitle, no + / − or dates; "Change Magnitude" up the axis instead of its levels, and a wider plot.
    await dash.getByTestId("md-down").click();
    await expect(dash.getByTestId("md-track")).toHaveAttribute("data-view", "1");
    // (once the rows have slid into place)
    await page.waitForTimeout(900);
    const tl = dash.getByTestId("md-timeline");
    await expect(tl.getByRole("heading", { name: "Signal Timeline" })).toBeVisible();
    await expect(tl.locator(".card-sub")).toHaveCount(0);
    await expect(tl.getByRole("button", { name: "Zoom in on the timeline" })).toHaveCount(0);
    await expect(tl.getByRole("button", { name: "Zoom out on the timeline" })).toHaveCount(0);
    await expect(tl.getByTestId("tl-range")).toHaveCount(0);
    const axis = tl.locator(".tl-y-name");
    await expect(axis).toHaveText("Change Magnitude");
    expect(await axis.locator("span").evaluate((el) => getComputedStyle(el).writingMode)).toBe("vertical-rl");
    await expect(tl.getByText("Strong Increase")).toHaveCount(0);
    const plot = (await tl.getByTestId("signal-timeline").boundingBox())!;
    const card = (await tl.boundingBox())!;
    expect(plot.width).toBeGreaterThan(card.width - 90);
    // Scroll zooms in; Reset then shows.
    await expect(tl.getByRole("button", { name: "Reset" })).toHaveCount(0);
    await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2);
    await page.mouse.wheel(0, -400);
    await expect(tl.getByRole("button", { name: "Reset" })).toBeVisible();
    await tl.getByRole("button", { name: "Reset" }).click();
    await expect(tl.getByRole("button", { name: "Reset" })).toHaveCount(0);
    await expectAccessible(page, "Macrotrend dashboard: Long-Term Landscape");

    for (let i = 1; i < 3; i++) {
      await dash.getByTestId("md-down").click();
      await expect(dash.getByTestId("md-track")).toHaveAttribute("data-view", String(i + 1));
    }
    const graph = dash.getByTestId("md-graph");
    const canvas = graph.getByTestId("mg-canvas");
    await expect(canvas).toHaveAttribute("data-core", "none");
    // The Macrotrend and its Subtrends only.
    expect(Number(await canvas.getAttribute("data-hubs"))).toBeGreaterThan(1);
    await expect(graph.getByTestId("mg-timeline")).toHaveCount(0);
    // The graph fills the frame.
    const g = (await graph.boundingBox())!;
    const stage = (await graph.locator(".mg-stage").boundingBox())!;
    expect(Math.abs(stage.height - g.height)).toBeLessThan(4);
    const up = dash.getByTestId("md-up").locator(".md-arrow-label");
    expect(Number.parseFloat(await up.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);
    await expectAccessible(page, "Macrotrend dashboard: Explore Signals");

    // The Knowledge Graph tab keeps its core and timeline.
    await page.goto("/megatrends");
    await expect(page.getByTestId("mg-canvas")).toHaveAttribute("data-core", "shown");
    await expect(page.getByTestId("mg-timeline")).toBeVisible();
  });
});
