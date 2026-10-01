import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const H = { "x-dev-user": "l.griffith@example.com" };

/** Attach HTML pages to the first Secondary tracker entry without one; returns its id and code. */
async function entryWithPages(page: Page, names: string[]) {
  return page.evaluate(
    async ({ names, h }) => {
      const t = await (await fetch("/api/tracker?stream=secondary&from=2000-01-01&to=2100-01-01&pageSize=1000", { headers: h })).json();
      const row = t.rows.find((r: { hasSnapshot: boolean }) => !r.hasSnapshot);
      for (const n of names) {
        const f = new FormData();
        f.append("file", new File([`<html><head><title>${n}</title></head><body><article><h1>${n}</h1><p>Text of ${n}.</p></article></body></html>`], `${n}.html`, { type: "text/html" }));
        const r = await fetch(`/api/items/${row.id}/snapshot`, { method: "POST", headers: h, body: f });
        if (!r.ok) throw new Error(await r.text());
      }
      return { id: row.id as string, code: row.code as string, title: row.values.title as string };
    },
    { names, h: H },
  );
}

test.describe("request 18", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "analyst"));

  test("Tracker and Phantoms: Display all turns the pages into one long scrollable table", async ({ page }) => {
    for (const path of ["/tracker?stream=secondary", "/phantoms?stream=secondary"]) {
      await page.goto(path);
      const rows = page.locator("table.data tbody tr");
      await expect(rows).toHaveCount(10);
      const info = page.getByText(/^Showing 1–10 of (\d+)/);
      const total = Number(/of (\d+)/.exec(await info.innerText())![1]);
      expect(total).toBeGreaterThan(10);
      await page.getByTestId("display-all").click();
      await expect(page).toHaveURL(/all=1/);
      await expect(rows).toHaveCount(total);
      await expect(page.getByText(`Showing all ${total}`)).toBeVisible();
      await expect(page.getByRole("button", { name: "Next →" })).toHaveCount(0);
      // The table scrolls inside the card, with its header kept in view.
      const region = page.getByRole("region", { name: "All entries (scrollable)" });
      await region.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(rows.last()).toBeInViewport();
      await expectAccessible(page, `${path} · Display all`);
      await page.getByTestId("show-pages").click();
      await expect(rows).toHaveCount(10);
    }
  });

  test("several saved pages: the icon opens a list to pick from, and the pane switches between them", async ({ page }) => {
    await page.goto("/tracker?stream=secondary");
    const e = await entryWithPages(page, ["first-page", "second-page", "third-page"]);
    await page.goto(`/tracker?stream=secondary&all=1&q=${encodeURIComponent(e.title)}`);
    const btn = page.getByRole("button", { name: `3 saved pages for ${e.title}: choose one` }).first();
    await btn.click();
    const menu = page.getByRole("menu", { name: `Saved pages of ${e.title}` });
    await expect(menu.getByRole("menuitem")).toHaveText([/first-page/, /second-page/, /third-page/, /Attach another HTML page/]);
    await expectAccessible(page, "saved pages menu");
    await menu.getByRole("menuitem", { name: /second-page/ }).click();
    const pane = page.getByRole("dialog");
    await expect(pane).toContainText("Saved page 2 of 3");
    await expect(pane.frameLocator("iframe").getByText("Text of second-page.")).toBeVisible();
    await pane.getByRole("combobox", { name: "Saved page" }).selectOption({ label: "3. third-page" });
    await expect(pane.frameLocator("iframe").getByText("Text of third-page.")).toBeVisible();
    await expect(pane).toContainText("Saved page 3 of 3");
    await pane.getByRole("button", { name: "Close saved page" }).click();
    // A client can open them but not attach more.
    await signInAs(page, "client");
    await page.goto(`/tracker?stream=secondary&all=1&q=${encodeURIComponent(e.title)}`);
    await page.getByRole("button", { name: `3 saved pages for ${e.title}: choose one` }).first().click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveCount(3);
  });

  test("Megatrends: the summary sits at the top in large type; the timeline zooms, pans, resizes and minimises", async ({ page }) => {
    await page.goto(`/megatrends?m=${encodeURIComponent("AI Investment in R&D")}`);
    // Start from the default timeline size.
    await page.evaluate(() => localStorage.removeItem("eradigm.megatrends.timeline"));
    await page.reload();
    const panel = page.getByTestId("mg-panel");
    await expect(panel.getByTestId("mg-summary")).toContainText("Competitors are investing in R&D compute");
    const pb = (await panel.boundingBox())!;
    const stage = (await page.getByRole("region", { name: "Megatrends knowledge graph" }).boundingBox())!;
    expect(pb.y + pb.height).toBeLessThanOrEqual(stage.y + 1);
    expect(pb.width).toBeGreaterThan(stage.width - 2);
    expect(Number.parseFloat(await panel.getByTestId("mg-summary").evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);

    const tl = page.getByTestId("mg-timeline");
    const balls = tl.getByTestId("mg-ball");
    const all = await balls.count();
    await expect(tl.getByText("All dates")).toBeVisible();
    // Zoom in (button, then scroll), then drag to move across the dates.
    await tl.getByRole("button", { name: "Zoom in on the timeline" }).click();
    await tl.getByRole("button", { name: "Zoom in on the timeline" }).click();
    await expect(tl.getByText("All dates")).toHaveCount(0);
    const range1 = await tl.locator(".mg-tl-range").innerText();
    const plot = (await page.getByTestId("mg-tl-plot").boundingBox())!;
    await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2);
    await page.mouse.wheel(0, -300);
    await expect(tl.locator(".mg-tl-range")).not.toHaveText(range1);
    expect(await balls.count()).toBeLessThan(all);
    const range2 = await tl.locator(".mg-tl-range").innerText();
    await page.mouse.down();
    await page.mouse.move(plot.x + plot.width / 2 + 220, plot.y + plot.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(tl.locator(".mg-tl-range")).not.toHaveText(range2);
    await tl.getByRole("button", { name: "Reset" }).click();
    await expect(tl.getByText("All dates")).toBeVisible();
    await expect(balls).toHaveCount(all);

    // Resize from the bar (keyboard here), then minimise and restore; the size is remembered.
    const grip = page.getByRole("separator", { name: "Resize the timeline" });
    const h0 = (await tl.boundingBox())!.height;
    await grip.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
    await expect.poll(async () => (await tl.boundingBox())!.height).toBeGreaterThan(h0 + 60);
    await tl.getByTestId("mg-tl-toggle").click();
    await expect(page.getByTestId("mg-tl-plot")).toBeHidden();
    await expect.poll(async () => (await tl.boundingBox())!.height).toBeLessThan(90);
    await expectAccessible(page, "Megatrends with the timeline minimised");
    await page.reload();
    await expect(page.getByTestId("mg-tl-toggle")).toHaveText("▴ Show timeline");
    await expect(page.getByTestId("mg-tl-plot")).toBeHidden();
    await page.getByTestId("mg-tl-toggle").click();
    await expect(page.getByTestId("mg-tl-plot")).toBeVisible();
    await expectAccessible(page, "Megatrends");
  });
});
