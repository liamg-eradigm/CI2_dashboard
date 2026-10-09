import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };

/** Entries pushed to a tracker through the API (as the admin). */
async function push(page: Page, stream: "primary" | "secondary", rows: Record<string, unknown>[]) {
  return page.evaluate(
    async ({ stream, rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream }) })).json();
        const values = { ...item.draft, macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", growth: "Stable", impact: "Medium", source: stream === "primary" ? "Primary Source" : "PR", competitors: ["Roche"], action: "Not Actioned", ...r };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
      }
    },
    { stream, rows, h: ADMIN },
  );
}

const nav = (page: Page) => page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" });

/** Request 51: Generate Newsletter asks for each entry's section first; put them all in Technology and confirm. */
async function placeAll(page: Page) {
  const dialog = page.getByTestId("newsletter-sections");
  await expect(dialog).toBeVisible();
  for (const b of await dialog.getByTestId("nl-sec-technology").all()) await b.click();
  await dialog.getByTestId("nl-confirm").click();
  await expect(dialog).toHaveCount(0);
}

test.describe("request 43", () => {
  test("Database: a tab of its own with Primary, Secondary and CI Analysis; every field, Source, Markdown, Alert and Newsletter; filters on every field", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, "primary", [
      { title: `High ${tag}`, date: "2026-05-01", impact: "High", source_company: `Clinic ${tag}`, source_location: "Lyon", workstream: "Digital and Data Platforms" },
      { title: `Low ${tag}`, date: "2026-06-01", impact: "Low", source_company: `Clinic ${tag}`, source_location: "Paris" },
    ]);
    // A tab of its own: a link, no group to open (request 48: the other databases are gone, it has them all).
    const link = nav(page).getByRole("link", { name: "Database", exact: true });
    await expect(nav(page).getByRole("button", { name: /^Database\b/ })).toHaveCount(0);
    await expect(nav(page).getByRole("button", { name: /^Databases\b/ })).toHaveCount(0);
    await link.click();
    await expect(page).toHaveURL(/\/database$/);
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "Database" })).toBeVisible();

    await page.getByTestId("stream-primary").click();
    // Filters on every field (hidden at first since request 48): one row at first, all of them on demand.
    const bar = page.getByTestId("db-filters");
    if (!(await bar.isVisible())) await page.getByTestId("filters-toggle").click();
    await expect(bar.getByLabel("Source Company contains")).toHaveCount(0);
    await bar.getByRole("button", { name: /All filters/ }).click();
    await bar.getByLabel("Source Company contains").fill(tag);
    const table = page.getByTestId("table-scroll").locator("table");
    const row = (t: string) => table.getByRole("row", { name: new RegExp(t) });
    await expect(row(`High ${tag}`)).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(2);
    // Every Primary field (Source Location and Workstream are in neither the Tracker nor the Phantoms table), then the four document columns.
    const heads = (await table.locator("thead th").allTextContents()).map((h) => h.replace(/[↓↑]/g, "").trim());
    for (const h of ["Source", "Markdown", "Alert", "Newsletter", "Source Location", "Workstream", "Key Intelligence Question", "Key Metrics", "Impact"]) expect(heads).toContain(h);
    expect(heads.indexOf("Source")).toBeLessThan(heads.indexOf("Markdown"));
    expect(heads.indexOf("Markdown")).toBeLessThan(heads.indexOf("Alert"));
    expect(heads.indexOf("Alert")).toBeLessThan(heads.indexOf("Newsletter"));
    await expect(row(`High ${tag}`)).toContainText("Lyon");
    // Every Primary entry is a Phantom (Markdown); request 51: every entry has an alert.
    await expect(row(`High ${tag}`).getByRole("button", { name: `Open Markdown for High ${tag}` })).toBeVisible();
    await expect(row(`High ${tag}`).getByRole("button", { name: `Open the alert for High ${tag}` })).toBeVisible();
    await expect(row(`Low ${tag}`).getByRole("button", { name: `Open the alert for Low ${tag}` })).toBeVisible();
    await row(`High ${tag}`).getByRole("button", { name: `Open the alert for High ${tag}` }).click();
    await expect(page.getByRole("dialog").getByText("Alert", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close document" }).click();
    await row(`Low ${tag}`).getByRole("button", { name: `Open Markdown for Low ${tag}` }).click();
    await expect(page.getByRole("dialog")).toContainText(`Low ${tag}`);
    await page.keyboard.press("Escape");
    await expectAccessible(page, "Database page");

    // A field that is in no other table filters too.
    await bar.getByLabel("Source Location contains").fill("lyon");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(row(`High ${tag}`)).toBeVisible();
    await expect(page.getByRole("region", { name: "Active filters" })).toContainText("Source Location: contains “lyon”");
    await page.getByRole("button", { name: "Clear Source Location filter" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await expectAccessible(page, "Database filters, all open");

    // CI Analysis: the CI analyses database as it is, with no filter menu; back to the trackers.
    await page.getByTestId("db-ci").click();
    await expect(page.getByTestId("trend-analyses")).toBeVisible();
    await expect(page.getByTestId("db-filters")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "CI analyses" })).toBeVisible();
    await expectAccessible(page, "Database: CI Analysis");
    await page.getByTestId("stream-secondary").click();
    await expect(page.getByTestId("db-filters")).toBeVisible();
    await expect(page).not.toHaveURL(/db=ci/);
  });

  test("Database: Generate Newsletter from two or more ticked rows; it is attached to each, and several are offered in a menu", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, "secondary", [
      { title: `First ${tag}`, date: "2026-05-01", publisher: `Pub ${tag}` },
      { title: `Second ${tag}`, date: "2026-06-01", publisher: `Pub ${tag}` },
      { title: `Third ${tag}`, date: "2026-07-01", publisher: `Pub ${tag}` },
    ]);
    await page.goto(`/database?${new URLSearchParams({ "db.t.publisher": tag })}`);
    const table = page.getByTestId("table-scroll").locator("table");
    const row = (t: string) => table.getByRole("row", { name: new RegExp(t) });
    await expect(table.locator("tbody tr")).toHaveCount(3);
    const generate = page.getByTestId("generate-newsletter");
    await expect(generate).toHaveCount(0);
    await row(`First ${tag}`).getByRole("checkbox").check();
    // One ticked row is not enough.
    await expect(generate).toHaveCount(0);
    await row(`Second ${tag}`).getByRole("checkbox").check();
    await expect(generate).toBeVisible();
    // Request 53: in the table's top bar, beside Export.
    const g = (await generate.boundingBox())!;
    const s = (await page.getByRole("button", { name: "Export" }).boundingBox())!;
    expect(Math.abs(g.y + g.height / 2 - (s.y + s.height / 2))).toBeLessThan(6);
    expect(g.x).toBeLessThan(s.x);
    await generate.click();
    await placeAll(page);
    await expect(page.getByText(/Generated “Newsletter · .*” from 2 entries/).first()).toBeVisible();
    await expect(generate).toHaveCount(0);
    await expect(row(`First ${tag}`).getByTestId("newsletter-cell")).toBeVisible();
    await expect(row(`Second ${tag}`).getByTestId("newsletter-cell")).toBeVisible();
    await expect(row(`Third ${tag}`).getByTestId("newsletter-cell")).toHaveCount(0);
    await expect(row(`First ${tag}`).getByTestId("newsletter-cell").locator('svg[data-icon="newspaper"]')).toHaveCount(1);
    // One newsletter: opens straight away, listing the ticked entries' titles.
    await row(`First ${tag}`).getByTestId("newsletter-cell").click();
    const pane = page.getByRole("dialog");
    await expect(pane.getByText("Newsletter", { exact: true })).toBeVisible();
    await expect(pane.locator(".docx-host")).toContainText(`First ${tag}`);
    await expect(pane.locator(".docx-host")).toContainText(`Second ${tag}`);
    await expect(pane.locator(".docx-host")).not.toContainText(`Third ${tag}`);
    await page.getByRole("button", { name: "Close document" }).click();

    // A second newsletter with Second and Third: Second is now in two, chosen from a menu.
    await row(`Second ${tag}`).getByRole("checkbox").check();
    await row(`Third ${tag}`).getByRole("checkbox").check();
    await generate.click();
    await placeAll(page);
    await expect(row(`Third ${tag}`).getByTestId("newsletter-cell")).toBeVisible();
    const cell = row(`Second ${tag}`).getByTestId("newsletter-cell");
    await expect(cell).toHaveAttribute("aria-haspopup", "menu");
    await cell.click();
    const menu = page.getByRole("menu", { name: `Newsletters that use Second ${tag}` });
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    await expectAccessible(page, "Database: newsletter menu");
    await menu.getByRole("menuitem").first().click();
    await expect(page.getByRole("dialog").locator(".docx-host")).toContainText(`Third ${tag}`);
    await page.getByRole("button", { name: "Close document" }).click();
    // It is in the newsletters list too (Database → Newsletter, request 52).
    const all = await page.evaluate(async (h) => (await (await fetch("/api/newsletters", { headers: h })).json()) as { items: { title: string }[] }[], ADMIN);
    expect(all.some((n) => n.items.some((i) => i.title === `Third ${tag}`))).toBe(true);
  });

  test("Primary Tracker: an AI Summary above the table, for the open Full Discussion or KIQ Archive, edited by admins", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const base = { source_role: `Head of Access ${tag}`, source_company: `Clinic ${tag}`, insight_topic: "Pricing" };
    await push(page, "primary", [
      // One conversation (request 46): the same source on the same Event Date.
      { ...base, title: `Oldest ${tag}`, date: "2026-09-01", key_intelligence_question: "Will payers cover it?", key_details: "Oldest details." },
      { ...base, title: `Newest ${tag}`, date: "2026-09-01", key_intelligence_question: "Will payers cover it?", key_details: "Newest details." },
    ]);
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    const box = page.getByTestId("ai-summary");
    // Below the filters, above the Primary Signals table.
    await expect(box).toContainText("Open a Full Discussion");
    const b = (await box.boundingBox())!;
    const filters = (await page.getByTestId("ptr-filters").boundingBox())!;
    const table = page.getByTestId("table-scroll");
    expect(b.y).toBeGreaterThanOrEqual(filters.y + filters.height - 1);
    expect(b.y + b.height).toBeLessThanOrEqual((await table.boundingBox())!.y);
    // Large, legible text.
    const size = await box.locator(".ai-summary-text").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(17);

    const row = table.getByRole("row", { name: new RegExp(`Newest ${tag}`) });
    await row.getByTestId("archived-cell").click();
    await expect(box.getByRole("heading", { name: /AI Summary · Full Discussion/ })).toBeVisible();
    await expect(box).toContainText("No summary yet");
    await box.getByRole("button", { name: "Write the summary" }).click();
    await box.getByLabel(/AI Summary of this Full Discussion/).fill("Payers pushed back at first.\n\nThey accept it now.");
    await box.getByRole("button", { name: "Save", exact: true }).click();
    await expect(box.getByTestId("ai-summary-text").locator("p")).toHaveText(["Payers pushed back at first.", "They accept it now."]);
    await expect(box).toContainText("Written by E. Admin");
    const fontSize = await box.getByTestId("ai-summary-text").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(18);
    await expectAccessible(page, "Primary Tracker AI Summary");

    // The KIQ Archive has its own summary.
    await page.getByTestId("archived-panel").getByRole("button", { name: "Close Archived Responses" }).click();
    await page.keyboard.press("Escape");
    await row.getByTestId("kiq-cell").click();
    await expect(box.getByRole("heading", { name: /AI Summary · KIQ Archive/ })).toBeVisible();
    await expect(box).toContainText("No summary yet");

    // Clients read it but cannot edit it.
    await signInAs(page, "client");
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    await page.getByTestId("table-scroll").getByRole("row", { name: new RegExp(`Newest ${tag}`) }).getByTestId("archived-cell").click();
    await expect(box.getByTestId("ai-summary-text")).toContainText("They accept it now.");
    await expect(box.getByRole("button", { name: /Edit|Write/ })).toHaveCount(0);
  });

  test("Administration: the instructions for the AI Summary", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/admin");
    const set = page.getByTestId("discussion-summary-settings");
    const field = set.getByLabel("Instructions for the AI Summary");
    await expect(field).toHaveValue(/Summarise the total information from all the sources through an enterprise strategic lens/);
    await field.fill("Summarise in two sentences for a board member.");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved").first()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("discussion-summary-settings").getByLabel("Instructions for the AI Summary")).toHaveValue("Summarise in two sentences for a board member.");
    await page.getByTestId("discussion-summary-settings").getByRole("button", { name: "Use the usual instructions" }).click();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved").first()).toBeVisible();
    await expectAccessible(page, "Administration with the AI Summary instructions");
  });
});
