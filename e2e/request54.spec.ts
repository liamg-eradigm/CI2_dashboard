import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };

/** Entries pushed to a tracker through the API (as the admin). */
async function push(page: Page, stream: "primary" | "secondary", rows: Record<string, unknown>[]) {
  return page.evaluate(
    async ({ stream, rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const ids: string[] = [];
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream }) })).json();
        const values = { ...item.draft, record_id: `S-R54-${Math.random().toString(36).slice(2, 9)}`, date: "2026-09-30", macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", growth: "Stable", impact: "Low", source: "PR", competitors: ["Roche"], action: "Not Actioned", ...r };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
        ids.push(item.id);
      }
      return ids;
    },
    { stream, rows, h: ADMIN },
  );
}

test.describe("request 54", () => {
  test("Generate Newsletter: the section chosen for a signal glows in the platform's cyan", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, "secondary", [
      { title: `Glow one ${tag}`, publisher: `Pub ${tag}` },
      { title: `Glow two ${tag}`, publisher: `Pub ${tag}` },
    ]);
    await page.goto(`/database?${new URLSearchParams({ "db.t.publisher": tag })}`);
    const table = page.getByTestId("table-scroll").locator("table");
    await expect(table.locator("tbody tr")).toHaveCount(2);
    for (const t of ["one", "two"]) await table.getByRole("row", { name: new RegExp(`Glow ${t} ${tag}`) }).getByRole("checkbox").check();
    await page.getByTestId("generate-newsletter").click();
    const dialog = page.getByRole("dialog", { name: "Generate newsletter" });
    const group = dialog.getByRole("radiogroup", { name: `Section for Glow one ${tag}` });
    const people = group.getByRole("radio", { name: "People" });
    const tech = group.getByRole("radio", { name: "Technology" });
    const look = (l: typeof people) => l.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, glow: getComputedStyle(el).boxShadow }));
    const before = await look(people);
    await people.click();
    await expect(people).toHaveAttribute("aria-checked", "true");
    const after = await look(people);
    expect(after.bg).toBe("rgb(61, 195, 201)");
    expect(after.glow).toContain("rgba(61, 195, 201");
    expect(after.bg).not.toBe(before.bg);
    // The others in the row stay plain.
    expect((await look(tech)).bg).not.toBe("rgb(61, 195, 201)");
    await expectAccessible(page, "Generate newsletter with a section chosen");
  });

  test("a Macrotrend's knowledge graph says how to use it under its name; the Competitors' graph does not", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/analytics/megatrends?${new URLSearchParams({ m: "Geopolitics", v: "3" })}`);
    const graph = page.getByTestId("md-graph");
    const crumbs = graph.locator(".mg-crumbs");
    const hint = crumbs.getByTestId("mg-hint");
    await expect(hint).toHaveText("Select a Subtrend to explore signals in this space");
    // In the same box, just below the Macrotrend's name.
    // (Both measured at once: the dashboard may still be sliding to its last row.)
    const { gap, inside } = await crumbs.evaluate((box) => {
      const name = box.querySelector("button")!.getBoundingClientRect();
      const h = box.querySelector(".mg-hint")!.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return { gap: h.top - name.bottom, inside: h.bottom <= b.bottom && h.left >= b.left && h.right <= b.right };
    });
    expect(gap).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThan(20);
    expect(inside).toBe(true);
    await page.goto("/competitors");
    await expect(page.locator(".mg-stage")).toBeVisible();
    await expect(page.getByTestId("mg-hint")).toHaveCount(0);
  });

  test("Database: a row turns blue on hover and opens every field in full from the right, bullets kept", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, "secondary", [
      {
        title: `Full text ${tag}`,
        publisher: `Pub ${tag}`,
        key_details: "Opening line of the details.\n- First point\n  - A sub-point\n- Second point",
        ci_perspective: "A long view that should be read in full.",
      },
    ]);
    await page.goto(`/database?${new URLSearchParams({ "db.t.publisher": tag })}`);
    const row = page.getByTestId("table-scroll").getByRole("row", { name: new RegExp(`Full text ${tag}`) });
    await expect(row).toBeVisible();
    const cell = row.locator("td").nth(7);
    const plain = await cell.evaluate((el) => getComputedStyle(el).backgroundColor);
    await cell.hover();
    await expect.poll(() => cell.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(plain);
    expect(await cell.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(234, 247, 248)");
    expect(await row.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");

    await cell.click();
    await expect(page).toHaveURL(/[?&]row=/);
    const pane = page.getByTestId("entry-fields");
    await expect(pane).toBeVisible();
    await expect(pane.getByRole("heading", { name: `Full text ${tag}` })).toBeVisible();
    // From the right, the height of the window.
    const box = (await pane.boundingBox())!;
    expect(Math.round(box.x + box.width)).toBe(1440);
    expect(Math.round(box.height)).toBe(900);
    // One field per row, in the table's order; long text keeps its bullets (nested too).
    const rows = pane.locator(".ef-row");
    expect(await rows.count()).toBeGreaterThan(8);
    await expect(pane.getByTestId("ef-title").locator("dd")).toHaveText(`Full text ${tag}`);
    const details = pane.getByTestId("ef-key_details").locator("dd");
    await expect(details).toContainText("Opening line of the details.");
    await expect(details.locator("ul > li")).toHaveCount(3);
    await expect(details.locator("ul ul > li")).toHaveText(["A sub-point"]);
    await expect(pane.getByTestId("ef-ci_perspective").locator("dd")).toHaveText("A long view that should be read in full.");
    await expectAccessible(page, "Database: an entry's fields in full");
    // Open record goes on to the full record; Escape closes.
    await pane.getByRole("button", { name: "Open record" }).click();
    await expect(page.getByTestId("entry-fields")).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Close record" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await cell.click();
    await expect(page.getByTestId("entry-fields")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("entry-fields")).toHaveCount(0);
    // Buttons in a row still do their own thing (the Markdown, not the fields).
    await row.getByRole("button", { name: new RegExp(`Open Markdown for Full text ${tag}`) }).click();
    await expect(page.getByTestId("entry-fields")).toHaveCount(0);
  });
});
