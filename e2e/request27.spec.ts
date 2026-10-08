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
  test("Primary entries from the same source: flagged while entered", async ({ page }) => {
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

    // Request 48: the 🔗 Linked column went with the Signals and Phantoms Databases; the Primary Tracker's
    // Full Discussion and KIQ Archive link answers from the same source (requests 34 and 46).
    await page.goto(`/database?${new URLSearchParams({ stream: "primary", "db.q": tag })}`);
    await expect(page.locator("table.data tbody tr")).toHaveCount(3);
    await expect(page.locator("table.data").getByRole("columnheader", { name: "Linked" })).toHaveCount(0);
  });
});
