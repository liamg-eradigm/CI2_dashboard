import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };

/** Secondary entries pushed to the Tracker through the API (as the admin); returns their ids. */
async function push(page: Page, rows: { title: string; impact: string }[]) {
  return page.evaluate(
    async ({ rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const ids: string[] = [];
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "secondary" }) })).json();
        const values = {
          ...item.draft,
          title: r.title,
          record_id: `S-37-${Math.random().toString(36).slice(2, 9)}`,
          date: "2026-09-30",
          macrotrend: "Geopolitics",
          subtrend: "IRA Pricing/Tariffs",
          growth: "Stable",
          impact: r.impact,
          source: "PR",
          competitors: ["Roche"],
          action: "Not Actioned",
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

test.describe("request 37", () => {
  for (const [w, h] of [
    [1366, 768],
    [1536, 864],
  ] as const) {
    test(`database tables scroll inside a box that fits a ${w}×${h} screen, the header row staying in view`, async ({ page }) => {
      await signInAs(page, "admin");
      await page.setViewportSize({ width: w, height: h });
      for (const url of ["/tracker?all=1", "/tracker?stream=primary", "/phantoms?all=1", "/analytics/primary", "/deliverables", "/trend-analyses"]) {
        await page.goto(url);
        const box = page.getByTestId(url === "/trend-analyses" ? "trend-analyses-table" : "table-scroll");
        const scroller = url === "/trend-analyses" ? box.locator("xpath=..") : box;
        await expect(scroller).toBeVisible();
        await scroller.scrollIntoViewIfNeeded();
        // (CI analyses may have no rows yet)
        if (url !== "/trend-analyses") await expect(scroller.locator("tbody tr").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        const card = scroller.locator("xpath=ancestor::section[1]");
        const hasBar = (await page.locator(".filterbar").count()) > 0;
        // The whole card sits below the sticky filter bar, and the box (so its horizontal scrollbar) is on screen.
        await expect
          .poll(async () => {
            await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
            const c = (await card.boundingBox())!;
            const b = (await scroller.boundingBox())!;
            const bar = hasBar ? await page.locator(".filterbar").boundingBox() : null;
            return c.y >= (bar ? bar.y + bar.height : 0) - 1 && c.y + c.height <= h + 1 && b.y + b.height <= h + 1;
          }, { message: url })
          .toBe(true);
        expect(await scroller.evaluate((el) => getComputedStyle(el).overflowY), url).toBe("auto");
      }
      // A long table scrolls inside its box, both ways, with its header row kept in view.
      await page.goto("/tracker?all=1");
      const box = page.getByTestId("table-scroll");
      await expect(box.locator("tbody tr").nth(20)).toBeAttached();
      expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(await box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      const head = box.locator("thead th").nth(3);
      const y0 = (await head.boundingBox())!.y;
      await box.evaluate((el) => el.scrollBy(0, 400));
      await expect.poll(async () => Math.abs((await head.boundingBox())!.y - y0)).toBeLessThan(2);
      await box.evaluate((el) => el.scrollBy(300, 0));
      expect(await box.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await expectAccessible(page, "Signals Database with the table scrolling in its box");
    });
  }

  test("Deliverables: analysts and admins delete alerts (the Phantom stays) and newsletters", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    const [gone, kept] = await push(page, [
      { title: `Alert to delete ${tag}`, impact: "High" },
      { title: `Alert to keep ${tag}`, impact: "High" },
    ]);
    // Alerts: tick, Delete selected, confirm.
    await page.goto(`/deliverables?stream=secondary&q=${tag}`);
    const table = page.getByTestId("table-scroll");
    const row = (t: string) => table.getByRole("row", { name: new RegExp(t) });
    await expect(row(`Alert to delete ${tag}`).getByRole("button", { name: /^Open the alert for/ })).toBeVisible();
    await row(`Alert to delete ${tag}`).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Delete selected" }).click();
    const dlg = page.getByTestId("delete-deliverables");
    await expect(dlg).toContainText("Delete this alert?");
    await expect(dlg).toContainText("Its Phantom stays");
    await expectAccessible(page, "Delete an alert");
    await dlg.getByRole("button", { name: "Delete alert" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(row(`Alert to delete ${tag}`)).toHaveCount(0);
    await expect(row(`Alert to keep ${tag}`)).toBeVisible();
    await page.reload();
    await expect(row(`Alert to keep ${tag}`)).toBeVisible();
    await expect(row(`Alert to delete ${tag}`)).toHaveCount(0);
    // Its Phantom stays.
    await page.goto(`/phantoms?stream=secondary&q=${tag}`);
    await expect(page.getByTestId("table-scroll").getByRole("row", { name: new RegExp(`Alert to delete ${tag}`) })).toBeVisible();

    // Newsletters: a delete button on each, with a confirmation.
    const name = `Newsletter ${tag}`;
    await page.evaluate(
      async ({ name, ids, h }) => {
        await fetch("/api/newsletters", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ name, itemIds: ids }) });
      },
      { name, ids: [gone, kept], h: ADMIN },
    );
    await page.goto("/deliverables?d=newsletter");
    const nl = page.getByTestId("newsletters");
    await expect(nl.getByText(name)).toBeVisible();
    await nl.getByRole("button", { name: `Delete newsletter ${name}` }).click();
    await expect(page.getByTestId("delete-deliverables")).toContainText("Delete this newsletter?");
    await page.getByTestId("delete-deliverables").getByRole("button", { name: "Delete newsletter" }).click();
    await expect(nl.getByText(name)).toHaveCount(0);
  });
});
