import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };
const uid = () => Math.random().toString(36).slice(2, 8);

function tmpFile(name: string, text: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
  const file = path.join(dir, name);
  writeFileSync(file, text);
  return file;
}

/** Secondary entries pushed to the Tracker through the API (as the admin), naming the given competitors. */
async function pushEntries(page: Page, rows: { title: string; competitors: string[]; impact: string; page?: string }[]) {
  return page.evaluate(
    async ({ rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const schema = await (await fetch("/api/schema?stream=secondary", { headers: h })).json();
      const have = new Set<string>(schema.columns.find((c: { key: string }) => c.key === "competitors").options);
      for (const name of new Set(rows.flatMap((r) => r.competitors)))
        if (!have.has(name)) await fetch("/api/schema/columns/competitors/options?stream=secondary", { method: "POST", headers: j, body: JSON.stringify({ value: name }) });
      const ids: string[] = [];
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "secondary" }) })).json();
        const values = {
          ...item.draft,
          record_id: `S-C-${Math.random().toString(36).slice(2, 9)}`,
          title: r.title,
          date: "2026-09-12",
          macrotrend: "Geopolitics",
          subtrend: "IRA Pricing/Tariffs",
          growth: "Stable",
          impact: r.impact,
          source: "PR",
          competitors: r.competitors,
          action: "Not Actioned",
        };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
        if (r.page) {
          const fd = new FormData();
          fd.append("file", new File([r.page], "lilly-page.html", { type: "text/html" }));
          const up = await fetch(`/api/items/${item.id}/snapshot`, { method: "POST", headers: h, body: fd });
          if (!up.ok) throw new Error(await up.text());
        }
        ids.push(item.id);
      }
      return ids;
    },
    { rows, h: ADMIN },
  );
}

