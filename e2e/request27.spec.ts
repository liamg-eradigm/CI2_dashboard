import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };
const uid = () => Math.random().toString(36).slice(2, 8);
const R_AND_D = "AI Investment in R&D";

/** Primary entries pushed to the Tracker through the API (as the admin), from the given source. */
async function pushPrimary(page: Page, rows: { title: string; date: string; role: string; company: string }[]) {
  return page.evaluate(
    async ({ rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const ids: string[] = [];
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "primary" }) })).json();
        const values = {
          ...item.draft,
          title: r.title,
          date: r.date,
          source_role: r.role,
          source_company: r.company,
          macrotrend: "Geopolitics",
          subtrend: "IRA Pricing/Tariffs",
          growth: "Stable",
          impact: "Medium",
          source: "Primary Source",
          competitors: ["Roche"],
          action: "Not Actioned",
          key_details: `Key details of ${r.title}.\n${"More detail. ".repeat(80)}`,
        };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
        ids.push(item.id);
      }
      return ids;
    },
    { rows, h: ADMIN },
  );
}

test.describe("request 27", () => {
  test("Primary entries from the same source: flagged while entered, linked with 🔗, and opened side by side", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = uid();
    const role = `Head of Market Access ${tag}`;
    const company = "Lyon University Hospital";
    await pushPrimary(page, [
      { title: `KOL first ${tag}`, date: "2026-07-01", role, company },
      { title: `KOL update ${tag}`, date: "2026-08-01", role, company },
      { title: `KOL latest ${tag}`, date: "2026-09-01", role: role.toUpperCase(), company: ` ${company}  ` },
    ]);

    // Entering a new Primary entry from that source: flagged in the Inbox.
    const { item } = await page.evaluate(async (h) => (await fetch("/api/submissions/manual", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ stream: "primary" }) })).json(), ADMIN);
    await page.goto("/inbox");
    await page.getByRole("group", { name: "Show entries from" }).getByRole("button", { name: "Primary" }).click();
    const card = page.locator("section.inbox-card", { hasText: item.code });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("prior-flag")).toHaveCount(0);
    await card.getByRole("textbox", { name: "Source Role", exact: true }).fill(role.toLowerCase());
    await card.getByRole("textbox", { name: "Source Company", exact: true }).fill(company);
    const flag = card.getByTestId("prior-flag");
    await expect(flag).toContainText("This Source Has Prior Primary Information");
    await expect(flag).toContainText(`3 entries from this source`);
    await expect(flag).toContainText(`KOL latest ${tag}`);
    await expect(card.getByTestId("prior-tag")).toBeVisible();
    await expectAccessible(page, "Inbox with the prior primary information flag");
    // Another company: no flag.
    await card.getByRole("textbox", { name: "Source Company", exact: true }).fill("Somewhere else");
    await expect(card.getByTestId("prior-flag")).toHaveCount(0);

    // The Primary Tracker: a 🔗 column; opening a linked entry shows it beside the earlier one.
    await page.goto(`/tracker?stream=primary&q=${tag}`);
    const table = page.locator("table.data");
    await expect(table.getByRole("columnheader", { name: "Linked" })).toBeVisible();
    await expect(table.getByTestId("linked-cell")).toHaveCount(3);
    await table.getByRole("row", { name: new RegExp(`KOL latest ${tag}`) }).getByTestId("linked-cell").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toHaveClass(/linked-drawer/);
    const earlier = drawer.getByTestId("linked-earlier");
    const later = drawer.getByTestId("linked-later");
    await expect(earlier.getByText("Earlier entry")).toBeVisible();
    await expect(later.getByText("Later entry")).toBeVisible();
    await expect(earlier.getByRole("heading", { name: `KOL update ${tag}` })).toBeVisible();
    await expect(later.getByRole("heading", { name: `KOL latest ${tag}` })).toBeVisible();
    await expect(later.getByText("Opened", { exact: true })).toBeVisible();
    await expect(earlier.getByText("Opened", { exact: true })).toHaveCount(0);
    // Side by side, each scrolling on its own.
    const eb = (await earlier.boundingBox())!;
    const lb = (await later.boundingBox())!;
    expect(eb.x + eb.width).toBeLessThanOrEqual(lb.x + 1);
    expect(Math.abs(eb.y - lb.y)).toBeLessThan(2);
    for (const pane of [earlier, later]) {
      const body = pane.locator(".linked-pane-body");
      expect(await body.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
      expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    }
    await expectAccessible(page, "Linked Primary entries side by side");
    // Walk back to the first entry from this source.
    await earlier.getByRole("button", { name: "‹ Earlier from this source" }).click();
    await expect(earlier.getByRole("heading", { name: `KOL first ${tag}` })).toBeVisible();
    await expect(later.getByRole("heading", { name: `KOL update ${tag}` })).toBeVisible();
    await expect(earlier.getByRole("button", { name: "‹ Earlier from this source" })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Close record" }).click();

    // Opening the oldest shows it with the next one.
    await table.getByRole("row", { name: new RegExp(`KOL first ${tag}`) }).getByRole("button", { name: new RegExp(`Open record: KOL first ${tag}`) }).click();
    await expect(drawer.getByTestId("linked-earlier").getByRole("heading", { name: `KOL first ${tag}` })).toBeVisible();
    await expect(drawer.getByTestId("linked-later").getByRole("heading", { name: `KOL update ${tag}` })).toBeVisible();
    await expect(drawer.getByTestId("linked-earlier").getByText("Opened", { exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "Close record" }).click();

    // Primary Phantoms: the Markdown files side by side.
    await page.goto(`/phantoms?stream=primary&q=${tag}`);
    await expect(page.locator("table.data").getByTestId("linked-cell")).toHaveCount(3);
    await page.locator("table.data").getByRole("row", { name: new RegExp(`KOL update ${tag}`) }).getByTestId("linked-cell").click();
    const md = page.getByRole("dialog");
    await expect(md).toHaveClass(/linked-drawer/);
    await expect(md.getByTestId("linked-earlier").locator("pre.md-raw")).toContainText(`title: KOL first ${tag}`);
    await expect(md.getByTestId("linked-later").locator("pre.md-raw")).toContainText(`title: KOL update ${tag}`);
    await expect(md.getByTestId("linked-earlier").getByRole("button", { name: "Download this Markdown" })).toBeVisible();
    await md.getByRole("button", { name: "Preview" }).click();
    await expect(md.getByTestId("linked-later").locator(".md-preview")).toBeVisible();
    await expectAccessible(page, "Linked Primary Phantoms side by side");

    // Secondary tables have no link column.
    await page.goto("/tracker?stream=secondary");
    await expect(page.locator("table.data").getByRole("columnheader", { name: "Linked" })).toHaveCount(0);
  });

  test("Megatrends and Competitors each open two subtabs in the menu: Knowledge graph and Trend analysis", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" });
    const mega = nav.getByRole("button", { name: "Megatrends" });
    await expect(mega).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("link", { name: "Megatrends: Knowledge graph" })).toHaveCount(0);
    await mega.click();
    await expect(mega).toHaveAttribute("aria-expanded", "true");
    await nav.getByRole("link", { name: "Megatrends: Trend analysis" }).click();
    await expect(page).toHaveURL(/\/megatrends\/analysis$/);
    await expect(nav.getByRole("link", { name: "Megatrends: Trend analysis" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Megatrends: Knowledge graph" }).click();
    await expect(page).toHaveURL(/\/megatrends$/);
    await expect(page.getByTestId("mg-canvas")).toBeVisible();
    await nav.getByRole("button", { name: "Competitors" }).click();
    await nav.getByRole("link", { name: "Competitors: Trend analysis" }).click();
    await expect(page).toHaveURL(/\/competitors\/analysis$/);
    // On a subtab's page its list is open; closing it keeps the page.
    await nav.getByRole("button", { name: "Competitors" }).click();
    await expect(nav.getByRole("link", { name: "Competitors: Trend analysis" })).toHaveCount(0);
    await expect(page.getByTestId("trend-analysis-competitor")).toBeVisible();
  });

  test("Trend analysis: a Macrotrend's signals over time (3 months by default), by competitor, and its analysis; a Subtrend narrows it", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/megatrends/analysis");
    const list = page.getByRole("list", { name: "Macrotrends" });
    const cell = list.getByRole("button", { name: new RegExp(`^${R_AND_D.replace(/[&]/g, "\\$&")}`) });
    await expect(cell).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("ta-time-table")).toHaveCount(0);
    // Wide cells.
    expect((await cell.boundingBox())!.width).toBeGreaterThan(900);
    await cell.click();
    await expect(cell).toHaveAttribute("aria-expanded", "true");
    await expect(page).toHaveURL(/m=AI\+Investment/);
    // The Subtrend dropdown starts closed, on all subtrends.
    const sub = page.getByTestId("ta-subtrend");
    await expect(sub).toHaveValue("");
    // In order: signals over time, by competitor, the analysis.
    const frame = page.getByTestId("ta-frame");
    await expect(frame).toHaveValue("3");
    await expect(page.getByTestId("ta-total")).toContainText("in the last 3 months");
    const months = page.getByTestId("ta-time-table").locator("tbody tr");
    expect(await months.count()).toBeGreaterThanOrEqual(3);
    await frame.selectOption("0");
    await expect(page.getByTestId("ta-total")).toContainText("signals in all");
    const all = Number(/(\d+) signal/.exec((await page.getByTestId("ta-total").textContent()) ?? "")?.[1]);
    expect(all).toBeGreaterThan(0);
    await expect(page.getByTestId("ta-cross-table").getByRole("columnheader", { name: "Competitor" })).toBeVisible();
    expect(await page.getByTestId("ta-cross-table").locator("tbody tr").count()).toBeGreaterThan(0);
    const analysis = page.getByRole("region", { name: "Analysis of the trend" });
    await expect(analysis.getByTestId("mg-summary")).toContainText("Competitors are investing in R&D compute and data partnerships");
    const tops = await Promise.all([page.getByTestId("ta-time-table"), page.getByTestId("ta-cross-table"), analysis].map(async (l) => (await l.boundingBox())!.y));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    await expectAccessible(page, "Trend analysis for a Macrotrend");
    // A Subtrend narrows the tables and the analysis.
    await sub.selectOption("Computational Infrastructure");
    await expect(page).toHaveURL(/s=Computational\+Infrastructure/);
    await expect(analysis.getByRole("heading", { name: "Computational Infrastructure" })).toBeVisible();
    const narrowed = Number(/(\d+) signal/.exec((await page.getByTestId("ta-total").textContent()) ?? "")?.[1]);
    expect(narrowed).toBeLessThanOrEqual(all);
    // Collapse.
    await cell.click();
    await expect(page.getByTestId("ta-time-table")).toHaveCount(0);
  });

  test("Trend analysis: a competitor's signals over time and by Macrotrend, and its analysis (no dropdown)", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto("/competitors/analysis");
    const list = page.getByRole("list", { name: "Competitors" });
    await page.getByLabel("Find a competitor").fill("pfiz");
    await list.getByRole("button", { name: /^Pfizer/ }).click();
    await expect(page).toHaveURL(/c=Pfizer/);
    await expect(page.getByTestId("ta-subtrend")).toHaveCount(0);
    await page.getByTestId("ta-frame").selectOption("0");
    await expect(page.getByTestId("ta-cross-table").getByRole("columnheader", { name: "Macrotrend" })).toBeVisible();
    expect(await page.getByTestId("ta-cross-table").locator("tbody tr").count()).toBeGreaterThan(0);
    const analysis = page.getByRole("region", { name: "Analysis of the trend" });
    await expect(analysis.getByTestId("mg-summary")).toContainText("PfizerForAll");
    await expect(analysis.getByRole("button", { name: "Edit summary" })).toBeVisible();
    await expectAccessible(page, "Trend analysis for a competitor");
    // Into the knowledge graph.
    await analysis.getByRole("button", { name: "Open in the knowledge graph" }).click();
    await expect(page).toHaveURL(/\/competitors\?c=Pfizer/);
  });
});
