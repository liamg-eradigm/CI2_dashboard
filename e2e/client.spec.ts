import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("client role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "client"));

  test("sees only published data and no analyst tools", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Intelligence Dashboard" })).toBeVisible();
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Tracker" })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Inbox/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Input" })).toHaveCount(0);
    // The Inbox and Input pages do not exist for clients: direct links go to the dashboard.
    for (const path of ["/input", "/inbox", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole("heading", { name: "Intelligence Dashboard" })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: /Inbox/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Input" })).toHaveCount(0);
    // And the API refuses them regardless of the UI.
    const res = await page.evaluate(async () => {
      const h = { "x-dev-user": "client@example.com" };
      const inbox = await fetch("/api/items?status=needs_review", { headers: h });
      const capture = await fetch("/api/capture-log", { headers: h });
      const submit = await fetch("/api/submissions", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/a" }) });
      return [inbox.status, capture.status, submit.status];
    });
    expect(res).toEqual([403, 403, 403]);
  });

  test("dashboard defaults to the last three months and reconciles with the tracker", async ({ page }) => {
    await page.goto("/dashboard");
    const bar = page.getByRole("region", { name: "Filters", exact: true });
    const to = bar.getByLabel("Date to");
    const from = bar.getByLabel("Date from");
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await expect(to).toHaveValue(iso(today));
    const threeAgo = new Date(today);
    threeAgo.setMonth(today.getMonth() - 3);
    expect(Math.abs(new Date(await from.inputValue()).getTime() - threeAgo.getTime()) / 86_400_000).toBeLessThan(3);

    const kpi = await page.locator(".kpi .v").first().innerText();
    await bar.getByRole("combobox", { name: "Macrotrend", exact: true }).selectOption("Portfolio Restructuring");
    await expect(page.locator(".pill", { hasText: "Macrotrend:" })).toBeVisible();
    const filtered = await page.locator(".kpi .v").first().innerText();
    await page.getByRole("navigation").getByRole("link", { name: "Tracker" }).click();
    // Filters are shared across Dashboard and Tracker via the URL.
    await expect(page.getByRole("region", { name: "Filters", exact: true }).getByRole("combobox", { name: "Macrotrend", exact: true })).toHaveValue("Portfolio Restructuring");
    await expect(page.getByText(new RegExp(`of ${filtered} · page`))).toBeVisible();
    await page.getByRole("button", { name: "Reset filter" }).click();
    await expect(page.getByText(new RegExp(`of ${kpi} · page`))).toBeVisible();
  });

  test("opens a record from the tracker, keeps filters and closes with Escape", async ({ page }) => {
    await page.goto("/tracker?f.impact=High");
    const first = page.locator("td.title button").first();
    const title = await first.innerText();
    await first.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    await expect(dialog.getByText("Provenance")).toBeVisible();
    await expect(dialog.getByText("Analyst revision history")).toBeVisible();
    await expect(page).toHaveURL(/f\.impact=High/);
    await expectAccessible(page, "record drawer");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Filters", exact: true }).getByRole("combobox", { name: "Impact", exact: true })).toHaveValue("High");
  });

  test("timeline points are keyboard accessible", async ({ page }) => {
    await page.goto("/dashboard");
    const point = page.locator(".tl-pt").first();
    await point.focus();
    await expect(page.locator(".tip")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close record" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("exports the filtered tracker as CSV", async ({ page }) => {
    await page.goto("/tracker");
    await page.getByRole("button", { name: /Export/ }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^CSV/ }).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/^eradigm-tracker-filtered-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("runs the trend test", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Run trend test" }).click();
    await expect(page.getByText(/Trend confirmed|No trend detected/).first()).toBeVisible();
    await expect(page.getByText("Analyst-configured indicator, not statistical proof.")).toBeVisible();
  });

  test("pages pass automated accessibility checks", async ({ page }) => {
    for (const path of ["/dashboard", "/tracker"]) {
      await page.goto(path);
      await expect(page.locator("#main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, path);
    }
  });
});