test.describe("request 23", () => {
  test("a chosen file can be removed before it is sent (Add a source and Import)", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/input");
    const src = page.getByTestId("source-card");
    await src.locator('input[type="file"]').setInputFiles(tmpFile("to-remove.html", "<html><body><p>x</p></body></html>"));
    await expect(src.getByTestId("drop-zone-html")).toContainText("to-remove.html");
    await src.getByRole("button", { name: "Remove to-remove.html" }).click();
    await expect(src.getByTestId("drop-zone-html")).not.toContainText("to-remove.html");
    await expect(src.getByRole("button", { name: /^Remove / })).toHaveCount(0);

    const imp = page.getByTestId("import-card");
    await imp.locator('input[type="file"]').setInputFiles(tmpFile("sheet.csv", "Title\nOne\n"));
    await expect(imp.getByTestId("drop-zone-import")).toContainText("sheet.csv");
    await imp.getByRole("button", { name: "Remove sheet.csv" }).click();
    await expect(imp.getByTestId("drop-zone-import")).toContainText("Drag and drop a spreadsheet here");
    await expect(imp.getByRole("alert")).toHaveCount(0);
    await expectAccessible(page, "Input after removing files");
  });

  test("Megatrends: the summary and list are on the left, and the bar between them drags", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/megatrends");
    await page.evaluate(() => localStorage.removeItem("eradigm.megatrends.split"));
    await page.reload();
    const panel = page.getByTestId("mg-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByText("Knowledge graph", { exact: true })).toHaveCount(0);
    const stage = (await page.locator(".mg-stage").boundingBox())!;
    const rail = page.locator("#megatrends-rail");
    let p = (await panel.boundingBox())!;
    let r = (await rail.boundingBox())!;
    expect(p.x - stage.x).toBeLessThan(40);
    expect(p.x + p.width).toBeLessThan(stage.x + stage.width / 2);
    expect(r.y).toBeGreaterThan(p.y + p.height);
    const share = () => p.height / (p.height + r.height);
    expect(share()).toBeGreaterThan(0.6);

    // Drag the bar up: the list gets more room.
    const bar = page.getByTestId("mg-splitter");
    const b = (await bar.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y - 180, { steps: 8 });
    await page.mouse.up();
    p = (await panel.boundingBox())!;
    r = (await rail.boundingBox())!;
    expect(share()).toBeLessThan(0.55);
    // The keyboard works too, and the browser remembers it.
    await bar.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    const now = Number(await bar.getAttribute("aria-valuenow"));
    await page.reload();
    await expect(page.getByTestId("mg-splitter")).toHaveAttribute("aria-valuenow", String(now));
    await expectAccessible(page, "Megatrends with the column on the left");
  });

  test("Competitors: a graph of competitors with summaries, entries in orbit and the entry drawer from the right, with its saved page in a popup", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = uid();
    await pushEntries(page, [
      { title: `Lilly opens LillyDirect to employers ${tag}`, competitors: ["Eli Lilly", "Novo Nordisk"], impact: "High", page: `<!DOCTYPE html><html><head><title>Lilly page ${tag}</title></head><body><article><h1>Lilly page ${tag}</h1><p>LillyDirect expands.</p></article></body></html>` },
      { title: `Lilly and Novo cut prices ${tag}`, competitors: ["Eli Lilly", "Novo Nordisk"], impact: "Medium" },
      { title: `Metsera bidding war ${tag}`, competitors: ["Pfizer", "Metsera", "Novo Nordisk"], impact: "High" },
    ]);
    await page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" }).getByRole("link", { name: "Competitors" }).click();
    await expect(page).toHaveURL(/\/competitors$/);
    await expect(page.getByTestId("mg-panel")).toContainText("Each sphere is a competitor");
    const list = page.getByTestId("mg-competitors");
    await expect(list.getByRole("button", { name: /^Eli Lilly\s*\d+$/ })).toBeVisible();
    await expect(page.getByTestId("mg-canvas")).toBeVisible();
    await expectAccessible(page, "Competitors");

    // Find, then select: its summary (the default provided), its entries on the timeline.
    await page.getByLabel("Find a competitor").fill("lil");
    await expect(list.getByRole("button")).toHaveCount(1);
    await list.getByRole("button", { name: /^Eli Lilly/ }).click();
    await expect(page).toHaveURL(/c=Eli\+Lilly/);
    const panel = page.getByTestId("mg-panel");
    await expect(panel.getByRole("heading", { name: "Eli Lilly" })).toBeVisible();
    await expect(panel.getByTestId("mg-summary")).toContainText("LillyDirect");
    await expect(panel).toContainText("Summary provided with the dashboard");
    const tl = page.getByTestId("mg-timeline");
    await expect(tl).toContainText("naming Eli Lilly · coloured by Impact");
    await expect(page.getByRole("list", { name: "Legend" }).getByRole("button", { name: /^High/ })).toBeVisible();

    // Open the entry with a saved page: the drawer comes from the right; its page opens in a popup window.
    await tl.getByRole("button", { name: new RegExp(`^Lilly opens LillyDirect to employers ${tag}`) }).click();
    const drawer = page.getByTestId("mg-sheet");
    await expect(drawer).toHaveClass(/open/);
    await expect(drawer.getByRole("heading", { name: new RegExp(`LillyDirect to employers ${tag}`) })).toBeVisible();
    const box = (await drawer.boundingBox())!;
    expect(1440 - (box.x + box.width)).toBeLessThan(40);
    const [popup] = await Promise.all([page.waitForEvent("popup"), drawer.getByTestId("mg-open-page").click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toMatch(/\/source\/[^/?]+$/);
    await expect(popup.frameLocator("iframe").getByRole("heading", { name: `Lilly page ${tag}` })).toBeVisible();
    await popup.close();
    await expectAccessible(page, "Competitors with an entry open");
    await drawer.getByRole("button", { name: "Close entry" }).click();
    await expect(drawer).not.toHaveClass(/open/);

    // Back to all competitors.
    await page.getByRole("navigation", { name: "Graph level" }).getByRole("button", { name: "All competitors" }).click();
    await expect(page).not.toHaveURL(/c=/);
  });

  test("Competitors: analysts write a summary by hand; clients read it", async ({ page, browser }) => {
    await signInAs(page, "analyst");
    await page.goto("/competitors?c=Pfizer");
    const panel = page.getByTestId("mg-panel");
    await expect(panel.getByRole("heading", { name: "Pfizer" })).toBeVisible();
    await expect(panel.getByTestId("mg-summary")).toContainText("PfizerForAll");
    await panel.getByRole("button", { name: "Edit summary" }).click();
    await panel.getByLabel("Summary of Pfizer").fill("Pfizer is betting on obesity.");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByTestId("mg-summary")).toHaveText("Pfizer is betting on obesity.");
    const ctx = await browser.newContext();
    const client = await ctx.newPage();
    await signInAs(client, "client");
    await client.goto("/competitors?c=Pfizer");
    await expect(client.getByTestId("mg-panel").getByTestId("mg-summary")).toHaveText("Pfizer is betting on obesity.");
    await expect(client.getByTestId("mg-panel").getByRole("button", { name: "Edit summary" })).toHaveCount(0);
    await ctx.close();
    // Back to the default.
    await panel.getByRole("button", { name: "Edit summary" }).click();
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(panel.getByTestId("mg-summary")).toContainText("PfizerForAll");
  });
});
