import { expect, expectAccessible, menuOf, navLink, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };
const R_AND_D = "AI Investment in R&D";
const uid = () => Math.random().toString(36).slice(2, 8);

/** Entries pushed to the Tracker through the API (as the admin). */
async function push(page: Page, stream: "primary" | "secondary", rows: Record<string, unknown>[]) {
  return page.evaluate(
    async ({ stream, rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const ids: string[] = [];
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream }) })).json();
        const values = {
          ...item.draft,
          macrotrend: "Geopolitics",
          subtrend: "IRA Pricing/Tariffs",
          growth: "Stable",
          impact: "Medium",
          source: stream === "primary" ? "Primary Source" : "Press Release",
          competitors: ["Roche"],
          action: "Not Actioned",
          ...r,
        };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
        ids.push(item.id);
      }
      return ids;
    },
    { stream, rows, h: ADMIN },
  );
}

test.describe("request 34", () => {
  test("the menu: Databases, Signals/Phantoms Database, CI analyses, Megatrends Dashboard and Primary Tracker", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    expect(await menuOf(page)).toEqual([
      "Inputs: Input, Eradigm Inbox, Client Inbox",
      "Analytics: Megatrends Dashboard, Knowledge Graph, Primary Tracker",
      "Databases: Signals Database, Phantoms Database, CI analyses",
      "Admin: Deliverables, Administration",
    ]);
    await expect(page.getByRole("heading", { level: 1, name: "Megatrends Dashboard" })).toBeVisible();
    await navLink(page, "Databases", "Signals Database").click();
    await expect(page).toHaveURL(/\/tracker/);
    await expect(page.getByRole("heading", { level: 1, name: "Signals Database" })).toBeVisible();
  });

  test("the Macrotrend dashboard: two rows at a time, arrows with the next row's name, then the knowledge graph", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    // Only the filled sections change: a second submission keeps the first one's text.
    await page.evaluate(
      async ({ h, m }) => {
        const j = { ...h, "content-type": "application/json" };
        const post = (sections: Record<string, string>) => fetch("/api/trend-analyses/macrotrend", { method: "POST", headers: j, body: JSON.stringify({ macrotrend: m, sections }) });
        await post({ overview: "AI in R&D is machine learning across discovery and development.", why: "It changes cycle times." });
        await post({ next: "Agents in the lab.", why: "" });
      },
      { h: ADMIN, m: R_AND_D },
    );
    await page.goto(`/analytics/megatrends?${new URLSearchParams({ m: R_AND_D })}`);
    const dash = page.getByTestId("macro-dashboard");
    await expect(dash.getByTestId("ta-name")).toHaveText(R_AND_D);
    const overview = dash.getByTestId("md-section-overview");
    await expect(overview.getByRole("heading", { name: `What is ${R_AND_D}?` })).toBeVisible();
    await expect(overview).toContainText("machine learning across discovery");
    await expect(dash.getByTestId("md-section-why")).toContainText("It changes cycle times.");
    await expect(dash.getByTestId("md-mix")).toContainText("Impact Mix by Subtrend");
    // No up arrow on the first view; the down arrow names the next row.
    await expect(dash.getByTestId("md-up")).toHaveCount(0);
    await expect(dash.getByTestId("md-down")).toContainText("Long-Term Landscape");
    // The four cells: equal and aligned.
    const boxes = await Promise.all(["md-section-overview", "md-section-why", "md-section-current", "md-mix"].map((t) => dash.getByTestId(t).boundingBox()));
    const [a, b, c, d] = boxes.map((x) => x!);
    for (const x of [b, c, d]) {
      expect(Math.abs(x.width - a.width)).toBeLessThan(2);
      expect(Math.abs(x.height - a.height)).toBeLessThan(2);
    }
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.x - c.x)).toBeLessThan(1);
    expect(Math.abs(c.y - a.y - (a.height + 12))).toBeLessThan(2);
    expect(c.y + c.height).toBeLessThanOrEqual(900);
    await expectAccessible(page, "Macrotrend dashboard, rows 1 and 2");

    // The toggle left of the key: Impact Mix by Competitor.
    await dash.getByTestId("md-mix-comp").click();
    await expect(dash.getByTestId("md-mix")).toContainText("Impact Mix by Competitor");
    await dash.getByTestId("md-mix-sub").click();

    // Down: rows 2 and 3, an up arrow naming the first row.
    await dash.getByTestId("md-down").click();
    await expect(dash.getByTestId("md-track")).toHaveAttribute("data-view", "1");
    await expect(dash.getByTestId("md-up")).toContainText(`${R_AND_D} Overview`);
    await expect(dash.getByTestId("md-down")).toContainText("What's Next?");
    await expect(dash.getByTestId("md-timeline")).toBeInViewport();
    // Scrolling moves on too.
    await page.waitForTimeout(900);
    await page.mouse.move(700, 300);
    await page.mouse.wheel(0, 200);
    await expect(dash.getByTestId("md-track")).toHaveAttribute("data-view", "2");
    await expect(dash.getByTestId("md-section-next")).toContainText("Agents in the lab.");
    await expect(dash.getByTestId("md-section-why")).toContainText("It changes cycle times.");
    await expect(dash.getByTestId("md-section-abbvie").getByRole("heading", { name: "Impact on AbbVie" })).toBeVisible();
    await expect(dash.getByTestId("md-down")).toContainText("Explore Signals");

    // Row 5: the whole frame, the knowledge graph of this Macrotrend only.
    await dash.getByTestId("md-down").click();
    await expect(dash.getByTestId("md-track")).toHaveAttribute("data-view", "3");
    await expect(dash.getByTestId("md-down")).toHaveCount(0);
    await expect(dash.getByTestId("md-up")).toContainText("Long-Term Landscape");
    const graph = dash.getByTestId("md-graph");
    await expect(graph.getByRole("button", { name: R_AND_D, exact: true })).toBeVisible();
    await expect(graph.locator(".mg-panel, .mg-rail")).toHaveCount(0);
    const g = (await graph.boundingBox())!;
    expect(Math.abs(g.x - a.x)).toBeLessThan(2);
    expect(Math.abs(g.width - (b.x + b.width - a.x))).toBeLessThan(2);
    expect(Math.abs(g.height - (c.y + c.height - a.y))).toBeLessThan(2);

    // And back up.
    await dash.getByTestId("md-up").click();
    await expect(dash.getByTestId("md-track")).toHaveAttribute("data-view", "2");
  });

  test("admins edit a section on the dashboard; the Input Trend Analysis form updates only the boxes with text", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    const tag = uid();
    await page.goto(`/analytics/megatrends?${new URLSearchParams({ m: "Geopolitics" })}`);
    const cur = page.getByTestId("md-section-current");
    await cur.getByRole("button", { name: "Edit Current Landscape" }).click();
    await cur.getByRole("textbox", { name: "Current Landscape" }).fill(`Tariffs today ${tag}`);
    await cur.getByRole("button", { name: "Save" }).click();
    await expect(cur).toContainText(`Tariffs today ${tag}`);

    await page.goto("/input");
    const card = page.getByTestId("trend-analysis-input");
    await card.getByTestId("tai-macrotrend").click();
    await card.getByTestId("tai-macro").selectOption("Geopolitics");
    await expect(card.getByTestId("tai-section-current")).toHaveAttribute("placeholder", new RegExp(`Tariffs today ${tag}`));
    await expect(card.getByTestId("tai-submit")).toBeDisabled();
    await card.getByTestId("tai-section-longterm").fill(`A decade of tariffs ${tag}`);
    await card.getByTestId("tai-submit").click();
    await expect(card.getByTestId("tai-saved")).toContainText("Saved 1 section of the Macrotrend Geopolitics");
    await expectAccessible(page, "Input Trend Analysis: Macrotrend sections");

    await page.goto(`/analytics/megatrends?${new URLSearchParams({ m: "Geopolitics" })}`);
    await expect(page.getByTestId("md-section-current")).toContainText(`Tariffs today ${tag}`);
    await page.getByTestId("md-down").click();
    await expect(page.getByTestId("md-section-longterm")).toContainText(`A decade of tariffs ${tag}`);
  });

  test("clients see the sections but cannot edit them", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto(`/analytics/megatrends?${new URLSearchParams({ m: R_AND_D })}`);
    await expect(page.getByTestId("md-section-overview")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  });

  test("the knowledge graph: no left menus, a half-width list of signals, the CI Perspective tag and text", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = uid();
    await push(page, "secondary", [{ title: `With a perspective ${tag}`, ci_perspective: `Watch Roche closely ${tag}.` }, { title: `Without a perspective ${tag}` }]);
    await page.goto(`/megatrends?${new URLSearchParams({ m: "Geopolitics", s: "IRA Pricing/Tariffs" })}`);
    await expect(page.locator(".mg-panel, .mg-rail")).toHaveCount(0);
    const sheet = page.getByTestId("mg-sheet");
    const list = sheet.getByTestId("mg-sources");
    await expect(list).toBeVisible();
    const stage = (await page.locator(".mg-page").boundingBox())!;
    const s = (await sheet.boundingBox())!;
    expect(Math.abs(s.width - (stage.width / 2 - 24))).toBeLessThan(4);
    const withRow = list.getByRole("button", { name: new RegExp(`With a perspective ${tag}`) });
    await expect(withRow.getByTestId("ci-tag")).toHaveText("CI Perspective");
    await expect(list.getByRole("button", { name: new RegExp(`Without a perspective ${tag}`) }).getByTestId("ci-tag")).toHaveCount(0);
    await withRow.click();
    await expect(sheet.getByTestId("mg-ci")).toContainText(`Watch Roche closely ${tag}.`);
    await expectAccessible(page, "Knowledge graph signal with a CI Perspective");
  });

  test("Analytics → Primary Tracker: Archived Responses side by side, and a popup of each answer", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = uid();
    const role = `Medical Director ${tag}`;
    const company = "Hôpital Lyon";
    const kd = (t: string) => `Key details of ${t}.`;
    await push(page, "primary", [
      { title: `First answer ${tag}`, date: "2026-06-01", source_role: role, source_company: company, key_details: kd("first"), key_metrics: "12% uptake" },
      { title: `Second answer ${tag}`, date: "2026-07-01", source_role: role, source_company: company, key_details: kd("second") },
      { title: `Latest answer ${tag}`, date: "2026-08-01", source_role: role, source_company: company, key_details: kd("latest") },
    ]);
    await page.goto("/dashboard");
    await navLink(page, "Analytics", "Primary Tracker").click();
    await expect(page).toHaveURL(/\/analytics\/primary/);
    await expect(page.getByRole("heading", { level: 1, name: "Primary Tracker" })).toBeVisible();
    // Primary only: no Primary/Secondary switch.
    await expect(page.getByRole("group", { name: /Show entries from/ })).toHaveCount(0);
    await page.goto(`/analytics/primary?q=${tag}`);
    const table = page.locator("table.data").first();
    await expect(table.getByRole("columnheader", { name: "Archived Responses" })).toBeVisible();
    await expect(table.getByTestId("archived-cell")).toHaveCount(2);
    await expect(table.getByRole("row", { name: new RegExp(`First answer ${tag}`) }).getByTestId("archived-cell")).toHaveCount(0);
    await table.getByRole("row", { name: new RegExp(`Latest answer ${tag}`) }).getByTestId("archived-cell").click();

    // The popup: source at the top, Key Details and Key Metrics below.
    const pop = page.getByTestId("archived-popup");
    await expect(pop).toContainText(role);
    await expect(pop).toContainText(company);
    await expect(pop).toContainText("2026-08-01");
    await expect(pop.getByRole("heading", { name: "Key Details" })).toBeVisible();
    await expect(pop).toContainText(kd("latest"));
    await expectAccessible(page, "Primary Tracker with an Archived Responses popup");
    await pop.getByRole("button", { name: "Close" }).click();

    // The split: the Archived Responses table on the right, the earlier answers newest first.
    const split = page.getByTestId("arch-split");
    const panel = page.getByTestId("archived-panel");
    await expect(panel.getByRole("heading", { name: "Archived Responses" })).toBeVisible();
    await expect(panel.locator("tbody tr")).toHaveCount(2);
    await expect(panel.locator("tbody tr").first()).toContainText(`Second answer ${tag}`);
    const left = (await table.boundingBox())!;
    const right = (await panel.boundingBox())!;
    expect(left.x + left.width).toBeLessThanOrEqual(right.x);
    expect(right.x + right.width).toBeLessThanOrEqual((await split.boundingBox())!.x + (await split.boundingBox())!.width + 1);
    await panel.getByRole("button", { name: `Open archived response: First answer ${tag}` }).click();
    await expect(pop).toContainText(kd("first"));
    await expect(pop).toContainText("12% uptake");
    await expectAccessible(page, "Archived Responses split screen");
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await panel.getByRole("button", { name: "Close Archived Responses" }).click();
    await expect(panel).toHaveCount(0);

    // The Signals Database's Primary Tracker is unchanged.
    await page.goto(`/tracker?stream=primary&q=${tag}`);
    await expect(page.locator("table.data").getByRole("columnheader", { name: "Linked" })).toBeVisible();
  });
});
