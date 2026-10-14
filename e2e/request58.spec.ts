import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const RANK: Record<string, number> = { "High impact": 0, "Medium impact": 1, "Low impact": 2 };

/** The signals list as shown: each row's Impact rank and date. */
async function rows(page: Page) {
  const items = page.getByTestId("mg-sources").locator("li");
  const out: { rank: number; date: string; ms: number }[] = [];
  for (const li of await items.all()) {
    const impact = (await li.locator(".sr-only").innerText()).replace(/:\s*$/, "").trim();
    const date = (await li.getByTestId("signal-date").innerText()).trim();
    out.push({ rank: RANK[impact] ?? 3, date, ms: Date.parse(date) });
  }
  return out;
}

/** Most recent first; the same day's by Impact, High first. */
function expectRecency(list: { rank: number; ms: number }[]) {
  for (let i = 1; i < list.length; i++) {
    const [a, b] = [list[i - 1]!, list[i]!];
    expect(a.ms).toBeGreaterThanOrEqual(b.ms);
    if (a.ms === b.ms) expect(a.rank).toBeLessThanOrEqual(b.rank);
  }
}

/** By Impact, high to low; the newest first within each. */
function expectImpact(list: { rank: number; ms: number }[]) {
  for (let i = 1; i < list.length; i++) {
    const [a, b] = [list[i - 1]!, list[i]!];
    expect(a.rank).toBeLessThanOrEqual(b.rank);
    if (a.rank === b.rank) expect(a.ms).toBeGreaterThanOrEqual(b.ms);
  }
}

const withParam = (page: Page, k: string, v: string | null) => {
  const u = new URL(page.url());
  if (v == null) u.searchParams.delete(k);
  else u.searchParams.set(k, v);
  return `${u.pathname}${u.search}`;
};

test.describe("request 58", () => {
  test("a Macrotrend's Explore Signals: most recent first (or by Impact), each signal dated; its time frame moves with the Impact Mix's", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/analytics/megatrends?${new URLSearchParams({ m: "AI Investment in R&D", v: "3", s: "Computational Infrastructure" })}`);
    const sources = page.getByTestId("mg-sources");
    await expect(sources.locator("li").first()).toBeVisible();
    // Recency is the default, at the list's top right.
    const order = page.getByTestId("mg-order");
    await expect(order.getByRole("button", { name: "Recency" })).toHaveAttribute("aria-pressed", "true");
    await expect(sources.locator(".mg-sheet-meta")).toContainText("most recent first");
    const close = (await sources.getByRole("button", { name: "Close the signals list" }).boundingBox())!;
    const toggle = (await order.boundingBox())!;
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(close.x);
    expect(Math.abs(toggle.y + toggle.height / 2 - (close.y + close.height / 2))).toBeLessThan(6);
    const recent = await rows(page);
    expect(recent.length).toBeGreaterThan(2);
    for (const r of recent) expect(r.date).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expectRecency(recent);
    await expectAccessible(page, "Explore Signals: the signals list, most recent first");
    // By Impact, high to low; and back.
    await order.getByRole("button", { name: "Impact" }).click();
    await expect(sources.locator(".mg-sheet-meta")).toContainText("by Impact, high to low");
    expectImpact(await rows(page));
    await order.getByRole("button", { name: "Recency" }).click();
    expectRecency(await rows(page));

    // The time frame bar at the bottom: all dates at first.
    const frame = page.getByTestId("explore-frame");
    const label = page.getByTestId("mix-range-label-explore");
    await expect(label).toContainText("All dates");
    const graph = (await page.getByTestId("md-graph").boundingBox())!;
    const bar = (await frame.boundingBox())!;
    expect(Math.abs(graph.y + graph.height - (bar.y + bar.height))).toBeLessThanOrEqual(14);
    // A later first month: the address keeps it, and the list shows only signals from then on.
    await frame.getByLabel(/^First month of /).focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/[?&]tf=/);
    await expect(label).not.toContainText("All dates");
    const first = new URL(page.url()).searchParams.get("tf")!.split("~")[0]!;
    await expect.poll(async () => (await rows(page)).every((r) => new Date(r.ms).toISOString().slice(0, 7) >= first)).toBe(true);
    const chosen = await label.innerText();

    // The Impact Mix (row 2) shows the same time frame…
    await page.goto(withParam(page, "v", "0"));
    const mixLabel = page.getByTestId("mix-range-label-sub");
    await expect(mixLabel).toHaveText(chosen);
    // …and moving it moves Explore Signals' too.
    await page.getByTestId("mix-range-sub").getByRole("button", { name: "All dates" }).click();
    await expect(page).not.toHaveURL(/[?&]tf=/);
    await page.goto(withParam(page, "v", "3"));
    await expect(label).toContainText("All dates");
  });

  test("a competitor's Explore Signals: the same order toggle, dates and linked time frame", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/analytics/competitors?${new URLSearchParams({ c: "Roche", v: "signals" })}`);
    const sources = page.getByTestId("mg-sources");
    await expect(sources.locator("li").first()).toBeVisible();
    await expect(page.getByTestId("mg-order").getByRole("button", { name: "Recency" })).toHaveAttribute("aria-pressed", "true");
    expectRecency(await rows(page));
    await page.getByTestId("mg-order").getByRole("button", { name: "Impact" }).click();
    expectImpact(await rows(page));
    // One month only (the last handle back to the first).
    const frame = page.getByTestId("explore-frame");
    await frame.getByLabel(/^Last month of /).focus();
    await page.keyboard.press("Home");
    await expect(page).toHaveURL(/[?&]tf=/);
    const chosen = await page.getByTestId("mix-range-label-explore").innerText();
    // Its page's Impact Mix by Macrotrend follows.
    await page.goto(withParam(page, "v", null));
    await expect(page.getByTestId("mix-range-label-macro")).toHaveText(chosen);
    await expectAccessible(page, "Competitor page with a time frame");
  });
});
