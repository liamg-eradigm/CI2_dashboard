import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Entries pushed to a tracker through the API (as the admin). */
async function push(page: Page, stream: "primary" | "secondary", rows: Record<string, unknown>[]) {
  return page.evaluate(
    async ({ stream, rows, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const ids: string[] = [];
      for (const r of rows) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream }) })).json();
        const values = { ...item.draft, macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", growth: "Stable", impact: "Low", source: "PR", competitors: ["Roche"], action: "Not Actioned", ...r };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: j, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
        ids.push(item.id);
      }
      return ids;
    },
    { stream, rows, h: ADMIN },
  );
}

test.describe("request 51", () => {
  test("every entry's alert is the alert template filled from its fields; the view can make selected text bold, larger or smaller", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, "secondary", [
      {
        title: `Pfizer AI deal ${tag}`,
        record_id: `S-R51-${tag}`,
        date: "2026-09-01",
        competitors: ["Pfizer"],
        impact: "Low",
        assets: "Ibrance",
        review_date: "2026-09-03",
        publisher: `Reuters ${tag}`,
        url: "https://www.reuters.com/pfizer-ai",
        key_details: "Pfizer signed a five-year deal.\n- 300 staff\n  - Paris hub",
        ci_perspective: "Raises the bar for peers.",
      },
    ]);
    await page.goto(`/database?${new URLSearchParams({ "db.t.publisher": tag })}`);
    const row = page.getByTestId("table-scroll").getByRole("row", { name: new RegExp(`Pfizer AI deal ${tag}`) });
    // Low Impact too: every entry has an alert.
    await row.getByRole("button", { name: `Open the alert for Pfizer AI deal ${tag}` }).click();
    const pane = page.getByRole("dialog");
    const doc = pane.locator(".docx-host");
    await expect(doc).toContainText(`Pfizer AI deal ${tag}`);
    await expect(doc).toContainText("Company: Pfizer");
    await expect(doc).toContainText("Drug: Ibrance");
    await expect(doc).toContainText("Date: September 3, 2026");
    await expect(doc).toContainText("Impact (CI PoV): Low");
    await expect(doc).toContainText("Raises the bar for peers.");
    await expect(doc).not.toContainText("<Insert");
    // Missing: Tell Me More.
    await expect(doc).toContainText("N/A");
    // The publisher links to the URL; Key Details keeps its bullets.
    await expect(doc.getByRole("link", { name: `Reuters ${tag}` })).toHaveAttribute("href", "https://www.reuters.com/pfizer-ai");
    await expect(doc.getByText("Paris hub")).toBeVisible();

    // Select text in the view, then make it larger and bold (this view only).
    const target = doc.getByText("Raises the bar for peers.");
    const before = await target.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await target.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    });
    const bar = pane.getByTestId("docx-format");
    await bar.getByTestId("docx-larger").click();
    await bar.getByTestId("docx-bold").click();
    const after = await doc.getByText("Raises the bar for peers.").evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), weight: Number(getComputedStyle(el).fontWeight) || 400 }));
    expect(after.size).toBeGreaterThan(before * 1.1);
    expect(after.weight).toBeGreaterThanOrEqual(600);
    await expect(pane.getByRole("status")).toContainText("Download gives the document as generated");
    await expectAccessible(page, "Alert in the document view");
    // Reset shows it as generated again.
    await bar.getByRole("button", { name: "Reset" }).click();
    await expect(doc).toContainText("Raises the bar for peers.");
    expect(await doc.getByText("Raises the bar for peers.").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(before, 0);
  });

  test("Generate Newsletter: put each ticked signal in Technology, People or Process, then Confirm", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const tag = Math.random().toString(36).slice(2, 8);
    await push(page, "secondary", [
      { title: `Tech ${tag}`, date: "2026-09-01", publisher: `Pub ${tag}`, ci_perspective: "Watch it.", key_details: "- First point" },
      { title: `People ${tag}`, date: "2026-10-22", publisher: `Pub ${tag}` },
      { title: `Process ${tag}`, date: "2026-08-03", publisher: `Pub ${tag}` },
    ]);
    await page.goto(`/database?${new URLSearchParams({ "db.t.publisher": tag })}`);
    const table = page.getByTestId("table-scroll").locator("table");
    const row = (t: string) => table.getByRole("row", { name: new RegExp(t) });
    await expect(table.locator("tbody tr")).toHaveCount(3);
    for (const t of ["Tech", "People", "Process"]) await row(`${t} ${tag}`).getByRole("checkbox").check();
    await page.getByTestId("generate-newsletter").click();
    const dialog = page.getByRole("dialog", { name: "Generate newsletter" });
    await expect(dialog.getByRole("listitem")).toHaveCount(3);
    const confirm = dialog.getByTestId("nl-confirm");
    await expect(confirm).toBeDisabled();
    await expect(dialog).toContainText("3 of 3 still to place");
    await dialog.getByRole("radiogroup", { name: `Section for Tech ${tag}` }).getByRole("radio", { name: "Technology" }).click();
    await dialog.getByRole("radiogroup", { name: `Section for People ${tag}` }).getByRole("radio", { name: "People" }).click();
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("radiogroup", { name: `Section for Process ${tag}` }).getByRole("radio", { name: "Process" }).click();
    await expect(dialog.getByRole("radiogroup", { name: `Section for Process ${tag}` }).getByRole("radio", { name: "Process" })).toHaveAttribute("aria-checked", "true");
    await expectAccessible(page, "Generate newsletter: sections");
    await confirm.click();
    await expect(page.getByText(/Generated “Newsletter · .*” from 3 entries/).first()).toBeVisible();

    // The newsletter: this month, each signal in its section.
    await row(`Tech ${tag}`).getByTestId("newsletter-cell").click();
    const doc = page.getByRole("dialog").locator(".docx-host");
    await expect(doc).toContainText(`Welcome to the ${MONTHS[new Date().getMonth()]} edition`);
    await expect(doc).toContainText(`Tech ${tag} (Pub ${tag}; September 1st, 2026)`);
    await expect(doc).toContainText("Trend(s) to watch: Geopolitics (IRA Pricing/Tariffs)");
    await expect(doc).toContainText("CI Perspective – Watch it.");
    const text = (await doc.innerText()).replace(/\s+/g, " ");
    const at = (s: string) => text.lastIndexOf(s);
    expect(at(`Tech ${tag} (`)).toBeLessThan(at(`People ${tag} (`));
    expect(at(`People ${tag} (`)).toBeLessThan(at(`Process ${tag} (`));
    expect(text).not.toMatch(/<Month>|<Alert Title>|<Insert/);
  });
});
