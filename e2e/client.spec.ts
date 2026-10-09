import { choose, expect, expectAccessible, searchDatabase, signInAs, test, navLink, navOf, menuOf } from "./fixtures";

test.describe("client role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "client"));

  test("sees only published data and no analyst tools", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Megatrends Dashboard" })).toBeVisible();
    // Requests 28 and 31: tabs in groups; a client's Inputs group has only the Client Inbox, and there is no Admin group.
    expect(await menuOf(page)).toEqual(["Inputs: Client Inbox", "Analytics: Megatrends Dashboard, Primary Tracker", "Database"]);
    const nav = navOf(page);
    // The Inbox and Input pages do not exist for clients: direct links go to the dashboard.
    for (const path of ["/input", "/inbox", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole("heading", { name: "Megatrends Dashboard" })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: /Eradigm Inbox/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /: Input$/ })).toHaveCount(0);
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

  test("can open Phantoms' Markdown from the Database and download it, but not delete entries", async ({ page }) => {
    // Request 48: the Phantoms Database is the Database page's Markdown column.
    await page.goto("/database?stream=primary");
    await expect(page.getByRole("heading", { name: "Database", level: 1 })).toBeVisible();
    // The MD icon opens the Markdown file as a side pane, with Download at the top right.
    await page.getByRole("button", { name: /^Open Markdown for / }).first().click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("button", { name: "Download Markdown" })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download Markdown" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^[PS]-\d+\.md$/);
    await expect(panel.getByLabel("Markdown source")).toContainText("## Key Intelligence Question");
    await expect(panel.getByLabel("Markdown source")).toContainText(/^---\nid: P-\d+/);
    await panel.getByRole("button", { name: "Open full record" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Secondary Phantoms: only Impact at or above the admin setting (Low by default), checked through the API.
    const impacts = await page.evaluate(async () => {
      const res = await fetch("/api/phantoms?stream=secondary&from=2000-01-01&to=2100-01-01&pageSize=100", { headers: { "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" } });
      return ((await res.json()) as { rows: { values: { impact: string } }[] }).rows.map((r) => r.values.impact);
    });
    expect(impacts.length).toBeGreaterThan(0);
    // Low by default: every Secondary entry, including Low ones.
    for (const i of impacts) expect(i).toMatch(/Low|Medium|High/);
    expect(impacts).toContain("Low");
    await expectAccessible(page, "/database (client)");
  });

  test("has no Admin or Eradigm Inbox tab: those pages redirect to the Dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = navOf(page);
    await expect(nav.getByRole("link", { name: /Deliverables|Admin/ })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: /^Admin\b/ })).toHaveCount(0);
    await nav.getByRole("button", { name: /^Inputs\b/ }).click();
    await expect(navLink(page, "Inputs", "Client Inbox")).toBeVisible();
    for (const path of ["/inbox", "/input", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
    }
    // Request 52: the old Deliverables page is the Database's Newsletter view.
    await page.goto("/deliverables");
    await expect(page).toHaveURL(/\/database\?db=newsletters$/);
  });

  test("sees the saved-page icon but cannot attach pages", async ({ page }) => {
    await page.goto("/database");
    await expect(page.getByRole("button", { name: /^Open saved page for / }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Attach the HTML page/ })).toHaveCount(0);
  });

  test("cannot edit approved entries", async ({ page }) => {
    await page.goto("/database");
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    await page.getByRole("button", { name: /^Open Markdown for / }).first().click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "✎ Edit" })).toHaveCount(0);
  });

  test("cannot delete tracker entries", async ({ page }) => {
    await page.goto("/database");
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.locator("table tbody td.title button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  });

  test("the Database defaults to everything in view (oldest entry to today) and its two streams add up to the Analytics Dashboard", async ({ page }) => {
    // The Analytics Dashboard (request 31) has no filters: its timeline shows every Tracker entry.
    await page.goto("/dashboard");
    await expect(page.locator(".tl-pt").first()).toBeVisible();
    const all = await page.locator(".tl-pt").count();
    await page.goto("/database");
    await searchDatabase(page, "");
    const bar = page.getByTestId("db-filters");
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const bounds = await page.evaluate(async () => (await fetch("/api/tracker/bounds", { headers: { "x-dev-user": "client@example.com" } })).json());
    await expect(bar.getByLabel("Event Date to")).toHaveValue(bounds.newest > iso(today) ? bounds.newest : iso(today));
    await expect(bar.getByLabel("Event Date from")).toHaveValue(bounds.oldest);
    await expect(page.locator(".dates-banner")).toHaveCount(0);
    const count = async (act: () => Promise<unknown>, stream: string) => {
      const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/database?") && r.url().includes(`stream=${stream}`)), act()]);
      return ((await res.json()) as { total: number }).total;
    };
    // The Database opens on Secondary.
    await expect(page.getByTestId("stream-secondary")).toHaveAttribute("aria-pressed", "true");
    const s1 = await count(() => page.reload(), "secondary");
    const p1 = await count(() => page.getByTestId("stream-primary").click(), "primary");
    expect(p1 + s1).toBe(all);
  });

  test("opens a record from the Database, keeps filters and closes with Escape", async ({ page }) => {
    await page.goto("/database?db.f.impact=High");
    const first = page.locator("td.title button").first();
    const title = await first.innerText();
    await first.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    await expect(dialog.getByText("Provenance")).toBeVisible();
    await expect(dialog.getByText("Analyst revision history")).toBeVisible();
    await expect(page).toHaveURL(/db\.f\.impact=High/);
    await expectAccessible(page, "record drawer");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Active filters" })).toContainText("Impact: High");
  });

  test("filter dropdowns on the Database are searchable", async ({ page }) => {
    await page.goto("/database");
    await searchDatabase(page, "");
    const bar = page.getByTestId("db-filters");
    await bar.getByRole("button", { name: /^All filters/ }).click();
    const macro = bar.getByRole("combobox", { name: "Macrotrend", exact: true });
    await expect(macro).toHaveValue("All");
    await macro.click();
    await macro.fill("geo");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["Geopolitics"]);
    await page.keyboard.press("Enter");
    await expect(page.locator(".pill", { hasText: "Macrotrend:" })).toContainText("Geopolitics");
    await expect(page).toHaveURL(/db\.f\.macrotrend=Geopolitics/);
    // "All" clears the filter again.
    await choose(macro, "All");
    await expect(page.locator(".pill", { hasText: "Macrotrend:" })).toHaveCount(0);
    const comp = bar.getByRole("combobox", { name: "Competitors", exact: true });
    await comp.click();
    await comp.fill("astra");
    await page.keyboard.press("Enter");
    await expect(page.locator(".pill", { hasText: "Competitors:" })).toContainText("AstraZeneca");
    await expectAccessible(page, "/database with searchable filters");
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

  test("exports the filtered Database as CSV", async ({ page }) => {
    await page.goto("/database");
    await page.getByRole("button", { name: /Export/ }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^CSV/ }).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/^eradigm-secondary-database-filtered-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("the Export menu is not cut off when only a few rows are shown", async ({ page }) => {
    await page.goto("/database");
    const first = (await page.locator("table tbody td.title").first().innerText()).trim();
    await searchDatabase(page, first);
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
    // And the whole menu is on screen (request 53: the table's card fills the window, so the menu sits within it).
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  });

  test("pages pass automated accessibility checks", async ({ page }) => {
    for (const path of ["/dashboard", "/database"]) {
      await page.goto(path);
      await expect(page.locator("#main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, path);
    }
  });
});
