import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };
const uid = () => Math.random().toString(36).slice(2, 8);

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
});
