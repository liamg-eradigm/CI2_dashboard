import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };

/** Primary entries from one source, pushed to the Tracker through the API (as the admin). */
async function push(page: Page, tag: string, n: number) {
  await page.evaluate(
    async ({ tag, n, h }) => {
      const j = { ...h, "content-type": "application/json" };
      for (let i = 0; i < n; i++) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "primary" }) })).json();
        const values = {
          ...item.draft,
          title: `Answer ${i} ${tag}`,
          // One conversation (request 46): the same source on the same Event Date.
          date: "2026-09-01",
          source_role: `Head of Access ${tag}`,
          source_company: `Clinic ${tag}`,
          insight_topic: "Pricing",
          key_intelligence_question: "Will payers cover it?",
          key_details: `Details ${i}.`,
          macrotrend: "Geopolitics",
          subtrend: "IRA Pricing/Tariffs",
          growth: "Stable",
          impact: i % 2 ? "Medium" : "High",
          source: "Primary Source",
          competitors: ["Roche"],
          action: "Not Actioned",
        };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
      }
    },
    { tag, n, h: ADMIN },
  );
}

/** The table's card is at most 80% of the window below the sticky filters (and anything stuck under them). */
async function expectEightyPercent(page: Page) {
  await page.waitForTimeout(300);
  const { card, room } = await page.getByTestId("table-scroll").evaluate((el) => {
    const bar = document.querySelector(".filterbar")!.getBoundingClientRect().height;
    const stuck = [...document.querySelectorAll("[data-sticky-under]")].reduce((h, x) => h + x.getBoundingClientRect().height, 0);
    return { card: el.closest(".card")!.getBoundingClientRect().height, room: window.innerHeight - bar - stuck - 24 };
  });
  expect(card).toBeLessThanOrEqual(room * 0.8 + 2);
  expect(card).toBeGreaterThan(room * 0.7);
}

test.describe("request 44", () => {
  test("Database: the four document columns are equal and their icons centred; the table takes 80% of the room", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, tag, 12);
    await page.goto(`/database?${new URLSearchParams({ stream: "primary", "db.t.source_company": tag })}`);
    const table = page.getByTestId("table-scroll").locator("table");
    await expect(table.locator("tbody tr")).toHaveCount(10);
    const heads = table.locator("thead th.doc-col");
    // Request 45: Edit is one of them too.
    await expect(heads).toHaveText(["Source", "Markdown", "Alert", "Newsletter", "Edit"]);
    const widths = await heads.evaluateAll((ths) => ths.map((t) => t.getBoundingClientRect().width));
    for (const w of widths) expect(Math.abs(w - widths[0]!)).toBeLessThan(1);
    // Each icon sits in the middle of its column, so the icons are evenly spaced.
    const row = table.locator("tbody tr").first();
    const centres = await row.locator("td.doc-col").evaluateAll((tds) =>
      tds.map((td) => {
        const c = td.getBoundingClientRect();
        const icon = (td.querySelector("button, .src-none") as HTMLElement).getBoundingClientRect();
        return { cell: c.left + c.width / 2, icon: icon.left + icon.width / 2 };
      }),
    );
    for (const c of centres) expect(Math.abs(c.cell - c.icon)).toBeLessThan(2);
    await expectEightyPercent(page);
  });

  test("Primary Tracker: the AI Summary keeps lines and nested bullets, attached under the filters", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, tag, 12);
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    const table = page.getByTestId("table-scroll");
    await expect(table.locator("tbody tr")).toHaveCount(10);

    await table.getByRole("row", { name: new RegExp(`Answer 8 ${tag}`) }).getByTestId("archived-cell").click();
    const box = page.getByTestId("ai-summary");
    await box.getByRole("button", { name: "Write the summary" }).click();
    const field = box.getByLabel(/AI Summary of this Full Discussion/);
    await field.click();
    // Enter keeps a new line; Tab and Shift+Tab nest bullets.
    await page.keyboard.type("Payers pushed back, then accepted it.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A second line.");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- Pricing");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Rejections fell");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("New evidence");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.type("Uptake");
    // A formatted-text field (request 46): real nested lists as it is typed.
    await expect(field.locator("> p")).toHaveText(["Payers pushed back, then accepted it.", "A second line.", ""]);
    await expect(field.locator("> ul > li > p")).toHaveText(["Pricing", "Uptake"]);
    await expect(field.locator("> ul > li > ul > li > ul > li")).toHaveText(["New evidence"]);
    await box.getByRole("button", { name: "Save", exact: true }).click();
    const text = box.getByTestId("ai-summary-text");
    await expect(text.locator("> p")).toHaveCount(1);
    await expect(text.locator("> p br")).toHaveCount(1);
    await expect(text.locator("> ul > li")).toHaveCount(2);
    await expect(text.locator("> ul > li > ul > li")).toHaveText("Rejections fellNew evidence");
    await expect(text.locator("> ul > li > ul > li > ul > li")).toHaveText("New evidence");
    expect(await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
    // Kept as typed: after a reload, the same structure.
    await page.reload();
    await expect(page.getByTestId("ai-summary-text").locator("> ul > li > ul > li > ul > li")).toHaveText("New evidence");
    await expectAccessible(page, "AI Summary with nested bullets");

    // Attached to the bottom of the filters (sticky; request 45 makes the page fit the window, so it rarely scrolls).
    const bar = (await page.locator(".filterbar").boundingBox())!;
    const b = (await page.getByTestId("ai-summary").boundingBox())!;
    expect(Math.abs(b.y - (bar.y + bar.height))).toBeLessThan(2);
    expect(await page.getByTestId("ai-summary").evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  });
});
