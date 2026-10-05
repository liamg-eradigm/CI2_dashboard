import { expect, expectAccessible, goTab, navLink, signInAs, test } from "./fixtures";

const WORKFORCE = "Workforce AI Upskilling";
const CULTURE = "Digital & AI Cultural Adoption";

test.describe("requests 29 and 30", () => {
  test("each Trend analysis list row has a bar for its signal count (the largest full width)", async ({ page }) => {
    await signInAs(page, "analyst");
    for (const path of ["/megatrends/analysis", "/competitors/analysis"]) {
      await page.goto(path);
      const bars = page.locator(".ta-list [data-testid=ta-count] .ta-bar");
      await expect(bars.first()).toBeVisible();
      const widths = await bars.evaluateAll((els) => els.map((el) => Number.parseFloat((el as HTMLElement).style.width)));
      expect(Math.max(...widths), path).toBe(100);
      expect(Math.min(...widths), path).toBeGreaterThan(0);
    }
  });

  test("Competitors trend analysis lists Tier 1 first, then Tiers 2, 3 and 4, each by signal count", async ({ page }) => {
    await signInAs(page, "analyst");
    // The seed's competitors are all Tier 1: answer with a mix of tiers (default tiers: Amgen 2, NVIDIA 3, others unlisted 4).
    await page.route("**/api/competitors?*", async (route) => {
      const real = await (await route.fetch()).json();
      const c = (name: string, count: number) => ({ name, count, tier: 4, summary: null });
      await route.fulfill({ json: { ...real, competitors: [c("Zeta Bio", 99), c("NVIDIA", 50), c("Amgen", 9), c("Pfizer", 5), c("Roche", 7), c("GSK", 60)], pairs: [], entries: [] } });
    });
    await page.goto("/competitors/analysis");
    const cells = page.getByRole("list", { name: "Competitors" }).locator(".ta-cell");
    await expect(cells).toHaveCount(6);
    const rows = await cells.evaluateAll((els) => els.map((el) => `${el.querySelector(".nm")?.textContent} · ${el.querySelector(".ta-note")?.textContent} · ${el.querySelector("[data-testid=ta-count]")?.textContent}`));
    expect(rows).toEqual([
      "Roche · Tier 1 · 7 signals",
      "Pfizer · Tier 1 · 5 signals",
      "Amgen · Tier 2 · 9 signals",
      "GSK · Tier 3 · 60 signals",
      "NVIDIA · Tier 3 · 50 signals",
      "Zeta Bio · Tier 4 · 99 signals",
    ]);
  });

  test("Input Trend Analysis: a Subtrend's analysis updates its Trend analysis and is kept in Trackers → Trend Analyses as Markdown", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/input");
    const card = page.getByTestId("trend-analysis-input");
    await expect(card.getByRole("heading", { name: "Input Trend Analysis" })).toBeVisible();
    await expect(card.getByTestId("tai-macrotrend")).toHaveAttribute("aria-pressed", "true");
    await card.getByTestId("tai-macro").selectOption(WORKFORCE);
    await card.getByLabel("A Subtrend within it").check();
    await card.getByTestId("tai-sub").selectOption(CULTURE);
    const text = `Culture first: adoption is led by champions (${Date.now()}).`;
    await card.getByTestId("tai-text").fill(text);
    await expectAccessible(page, "Input Trend Analysis");
    await card.getByTestId("tai-submit").click();
    await expect(card.getByTestId("tai-saved")).toContainText(`Saved as the analysis of the Subtrend ${CULTURE}`);
    await card.getByRole("link", { name: "Open its trend analysis →" }).click();
    await expect(page).toHaveURL(/\/megatrends\/analysis\?/);
    await expect(page.getByRole("region", { name: "Analysis of the trend" }).getByTestId("mg-summary")).toHaveText(text);
    // The knowledge graph shows the same analysis.
    await page.goto(`/megatrends?m=${encodeURIComponent(WORKFORCE)}&s=${encodeURIComponent(CULTURE)}`);
    await expect(page.getByTestId("mg-panel").getByTestId("mg-summary")).toHaveText(text);

    await goTab(page, "Trackers", "Trend Analyses");
    await expect(page).toHaveURL(/\/trend-analyses$/);
    const row = page.getByTestId("trend-analyses-table").getByRole("row").filter({ hasText: text });
    await expect(row).toContainText("Subtrend");
    await expect(row).toContainText(CULTURE);
    await expectAccessible(page, "Trend Analyses");
    await row.getByRole("button", { name: `Open the Markdown of the trend analysis of ${CULTURE}` }).click();
    const pane = page.getByTestId("trend-analysis-md");
    await expect(pane.locator(".md-raw")).toContainText("Macrotrend_or_Competitor: Macrotrend");
    await expect(pane.locator(".md-raw")).toContainText(`Name: ${CULTURE}`);
    await expect(pane.locator(".md-raw")).toContainText(`Date_of_submission: ${new Date().toISOString().slice(0, 10)}`);
    await expect(pane.locator(".md-raw")).toContainText(text);
    const dl = page.waitForEvent("download");
    await pane.getByRole("button", { name: "Download Markdown" }).click();
    expect((await dl).suggestedFilename()).toMatch(/^Trend_analysis_Subtrend_Digital_AI_Cultural_Adoption_\d{4}-\d{2}-\d{2}\.md$/);
  });

  test("Input Trend Analysis imports a spreadsheet after checking every row", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/input");
    const imp = page.getByTestId("tai-import");
    const tag = `Imported ${Date.now()}`;
    const header = '"Macrotrend or Competitor","Competitor, Macrotrend, or Subtrend","Name","Trend analysis"';
    const upload = (lines: string[]) =>
      imp.getByLabel("Spreadsheet of trend analyses to import").setInputFiles({ name: "analyses.csv", mimeType: "text/csv", buffer: Buffer.from([header, ...lines].join("\n")) });
    await upload([`Competitor,Competitor,AstraZeneca,"${tag}: AZ"`, `Macrotrend,Subtrend,Not a subtrend,"${tag}: nope"`]);
    await imp.getByTestId("tai-import-run").click();
    await expect(imp.getByRole("alert")).toContainText("Nothing was imported: 1 problem");
    await expect(imp.getByRole("alert")).toContainText("There is no Subtrend named “Not a subtrend”.");
    await upload([`Competitor,Competitor,AstraZeneca,"${tag}: AZ"`, `Macrotrend,Macrotrend,${WORKFORCE},"${tag}: workforce"`]);
    await imp.getByTestId("tai-import-run").click();
    await expect(imp.getByTestId("tai-import-done")).toContainText("Imported 2 trend analyses");
    await page.goto("/trend-analyses");
    const rows = page.getByTestId("trend-analyses-table").getByRole("row").filter({ hasText: tag });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Imported · analyses.csv");
  });

  test("clients see Trend Analyses under Trackers but cannot input or remove them", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/trend-analyses");
    await expect(navLink(page, "Trackers", "Trend Analyses")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("trend-analyses-table")).toBeVisible();
    await expect(page.getByRole("link", { name: "+ Input a trend analysis" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove the trend analysis/ })).toHaveCount(0);
  });
});
