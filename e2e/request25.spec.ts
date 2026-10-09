import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("request 25", () => {
  test("Administration loads, even against an API from before competitor tiers (no tiers in its settings)", async ({ page }) => {
    await signInAs(page, "admin");
    // An older API: settings without competitorTiers.
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      delete body.competitorTiers;
      await route.fulfill({ response: res, json: body });
    });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Admin", exact: true })).toBeVisible();
    await expect(page.getByTestId("error-boundary")).toHaveCount(0);
    const card = page.getByTestId("competitor-tiers");
    await expect(card.getByLabel("Tier 1 competitors, one per line")).toHaveValue(/Pfizer/);
    await expect(page.getByTestId("tab-order")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expectAccessible(page, "Administration against an older API");
  });

  test("Competitors: no N/A sphere or list item, and tier colours even when the API sends no tiers", async ({ page }) => {
    await signInAs(page, "analyst");
    // An older API: no tier field, and N/A counted as a competitor.
    await page.route("**/api/competitors**", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.competitors = [...body.competitors.map((c: Record<string, unknown>) => ({ ...c, tier: undefined })), { name: "N/A", count: 40, summary: null }, { name: "n/a (none named)", count: 3, summary: null }];
      body.entries = body.entries.map((e: { competitors: string[] }, i: number) => (i % 4 === 0 ? { ...e, competitors: [...e.competitors, "N/A"] } : e));
      body.pairs = [...body.pairs, { a: "N/A", b: "Pfizer", count: 9 }];
      await route.fulfill({ response: res, json: body });
    });
    await page.goto("/competitors");
    const list = page.getByRole("navigation", { name: "Competitors" });
    await expect(list.getByRole("button", { name: /^Pfizer/ })).toBeAttached();
    await expect(list.getByRole("button", { name: /N\/A/i })).toHaveCount(0);
    await expect(page.getByTestId("mg-timeline")).not.toContainText("N/A");
    // Pfizer is Tier 1 (red) from the settings.
    await page.goto("/competitors?c=Pfizer");
    await expect(page.getByTestId("mg-tier")).toHaveText("Tier 1");
    await expect(page.getByTestId("mg-tier")).toHaveCSS("border-color", "rgb(229, 83, 75)");
  });

  test("a page that fails shows a message instead of blanking the dashboard", async ({ page }) => {
    await signInAs(page, "admin");
    // A broken settings response makes the Settings card fail; the rest of Administration and the menu stay.
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      body.megatrends = null;
      await route.fulfill({ response: res, json: body });
    });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Admin", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" })).toBeVisible();
    await expect(page.getByTestId("error-boundary").first()).toContainText("could not be shown");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });
});
