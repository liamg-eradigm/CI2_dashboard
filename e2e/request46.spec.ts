import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };

/** Entries pushed to a tracker through the API (as the admin). */
async function push(page: Page, stream: "primary" | "secondary", rows: Record<string, unknown>[]) {
  return page.evaluate(
    async ({ stream, rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const ids: string[] = [];
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream }) })).json();
        const values = { ...item.draft, macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", growth: "Stable", impact: "Medium", source: stream === "primary" ? "Primary Source" : "PR", competitors: ["Roche"], action: "Not Actioned", ...r };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
        ids.push(item.id);
      }
      return ids;
    },
    { stream, rows, h: ADMIN },
  );
}

/** Select `text` (the first time it appears) inside a formatted-text field. */
async function select(field: Locator, text: string) {
  await field.click();
  await field.evaluate((el, text) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent?.indexOf(text) ?? -1;
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + text.length);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    throw new Error(`“${text}” is not in the field`);
  }, text);
}

test.describe("request 46", () => {
  test("editing text boxes: highlight text to make it bold, underlined, larger or a title; shown formatted, plain in the table", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const [id] = await push(page, "secondary", [{ title: `Formatting ${tag}`, date: "2026-09-01", key_details: "Payers pushed back at first." }]);
    await page.goto(`/tracker?${new URLSearchParams({ q: tag })}`);
    await page.getByRole("button", { name: `Edit Formatting ${tag}` }).click();
    const drawer = page.getByRole("dialog");
    const field = drawer.getByRole("textbox", { name: "Key Details" });
    await expect(field).toHaveText("Payers pushed back at first.");
    const bar = page.getByTestId("format-bar");
    // The buttons only appear while text is highlighted in the field.
    await field.click();
    await expect(bar).toBeHidden();
    await select(field, "pushed back");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button")).toHaveText(["B", "U", "A−", "A+", "Title"]);
    await expectAccessible(page, "Formatting bar over selected text");
    await bar.getByTestId("fmt-bold").click();
    await expect(bar.getByTestId("fmt-bold")).toHaveAttribute("aria-pressed", "true");
    await bar.getByTestId("fmt-underline").click();
    await bar.getByTestId("fmt-larger").click();
    await bar.getByTestId("fmt-larger").click();
    await expect(bar).toContainText("130%");
    await expect(field.locator("strong")).toHaveText("pushed back");
    await expect(field.locator("u")).toHaveText("pushed back");
    await expect(field.locator('span[style*="font-size"]')).toHaveText("pushed back");
    // A title line, made larger (titles' size can be changed too).
    await field.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Next steps");
    await select(field, "Next steps");
    await bar.getByTestId("fmt-title").click();
    await bar.getByTestId("fmt-larger").click();
    await expect(field.locator("h3")).toHaveText("Next steps");
    await expect(field.locator('h3 span[style*="font-size"]')).toHaveText("Next steps");
    // Collapsing the selection hides the buttons again.
    await page.keyboard.press("End");
    await expect(bar).toBeHidden();
    await drawer.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(page.locator(".toast").last()).toContainText(/published|pushed|updated/i);

    // Stored as light markup...
    const v = await page.evaluate(async ({ id, h }) => (await (await fetch(`/api/signals/${id}`, { headers: h })).json()).values.key_details as string, { id: id!, h: ADMIN });
    expect(v).toBe('Payers <span style="font-size:1.3em"><u>**pushed back**</u></span> at first.\n### <span style="font-size:1.15em">Next steps</span>');
    // ...shown formatted in the record, as plain text in the table (the Database page shows every field).
    await page.goto(`/database?${new URLSearchParams({ "db.q": tag })}`);
    const row = page.locator("table.data tbody tr", { hasText: `Formatting ${tag}` });
    await expect(row).toContainText("Payers pushed back at first.");
    await expect(row).not.toContainText("**");
    await row.getByRole("button", { name: `Open record: Formatting ${tag}` }).click();
    const view = page.getByRole("dialog");
    await expect(view.locator(".rd-long strong")).toHaveText("pushed back");
    await expect(view.locator(".rd-long u")).toHaveText("pushed back");
    await expect(view.locator(".rd-long .rt-title")).toHaveText("Next steps");
    await expectAccessible(page, "Record with formatted text");
  });

  test("Full Discussion links only one conversation: the same source on the same Event Date", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const base = { source_role: `Head of Access ${tag}`, source_company: `Clinic ${tag}`, insight_topic: "Pricing" };
    await push(page, "primary", [
      { ...base, title: `Morning ${tag}`, date: "2026-09-01", key_intelligence_question: "Q1", key_details: "Morning answer." },
      { ...base, title: `Afternoon ${tag}`, date: "2026-09-01", key_intelligence_question: "Q2", key_details: "Afternoon answer." },
      { ...base, title: `Next month ${tag}`, date: "2026-10-01", key_intelligence_question: "Q3", key_details: "Next month's answer." },
    ]);
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    const table = page.getByTestId("table-scroll");
    const row = (t: string) => table.getByRole("row", { name: new RegExp(t) });
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await expect(row(`Next month ${tag}`).getByTestId("archived-cell")).toHaveCount(0);
    await row(`Morning ${tag}`).getByTestId("archived-cell").click();
    const panel = page.getByTestId("archived-panel");
    await expect(panel).toContainText("1 other answer in the same conversation");
    await expect(panel.locator("tbody tr")).toHaveCount(1);
    await expect(panel.locator("tbody tr")).toContainText("Afternoon answer.");
  });

  test("Primary Tracker: resizing the AI Summary never brings up a page scrollbar", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto("/dashboard");
    await page.evaluate(() => localStorage.removeItem("eradigm.ptr.aiSummaryHeight"));
    const tag = Math.random().toString(36).slice(2, 8);
    await push(
      page,
      "primary",
      Array.from({ length: 12 }, (_, i) => ({ title: `Row ${i} ${tag}`, date: "2026-09-01", source_role: "Lead", source_company: `Clinic ${tag}`, key_intelligence_question: `Q${i}` })),
    );
    await page.goto(`/analytics/primary?${new URLSearchParams({ "pt.source_company": `Clinic ${tag}` })}`);
    await expect(page.getByTestId("table-scroll").locator("tbody tr")).toHaveCount(10);
    // Watch every frame for a page scrollbar: it would narrow the page.
    await page.evaluate(() => {
      const w = window as unknown as { seen: { widths: Set<number>; over: number }; watching: boolean };
      w.seen = { widths: new Set(), over: 0 };
      w.watching = true;
      const tick = () => {
        setTimeout(() => {
          w.seen.widths.add(document.documentElement.clientWidth);
        }, 0);
        if (w.watching) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const g = (await page.getByTestId("ai-summary-grip").boundingBox())!;
    const x = g.x + g.width / 2;
    await page.mouse.move(x, g.y + g.height / 2);
    await page.mouse.down();
    // While dragging, the page itself does not scroll (the table follows the summary in the same frame).
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe("hidden");
    for (let dy = 0; dy <= 220; dy += 20) await page.mouse.move(x, g.y + g.height / 2 + dy, { steps: 3 });
    for (let dy = 220; dy >= -60; dy -= 20) await page.mouse.move(x, g.y + g.height / 2 + dy, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const seen = await page.evaluate(() => {
      const w = window as unknown as { seen: { widths: Set<number>; over: number }; watching: boolean };
      w.watching = false;
      return { widths: [...w.seen.widths] };
    });
    expect(seen.widths).toHaveLength(1);
    // Afterwards the page fits the window exactly, so no scrollbar comes back either.
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe("hidden");
  });
});
