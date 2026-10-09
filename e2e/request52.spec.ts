import { expect, expectAccessible, menuOf, navOf, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };

/** Secondary entries pushed to the Tracker and made into a newsletter through the API (as the admin); returns the newsletter's id. */
async function newsletterOf(page: Page, titles: string[]) {
  return page.evaluate(
    async ({ titles, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const ids: string[] = [];
      for (const title of titles) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "secondary" }) })).json();
        const values = { ...item.draft, title, date: "2026-09-30", macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", growth: "Stable", impact: "Low", source: "PR", competitors: ["Roche"], action: "Not Actioned" };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
        ids.push(item.id);
      }
      const sections = Object.fromEntries(ids.map((id) => [id, "technology"]));
      const n = await (await fetch("/api/newsletters/generate", { method: "POST", headers: j, body: JSON.stringify({ itemIds: ids, sections }) })).json();
      return { id: n.id as string, name: n.name as string };
    },
    { titles, h: ADMIN },
  );
}

test.describe("request 52", () => {
  test("Admin is one tab (no Deliverables), named Admin", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    expect(await menuOf(page)).toEqual(["Inputs: Input, Eradigm Inbox, Client Inbox", "Analytics: Megatrends Dashboard, Knowledge Graph, Primary Tracker", "Database", "Admin"]);
    const nav = navOf(page);
    await expect(nav.getByRole("button", { name: /^Admin\b/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /Deliverables|Administration/ })).toHaveCount(0);
    await nav.getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Admin", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Admin", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(/^Admin\b/);
  });

  test("Database → Newsletter, the fourth toggle: every newsletter, opened, downloaded and deleted there; /deliverables leads to it", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const n = await newsletterOf(page, [`NL one ${tag}`, `NL two ${tag}`]);

    await page.goto("/database");
    const toggle = page.getByRole("group", { name: "Database to show" });
    await expect(toggle.getByRole("button")).toHaveText(["Primary Tracker", "Secondary Tracker", "CI Analysis", "Newsletter"]);
    await toggle.getByRole("button", { name: "Newsletter" }).click();
    await expect(page).toHaveURL(/[?&]db=newsletters/);
    await expect(toggle.getByRole("button", { name: "Newsletter" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { level: 1, name: "Database" })).toBeVisible();
    const list = page.getByTestId("newsletters");
    await expect(list.locator("thead th")).toHaveText([/Newsletter/i, /Name/i, /Entries used/i, /Delete/i]);
    // Newest first: the one just made leads, with the entries it uses.
    const first = list.locator("tbody tr").first();
    await expect(first).toContainText(n.name);
    await expect(first.locator(".nl-items li")).toHaveCount(2);
    await expect(first.locator(".nl-items")).toContainText(`NL one ${tag}`);
    await expectAccessible(page, "Database → Newsletter");

    // It opens as a side pane (the newsletter template) and downloads.
    await first.getByRole("button", { name: `Open newsletter ${n.name}` }).click();
    const pane = page.getByRole("dialog", { name: n.name });
    await expect(pane.locator(".docx-host")).toContainText(`NL one ${tag}`, { timeout: 15_000 });
    const [download] = await Promise.all([page.waitForEvent("download"), pane.getByRole("button", { name: "Download .docx" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.docx$/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Deleted after a confirmation.
    await first.getByRole("button", { name: `Delete newsletter ${n.name}` }).click();
    const dlg = page.getByTestId("delete-deliverables");
    await expect(dlg).toContainText("Delete this newsletter?");
    await dlg.getByRole("button", { name: "Delete newsletter" }).click();
    await expect(list.getByText(n.name)).toHaveCount(0);

    // Back to a tracker, then the old Deliverables address.
    await toggle.getByRole("button", { name: "Secondary Tracker" }).click();
    await expect(page).not.toHaveURL(/db=/);
    await expect(page.getByTestId("table-scroll")).toBeVisible();
    await page.goto("/deliverables");
    await expect(page).toHaveURL(/\/database\?db=newsletters$/);
    await expect(page.getByTestId("db-newsletters-page")).toBeVisible();
  });
});
