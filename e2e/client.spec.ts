import { choose, expect, expectAccessible, signInAs, test } from "./fixtures";

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

  test("dashboard trend charts sit two per row, aligned edge to edge with the full-width charts", async ({ page }) => {
    await page.goto("/dashboard");
    const box = async (name: string) => (await page.locator("section.card", { has: page.getByRole("heading", { name, exact: true }) }).boundingBox())!;
    await expect(page.getByRole("heading", { name: "Impact mix by Subtrend", exact: true })).toBeVisible();
    const [tl, mm, mi, sm, si, comp] = await Promise.all(["Signal Timeline", "Signals by Macrotrend", "Impact mix by Macrotrend", "Signals by Subtrend", "Impact mix by Subtrend", "Competitor Composition"].map(box));
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    // Row 1: the two macrotrend charts; row 2: the two subtrend charts.
    near(mm.y, mi.y);
    near(sm.y, si.y);
    expect(sm.y).toBeGreaterThan(mm.y + mm.height - 1);
    // Same columns in both rows, equal widths and heights within a row.
    near(mm.x, sm.x);
    near(mi.x, si.x);
    near(mm.width, mi.width);
    near(sm.width, si.width);
    near(mm.height, mi.height);
    near(sm.height, si.height);
    // The pair spans exactly the width of the full-width charts above and below.
    near(mm.x, tl.x);
    near(mi.x + mi.width, tl.x + tl.width);
    near(comp.x, tl.x);
    near(comp.x + comp.width, tl.x + tl.width);
    // Bars inside a pair start on the same line.
    const firstBar = async (name: string) => (await page.locator("section.card", { has: page.getByRole("heading", { name, exact: true }) }).locator(".bar-row").first().boundingBox())!;
    near((await firstBar("Signals by Macrotrend")).y, (await firstBar("Impact mix by Macrotrend")).y);
    near((await firstBar("Signals by Subtrend")).y, (await firstBar("Impact mix by Subtrend")).y);
    // ...and every row stays level with its partner down to the last one.
    const rowsY = (name: string) => page.locator("section.card", { has: page.getByRole("heading", { name, exact: true }) }).locator(".bar-row").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
    for (const [a, b] of [["Signals by Macrotrend", "Impact mix by Macrotrend"], ["Signals by Subtrend", "Impact mix by Subtrend"]] as const) {
      const [ya, yb] = [await rowsY(a), await rowsY(b)];
      expect(ya.length).toBe(yb.length);
      ya.forEach((y, i) => expect(Math.abs(y - (yb[i] as number))).toBeLessThanOrEqual(1));
    }
  });

  test("can view Phantoms and download Markdown, but not delete entries", async ({ page }) => {
    await page.goto("/phantoms");
    await expect(page.getByRole("heading", { name: "Phantoms" })).toBeVisible();
    await expect(page.getByTestId("stream-primary")).toHaveText("Primary Phantoms");
    const row = page.locator("table tbody tr").first();
    // The MD icon opens the Markdown file as a side pane, with Download at the top right.
    await row.locator("td.md-col").getByRole("button", { name: /^Open Markdown for / }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("button", { name: "Download Markdown" })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download Markdown" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^P-\d+\.md$/);
    await expect(panel.getByLabel("Markdown source")).toContainText("## Key Intelligence Question");
    await expect(panel.getByLabel("Markdown source")).toContainText(/^---\nid: P-\d+/);
    await panel.getByRole("button", { name: "Open full record" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Secondary Phantoms: only Impact at or above the admin setting (Medium by default).
    await page.getByTestId("stream-secondary").click();
    await expect(page.locator(".stream-note")).toContainText("Impact Medium or higher");
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    // Impact is not a Secondary Phantoms column, so check the rows' values through the API.
    const impacts = await page.evaluate(async () => {
      const res = await fetch("/api/phantoms?stream=secondary&from=2000-01-01&to=2100-01-01&pageSize=100", { headers: { "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" } });
      return ((await res.json()) as { rows: { values: { impact: string } }[] }).rows.map((r) => r.values.impact);
    });
    expect(impacts.length).toBeGreaterThan(0);
    for (const i of impacts) expect(i).toMatch(/Medium|High/);
    // Secondary Phantoms shows its own columns, not the Tracker's.
    await expect(page.locator("table thead")).toContainText("Publisher");
    await expect(page.locator("table thead")).not.toContainText("Macrotrend");
    await expectAccessible(page, "/phantoms");
  });

  test("sees the saved-page icon but cannot attach pages", async ({ page }) => {
    await page.goto("/tracker");
    await expect(page.locator("table tbody tr td.src-col").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Attach the HTML page/ })).toHaveCount(0);
  });

  test("cannot delete tracker entries", async ({ page }) => {
    await page.goto("/tracker");
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.locator("table tbody td.title button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  });

  test("dashboard defaults to the last three months and reconciles with the Primary + Secondary trackers", async ({ page }) => {
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

    await expect(page.locator(".kpi .v").first()).toHaveText(/^\d+$/);
    const kpi = await page.locator(".kpi .v").first().innerText();
    await choose(bar.getByRole("combobox", { name: "Macrotrend", exact: true }), "Portfolio Restructuring");
    await expect(page.locator(".pill", { hasText: "Macrotrend:" })).toBeVisible();
    await expect(page.locator(".kpi .v").first()).not.toHaveText(kpi);
    const filtered = await page.locator(".kpi .v").first().innerText();
    await page.getByRole("navigation").getByRole("link", { name: "Tracker" }).click();
    // Filters are shared across Dashboard and Tracker via the URL.
    await expect(page.getByRole("region", { name: "Filters", exact: true }).getByRole("combobox", { name: "Macrotrend", exact: true })).toHaveValue("Portfolio Restructuring");
    // The Dashboard covers both streams: its count is the Primary Tracker plus the Secondary Tracker.
    const count = async (act: () => Promise<unknown>, want: { stream: string; filtered: boolean }) => {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/tracker?") && r.url().includes(`stream=${want.stream}`) && r.url().includes("f.macrotrend") === want.filtered),
        act(),
      ]);
      return ((await res.json()) as { total: number }).total;
    };
    await expect(page.getByTestId("stream-primary")).toHaveAttribute("aria-pressed", "true");
    const p1 = await count(() => page.reload(), { stream: "primary", filtered: true });
    const s1 = await count(() => page.getByTestId("stream-secondary").click(), { stream: "secondary", filtered: true });
    await expect(page.getByRole("region", { name: "Filters", exact: true }).getByRole("combobox", { name: "Macrotrend", exact: true })).toHaveValue("Portfolio Restructuring");
    expect(p1 + s1).toBe(Number(filtered));
    await expect(page.getByText(new RegExp(`of ${s1} · page|^0 results`))).toBeVisible();
    const s2 = await count(() => page.getByRole("button", { name: "Reset filter" }).click(), { stream: "secondary", filtered: false });
    const p2 = await count(() => page.getByTestId("stream-primary").click(), { stream: "primary", filtered: false });
    expect(p2 + s2).toBe(Number(kpi));
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

  test("filter dropdowns on the Tracker and Dashboard are searchable", async ({ page }) => {
    await page.goto("/tracker");
    const bar = page.getByRole("region", { name: "Filters", exact: true });
    const macro = bar.getByRole("combobox", { name: "Macrotrend", exact: true });
    await expect(macro).toHaveValue("All");
    await macro.click();
    await macro.fill("geo");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["Geopolitics"]);
    await page.keyboard.press("Enter");
    await expect(page.locator(".pill", { hasText: "Macrotrend:" })).toContainText("Geopolitics");
    await expect(page).toHaveURL(/f\.macrotrend=Geopolitics/);
    // "All" clears the filter again.
    await choose(macro, "All");
    await expect(page.locator(".pill", { hasText: "Macrotrend:" })).toHaveCount(0);
    await page.goto("/dashboard");
    const comp = page.getByRole("region", { name: "Filters", exact: true }).getByRole("combobox", { name: "Competitors", exact: true });
    await comp.click();
    await comp.fill("astra");
    await page.keyboard.press("Enter");
    await expect(page.locator(".pill", { hasText: "Competitors:" })).toContainText("AstraZeneca");
    // Trend Test dropdowns search as well.
    const tt = page.locator("section.card", { has: page.getByRole("heading", { name: "Trend Test" }) });
    await choose(tt.getByRole("combobox", { name: "Macrotrend", exact: true }), "Geopolitics");
    await expectAccessible(page, "/dashboard with searchable filters");
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

  test("the Export menu is not cut off when only a few rows are shown", async ({ page }) => {
    await page.goto("/tracker");
    const first = (await page.locator("table tbody td.title").first().innerText()).trim();
    await page.getByRole("searchbox").fill(first);
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: /Export/ }).click();
    const menu = page.getByRole("dialog", { name: "Export options" });
    const json = menu.getByRole("button", { name: /^JSON/ });
    await expect(json).toBeVisible();
    // The last option is really on top (not clipped by the table card).
    await json.scrollIntoViewIfNeeded();
    const box = (await json.boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit).toContain("JSON");
    const card = (await page.locator("section.card.pop-host").boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.y + menuBox.height).toBeGreaterThan(card.y + card.height);
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
