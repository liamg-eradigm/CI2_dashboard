import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };
const uid = () => Math.random().toString(36).slice(2, 8);

/** A Primary Inbox entry with its shared fields filled in (through the API). */
async function primaryDraft(page: Page, title: string) {
  return page.evaluate(
    async ({ title, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "primary" }) })).json();
      const values = {
        ...item.draft,
        title,
        date: "2026-09-15",
        macrotrend: "AI Investment in R&D",
        subtrend: "Agentic AI Platforms",
        growth: "Stable",
        impact: "Medium",
        source: "Primary Source",
        competitors: ["Roche"],
        action: "Not Actioned",
      };
      const r = await fetch(`/api/items/${item.id}/draft`, { method: "PATCH", headers: j, body: JSON.stringify({ values, version: item.version }) });
      if (!r.ok) throw new Error(await r.text());
      return { id: item.id as string, code: item.code as string };
    },
    { title, h: ADMIN },
  );
}

test.describe("request 24", () => {
  test("Primary: Insight Topics with Key Intelligence Questions, one Tracker entry each, with automatic IDs", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/inbox");
    const title = `KOL interview ${uid()}`;
    const { code } = await primaryDraft(page, title);
    await page.reload();
    await page.getByRole("button", { name: "Primary", exact: true }).click();
    const card = page.locator(".inbox-card", { hasText: code });
    await expect(card).toBeVisible();
    // No ID field: it is filled in automatically and shown under the title.
    await expect(card.getByRole("textbox", { name: "ID", exact: true })).toHaveCount(0);
    // Until a Key Intelligence Question is entered, the Title stands in for it.
    await expect(card.getByTestId("auto-id")).toHaveText(new RegExp(`2026-09-15_Roche_${title}`));
    const editor = card.getByTestId("kiq-editor");
    await expect(editor).toBeVisible();
    await expect(card.getByRole("textbox", { name: "Key Intelligence Question", exact: true })).toHaveCount(0);

    await editor.getByLabel("Insight Topic 1", { exact: true }).fill("Launch sequencing");
    await editor.getByLabel("Key Intelligence Question 1", { exact: true }).fill("When will Roche launch in the US?");
    await editor.getByLabel("Key Details").first().fill("- Q3 2027");
    await expect(card.getByTestId("auto-id")).toHaveText(/2026-09-15_Roche_When will Roche launch in the US\?/);
    await editor.getByRole("button", { name: "＋ Add Key Intelligence Question" }).click();
    await editor.getByLabel("Key Intelligence Question 2", { exact: true }).fill("Which markets follow?");
    await editor.getByRole("button", { name: "＋ Add Insight Topic" }).click();
    await editor.getByLabel("Insight Topic 2", { exact: true }).fill("Pricing");
    await editor.getByTestId("kiq-topic").nth(1).getByLabel("Key Intelligence Question 1", { exact: true }).fill("Will Roche price at parity?");
    await editor.getByTestId("kiq-topic").nth(1).getByLabel("Key Metrics").fill("Parity with SoC");
    await expect(editor).toContainText("(3 so far)");
    await expectAccessible(page, "Inbox · Primary topics and questions");

    page.once("dialog", (d) => void d.accept());
    await card.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(page.getByRole("status").filter({ hasText: /3 Tracker entries pushed/ })).toBeAttached();
    const rows = await page.evaluate(
      async ({ title, h }) => (await (await fetch(`/api/tracker?stream=primary&from=2000-01-01&to=2100-01-01&pageSize=1000&q=${encodeURIComponent(title)}`, { headers: h })).json()).rows,
      { title, h: ADMIN },
    );
    const got = rows.map((r: { values: Record<string, unknown> }) => [r.values.insight_topic, r.values.key_intelligence_question, r.values.record_id]).sort((a: string[], b: string[]) => String(a[1]).localeCompare(String(b[1])));
    expect(got).toEqual([
      ["Launch sequencing", "When will Roche launch in the US?", "2026-09-15_Roche_When will Roche launch in the US?"],
      ["Launch sequencing", "Which markets follow?", "2026-09-15_Roche_Which markets follow?"],
      ["Pricing", "Will Roche price at parity?", "2026-09-15_Roche_Will Roche price at parity?"],
    ]);
  });

  test("Secondary: the ID is not a field; it shows as Date_Competitor_Title", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/inbox");
    const title = `Pfizer deal ${uid()}`;
    const code = await page.evaluate(
      async ({ title, h }) => {
        const j = { ...h, "content-type": "application/json" };
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "secondary" }) })).json();
        await fetch(`/api/items/${item.id}/draft`, { method: "PATCH", headers: j, body: JSON.stringify({ values: { ...item.draft, title, date: "2026-09-16", competitors: ["Pfizer"] }, version: item.version }) });
        return item.code as string;
      },
      { title, h: ADMIN },
    );
    await page.reload();
    const card = page.locator(".inbox-card", { hasText: code });
    await expect(card.getByTestId("auto-id")).toHaveText(new RegExp(`2026-09-16_Pfizer_${title}`));
    await expect(card.getByRole("textbox", { name: "ID", exact: true })).toHaveCount(0);
    await expect(card.getByTestId("kiq-editor")).toHaveCount(0);
  });

  test("Competitors: tiers colour and order the list; admins change them", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/competitors");
    const list = page.getByTestId("mg-competitors");
    await expect(list.getByRole("heading", { name: /^Tier 1/ })).toBeVisible();
    const tier1 = list.locator(".mg-tier", { has: page.getByRole("heading", { name: /^Tier 1/ }) });
    await expect(tier1.getByRole("button", { name: /^Pfizer/ })).toBeVisible();
    await list.getByRole("button", { name: /^Pfizer/ }).click();
    await expect(page.getByTestId("mg-panel")).toContainText("Competitor · Tier 1");
    await expectAccessible(page, "Competitors by tier");

    // Administration: move Roche to Tier 3.
    await page.goto("/admin");
    const card = page.getByTestId("competitor-tiers");
    const t1 = card.getByLabel("Tier 1 competitors, one per line");
    const t3 = card.getByLabel("Tier 3 competitors, one per line");
    const was1 = await t1.inputValue();
    const was3 = await t3.inputValue();
    await t1.fill(was1.split("\n").filter((x) => x !== "Roche").join("\n"));
    await t3.fill(`${was3}\nRoche`);
    await card.getByRole("button", { name: "Save tiers" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Competitor tiers saved" })).toBeAttached();
    await page.goto("/competitors?c=Roche");
    await expect(page.getByTestId("mg-panel")).toContainText("Competitor · Tier 3");
    // Restore.
    await page.goto("/admin");
    await card.getByLabel("Tier 1 competitors, one per line").fill(was1);
    await card.getByLabel("Tier 3 competitors, one per line").fill(was3);
    await card.getByRole("button", { name: "Save tiers" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Competitor tiers saved" })).toBeAttached();
  });

  test("Megatrends: the summary column drags wider and narrower, and the browser remembers it", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/megatrends");
    await page.evaluate(() => localStorage.removeItem("eradigm.megatrends.width"));
    await page.reload();
    const panel = page.getByTestId("mg-panel");
    await expect(panel).toBeVisible();
    const before = (await panel.boundingBox())!.width;
    const grip = page.getByTestId("mg-width-grip");
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 160, g.y + g.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(before + 120);
    await grip.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    const now = Number(await grip.getAttribute("aria-valuenow"));
    await page.reload();
    await expect(page.getByTestId("mg-width-grip")).toHaveAttribute("aria-valuenow", String(now));
    await expectAccessible(page, "Megatrends with a wider column");
  });
});
