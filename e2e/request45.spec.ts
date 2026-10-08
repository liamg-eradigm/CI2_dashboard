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
          date: `2026-0${1 + (i % 9)}-0${1 + (i % 7)}`,
          source_role: `Head of Access ${tag}`,
          source_company: `Clinic ${tag}`,
          insight_topic: "Pricing",
          key_intelligence_question: "Will payers cover it?",
          key_details: `Details ${i}.`,
          macrotrend: "Geopolitics",
          subtrend: "IRA Pricing/Tariffs",
          growth: "Stable",
          impact: "Medium",
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

test.describe("request 45", () => {
  test("Database: Source, Markdown, Alert, Newsletter and Edit are equal, narrow columns", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, tag, 2);
    await page.goto(`/database?${new URLSearchParams({ stream: "primary", "db.t.source_company": tag })}`);
    const table = page.getByTestId("table-scroll").locator("table");
    await expect(table.locator("tbody tr")).toHaveCount(2);
    const heads = table.locator("thead th.doc-col");
    await expect(heads).toHaveText(["Source", "Markdown", "Alert", "Newsletter", "Edit"]);
    const boxes = await heads.evaluateAll((ths) => ths.map((t) => t.getBoundingClientRect()).map((r) => ({ x: r.left, w: r.width })));
    for (const b of boxes) {
      expect(Math.abs(b.w - boxes[0]!.w)).toBeLessThan(1);
      expect(b.w).toBeLessThanOrEqual(90);
    }
    // Side by side, so the icons are evenly spaced.
    for (let i = 1; i < boxes.length; i++) expect(Math.abs(boxes[i]!.x - boxes[i - 1]!.x - boxes[0]!.w)).toBeLessThan(1);
    // The names still fit their columns.
    const overflow = await heads.evaluateAll((ths) => ths.some((t) => t.scrollWidth > t.clientWidth + 1));
    expect(overflow).toBe(false);
  });

  test("Primary Tracker: no note; the table is attached under the AI Summary and fills the window; drag the summary's edge to share the room", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    await page.evaluate(() => localStorage.removeItem("eradigm.ptr.aiSummaryHeight"));
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, tag, 12);
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    const scroll = page.getByTestId("table-scroll");
    await expect(scroll.locator("tbody tr")).toHaveCount(10);
    await expect(page.getByText("Approved entries from the Primary Inbox")).toHaveCount(0);
    await expect(page.locator(".stream-note")).toHaveCount(0);

    const summary = page.getByTestId("ai-summary");
    const card = scroll.locator("xpath=ancestor::section[1]");
    const layout = async () => {
      await page.waitForTimeout(250);
      const s = (await summary.boundingBox())!;
      const c = (await card.boundingBox())!;
      const t = (await scroll.boundingBox())!;
      return { summaryBottom: s.y + s.height, summaryHeight: s.height, cardTop: c.y, cardBottom: c.y + c.height, table: t.height };
    };
    const l = await layout();
    // Attached: no gap between the AI Summary and the table; the table's card runs to the bottom of the window.
    expect(Math.abs(l.cardTop - l.summaryBottom)).toBeLessThan(1.5);
    expect(Math.abs(l.cardBottom - 864)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(865);

    // Drag the summary's bottom edge down: it grows and the table shrinks by as much; still attached, still filling the window.
    const grip = page.getByTestId("ai-summary-grip");
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 100, { steps: 8 });
    await page.mouse.up();
    const down = await layout();
    expect(down.summaryHeight - l.summaryHeight).toBeGreaterThan(95);
    expect(l.table - down.table).toBeGreaterThan(95);
    expect(Math.abs(down.cardTop - down.summaryBottom)).toBeLessThan(1.5);
    expect(Math.abs(down.cardBottom - 864)).toBeLessThan(2);

    // Up again past where it started: shorter summary, taller table.
    const g2 = (await grip.boundingBox())!;
    await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
    await page.mouse.down();
    await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2 - 150, { steps: 8 });
    await page.mouse.up();
    const up = await layout();
    expect(up.summaryHeight).toBeLessThan(l.summaryHeight);
    expect(up.table).toBeGreaterThan(l.table);
    expect(Math.abs(up.cardBottom - 864)).toBeLessThan(2);

    // The keyboard too; the size is remembered after a reload.
    await grip.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const kb = await layout();
    expect(kb.summaryHeight - up.summaryHeight).toBeGreaterThan(40);
    await expect(grip).toHaveAttribute("role", "separator");
    await expectAccessible(page, "Primary Tracker filling the window");
    await page.reload();
    await expect(scroll.locator("tbody tr")).toHaveCount(10);
    const again = await layout();
    expect(Math.abs(again.summaryHeight - kb.summaryHeight)).toBeLessThan(2);
    // Double-click: back to its natural height.
    await grip.dblclick();
    const natural = await layout();
    expect(Math.abs(natural.summaryHeight - l.summaryHeight)).toBeLessThan(2);
    expect(Math.abs(natural.cardBottom - 864)).toBeLessThan(2);
  });
});
