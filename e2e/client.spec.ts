import { choose, expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("client role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "client"));

  test("sees only published data and no analyst tools", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Intelligence Dashboard" })).toBeVisible();
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Tracker" })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Eradigm Inbox/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Input" })).toHaveCount(0);
    // The Inbox and Input pages do not exist for clients: direct links go to the dashboard.
    for (const path of ["/input", "/inbox", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole("heading", { name: "Intelligence Dashboard" })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: /Eradigm Inbox/ })).toHaveCount(0);
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

  test("Subtrend and Competitor charts show 10 rows until their row is expanded, keeping the pair aligned", async ({ page }) => {
    await page.goto("/dashboard");
    const card = (name: string) => page.locator("section.card", { has: page.getByRole("heading", { name, exact: true }) });
    const [sm, si, comp] = [card("Signals by Subtrend"), card("Impact mix by Subtrend"), card("Competitor Composition")];
    await expect(sm.locator(".bar-row")).toHaveCount(10);
    await expect(si.locator(".bar-row")).toHaveCount(10);
    const total = Number(((await sm.getByRole("button", { name: /^Show all \d+/ }).innerText()).match(/\d+/) ?? ["0"])[0]);
    expect(total).toBeGreaterThan(10);
    // The arrow sits in the middle of each chart, level across the pair.
    const [a, b, sBox] = [(await sm.locator(".expand-btn").boundingBox())!, (await si.locator(".expand-btn").boundingBox())!, (await sm.boundingBox())!];
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.x + a.width / 2 - (sBox.x + sBox.width / 2))).toBeLessThanOrEqual(2);
    const collapsed = sBox.height;
    await expectAccessible(page, "/dashboard collapsed charts");

    // Expanding one Subtrend chart expands both; the Competitor chart is its own row.
    await si.getByRole("button", { name: /^Show all/ }).click();
    await expect(sm.locator(".bar-row")).toHaveCount(total);
    await expect(si.locator(".bar-row")).toHaveCount(total);
    await expect(sm.locator(".expand-btn")).toHaveAttribute("aria-expanded", "true");
    expect((await sm.boundingBox())!.height).toBeGreaterThan(collapsed);
    const rowsY = (c: typeof sm) => c.locator(".bar-row").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
    const [ya, yb] = [await rowsY(sm), await rowsY(si)];
    ya.forEach((y, i) => expect(Math.abs(y - (yb[i] as number))).toBeLessThanOrEqual(1));
    const compRows = await comp.locator(".bar-row").count();
    expect(compRows).toBeLessThanOrEqual(10);

    // Collapse again from the other chart.
    await sm.getByRole("button", { name: "Show top 10" }).click();
    await expect(si.locator(".bar-row")).toHaveCount(10);

    // Competitor Composition expands on its own.
    const more = comp.getByRole("button", { name: /^Show all/ });
    if (await more.count()) {
      await more.click();
      await expect.poll(() => comp.locator(".bar-row").count()).toBeGreaterThan(10);
      await expect(sm.locator(".bar-row")).toHaveCount(10);
    }
  });

  test("can view Phantoms and download Markdown, but not delete entries", async ({ page }) => {
    await page.goto("/phantoms?stream=primary");
    await expect(page.getByRole("heading", { name: "Phantoms" })).toBeVisible();
    await expect(page.getByTestId("stream-primary")).toHaveText("Primary Phantoms");
    const row = page.locator("table tbody tr").first();
    // The MD icon opens the Markdown file as a side pane, with Download at the top right.
    await row.locator("td.md-col").getByRole("button", { name: /^Open Markdown for / }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("button", { name: "Download Markdown" })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download Markdown" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^[PS]-\d+\.md$/);
    await expect(panel.getByLabel("Markdown source")).toContainText("## Key Intelligence Question");
    await expect(panel.getByLabel("Markdown source")).toContainText(/^---\nid: P-\d+/);
    await panel.getByRole("button", { name: "Open full record" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Secondary Phantoms: only Impact at or above the admin setting (Low by default).
    await page.getByTestId("stream-secondary").click();
    await expect(page.locator(".stream-note")).toContainText("Impact Low or higher");
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    // Impact is not a Secondary Phantoms column, so check the rows' values through the API.
    const impacts = await page.evaluate(async () => {
      const res = await fetch("/api/phantoms?stream=secondary&from=2000-01-01&to=2100-01-01&pageSize=100", { headers: { "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" } });
      return ((await res.json()) as { rows: { values: { impact: string } }[] }).rows.map((r) => r.values.impact);
    });
    expect(impacts.length).toBeGreaterThan(0);
    // Low by default: every Secondary entry, including Low ones.
    for (const i of impacts) expect(i).toMatch(/Low|Medium|High/);
    expect(impacts).toContain("Low");
    // Secondary Phantoms shows its own columns, not the Tracker's.
    await expect(page.locator("table thead")).toContainText("Publisher");
    await expect(page.locator("table thead")).not.toContainText("Macrotrend");
    await expectAccessible(page, "/phantoms");
  });

  test("has no Deliverables or Eradigm Inbox tab: those pages redirect to the Dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" });
    await expect(nav.getByRole("link", { name: "Deliverables" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /Client Inbox/ })).toBeVisible();
    for (const path of ["/deliverables", "/inbox", "/input", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
    }
  });

  test("sees the saved-page icon but cannot attach pages", async ({ page }) => {
    await page.goto("/tracker");
    await expect(page.locator("table tbody tr td.src-col").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Attach the HTML page/ })).toHaveCount(0);
  });

  test("cannot edit approved entries", async ({ page }) => {
    await page.goto("/phantoms");
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    await page.locator("table tbody tr").first().locator("td.md-col button").click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "✎ Edit" })).toHaveCount(0);
  });

  test("cannot delete tracker entries", async ({ page }) => {
    await page.goto("/tracker");
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.locator("table tbody td.title button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  });

  test("dashboard defaults to everything in view (oldest entry to today) and reconciles with the Primary + Secondary trackers", async ({ page }) => {
    await page.goto("/dashboard");
    const bar = page.getByRole("region", { name: "Filters", exact: true });
    const to = bar.getByLabel("Date to");
    const from = bar.getByLabel("Date from");
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const bounds = await page.evaluate(async () => (await fetch("/api/tracker/bounds", { headers: { "x-dev-user": "client@example.com" } })).json());
    await expect(to).toHaveValue(bounds.newest > iso(today) ? bounds.newest : iso(today));
    await expect(from).toHaveValue(bounds.oldest);
    await expect(page.locator(".dates-banner")).toHaveCount(0);

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
    // The Tracker opens on Secondary.
    await expect(page.getByTestId("stream-secondary")).toHaveAttribute("aria-pressed", "true");
    const s1 = await count(() => page.reload(), { stream: "secondary", filtered: true });
    const p1 = await count(() => page.getByTestId("stream-primary").click(), { stream: "primary", filtered: true });
    await expect(page.getByRole("region", { name: "Filters", exact: true }).getByRole("combobox", { name: "Macrotrend", exact: true })).toHaveValue("Portfolio Restructuring");
    expect(p1 + s1).toBe(Number(filtered));
    await expect(page.getByText(new RegExp(`of ${p1} · page|^0 results`))).toBeVisible();
    const p2 = await count(() => page.getByRole("button", { name: "Reset filter" }).click(), { stream: "primary", filtered: false });
    const s2 = await count(() => page.getByTestId("stream-secondary").click(), { stream: "secondary", filtered: false });
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
    expect(d.suggestedFilename()).toMatch(/^eradigm-secondary-tracker-filtered-\d{4}-\d{2}-\d{2}\.csv$/);
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
