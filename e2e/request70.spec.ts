import { expect, expectAccessible, menuOf, signInAs, test } from "./fixtures";

test.describe("request 70: New Entry", () => {
  test("an analyst opens New Entry: a concise source card, Recent captures, and the other sections as bars that open and close", async ({ page }) => {
    await signInAs(page, "analyst");
    // This test sees the page as it first is: every section closed.
    await page.addInitScript(() => localStorage.removeItem("eradigm.newEntry.open"));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/input");
    await expect(page.getByRole("heading", { level: 1, name: "New Entry" })).toBeVisible();
    expect(await menuOf(page)).toEqual(["New Entry", "Eradigm Inbox", "Dashboard", "Database"]);

    // The source card: no note under its title, no "No HTML file?" line; the two buttons stacked beside the drop box,
    // Process file level with its top, Manual entry with its bottom, the same size.
    const card = page.getByTestId("source-card");
    await expect(card).not.toContainText("Sent to the Eradigm Inbox as");
    await expect(card).not.toContainText("No HTML file?");
    const drop = (await card.getByTestId("drop-zone-html").boundingBox())!;
    const process = (await card.getByRole("button", { name: /^Process file/ }).boundingBox())!;
    const manual = (await card.getByRole("button", { name: "✎ Manual entry" }).boundingBox())!;
    expect(Math.abs(process.y - drop.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(manual.y + manual.height - (drop.y + drop.height))).toBeLessThanOrEqual(1);
    expect(Math.abs(process.width - manual.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(process.height - manual.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(process.x - manual.x)).toBeLessThanOrEqual(1);

    // Recent captures: title, impact as a coloured dot, and the date of the event.
    const recent = page.getByTestId("recent-captures");
    await expect(recent.getByRole("heading", { name: "Recent captures" })).toBeVisible();
    const rows = recent.locator(".nx-recent-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(8);
    await expect(recent.getByRole("img", { name: /^(High|Medium|Low) impact$/ }).first()).toBeVisible();
    await expect(recent.locator(".nx-recent-date").filter({ hasText: /^\d{1,2} \w{3} \d{4}$/ }).first()).toBeVisible();

    // Import spreadsheet, Input trend analysis, Input earnings call and Capture log: bars with their names.
    const bars = page.locator(".nx-bar");
    await expect(bars.locator(".nx-title")).toHaveText(["Import spreadsheet", "Input trend analysis", "Input earnings call", "Capture log"]);
    for (const b of await bars.all()) await expect(b).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("trend-analysis-input")).toHaveCount(0);
    await expectAccessible(page, "New Entry, sections closed");
    await page.getByRole("button", { name: /Input trend analysis/ }).click();
    await expect(page.getByTestId("trend-analysis-input")).toBeVisible();
    await expect(page.getByRole("button", { name: /Input trend analysis/ })).toHaveAttribute("aria-expanded", "true");
    await expectAccessible(page, "New Entry, a section open");
    // Kept open on this computer (back on the page from the menu), and closed again.
    await page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" }).getByRole("link", { name: "Dashboard", exact: true }).click();
    await page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" }).getByRole("link", { name: "New Entry", exact: true }).click();
    await expect(page.getByTestId("trend-analysis-input")).toBeVisible();
    await page.getByRole("button", { name: /Input trend analysis/ }).click();
    await expect(page.getByTestId("trend-analysis-input")).toHaveCount(0);
    // A link to a section opens it.
    await page.goto("/input#earnings-call");
    await expect(page.getByTestId("earnings-call-input")).toBeVisible();
  });
});

test.describe("request 70: the Dashboard", () => {
  for (const [w, h] of [
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    test(`two columns on one page at ${w}×${h}: the two charts level and the same size, then the two Profiles`, async ({ page }) => {
      await signInAs(page, "client");
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/dashboard");
      const dash = page.getByTestId("analytics-dashboard");
      await expect(dash.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
      await expect(dash.getByRole("heading", { level: 2 })).toHaveText(["Macrotrends Analysis", "Competitor Analysis"]);
      await expect(page.getByTestId("dd-mx-row").first()).toBeVisible();
      // Three months to begin with.
      await expect(page.getByRole("group", { name: "Time frame" }).getByRole("button", { name: "3 months" })).toHaveAttribute("aria-pressed", "true");
      const [area, matrix] = [page.locator("section.dd-chart.left"), page.locator("section.dd-chart.right")];
      const [a, m] = [(await area.boundingBox())!, (await matrix.boundingBox())!];
      expect(Math.abs(a.y - m.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.height - m.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.width - m.width)).toBeLessThanOrEqual(1);
      const [mp, cp] = [(await page.getByTestId("dd-macro-profile").boundingBox())!, (await page.getByTestId("dd-comp-profile").boundingBox())!];
      expect(Math.abs(mp.y - cp.y)).toBeLessThanOrEqual(1);
      expect(mp.y).toBeGreaterThan(a.y + a.height - 1);
      // No scrolling.
      const s = await dash.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, doc: document.documentElement.scrollHeight }));
      expect(s.sh).toBeLessThanOrEqual(s.ch);
      expect(s.doc).toBeLessThanOrEqual(h);
      // No capitals-only text.
      expect(await dash.evaluate((el) => [...el.querySelectorAll("*")].filter((x) => getComputedStyle(x).textTransform === "uppercase").length)).toBe(0);
    });
  }

  test("Activity by Macrotrend: stacked areas; a layer opens its Subtrends and its top competitors", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto("/dashboard");
    const chart = page.getByTestId("dd-activity");
    await expect(chart.locator("path.dd-layer").first()).toBeVisible();
    await expect(chart.locator(".dd-axis-title")).toHaveText("Activity");
    await expectAccessible(page, "Dashboard");
    // Request 71: each point is a month's Activity (the 30 days up to it), the line smooth (curves, not corners).
    const box = (await chart.locator(".dd-area-plot").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height - 30);
    await expect(page.locator(".dd-tip")).toContainText(/^Month to \d{1,2} \w{3} \d{4}/);
    expect(await chart.locator("path.dd-layer").first().getAttribute("d")).toContain("C");
    await expect(page.locator(".dd-tip")).toContainText("Total Activity");
    const legend = chart.getByRole("list", { name: /legend/ });
    const first = legend.getByRole("button").first();
    const name = (await first.locator(".dd-legend-name").innerText()).trim();
    await first.click();
    const pop = page.getByTestId("dd-macro-popup");
    await expect(pop.getByRole("heading", { level: 2 })).toHaveText(name);
    await expect(pop.getByTestId("dd-pop-subtrends")).toBeVisible();
    const comps = pop.getByTestId("dd-pop-competitors").getByRole("list", { name: /legend/ }).getByRole("button");
    expect(await comps.count()).toBeLessThanOrEqual(7);
    await expectAccessible(page, "Dashboard: a Macrotrend's popup");
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    // The explanation sits behind the "i".
    await chart.locator("xpath=ancestor::section[1]").getByRole("button", { name: "About this chart" }).focus();
    await expect(page.locator(".dd-tip")).toContainText("Activity of the month up to it");
  });

  test("the scatter matrix: a plot per competitor and Macrotrend, signals counted by Impact; a plot opens larger with zoom, drag and titles", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/dashboard");
    const matrix = page.getByTestId("dd-matrix");
    const rows = matrix.getByTestId("dd-mx-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(9);
    expect(await matrix.getByTestId("dd-mx-col").count()).toBeLessThanOrEqual(9);
    await expect(rows.first().locator(".dd-mx-count")).toHaveText(/^\d+ signals? \(\d+H, \d+M, \d+L\)$/);
    // Request 71: every dot in its full Impact colour; larger the stronger its growth (5, 6.5 or 8 px).
    const dots = await matrix.getByTestId("dd-mx-dot").evaluateAll((els) => els.map((e) => ({ bg: getComputedStyle(e).backgroundColor, w: e.getBoundingClientRect().width })));
    expect(new Set(dots.map((d) => d.bg)).size).toBeLessThanOrEqual(4);
    for (const d of dots) expect(["rgb(63, 179, 127)", "rgb(232, 163, 61)", "rgb(229, 83, 75)", "rgb(139, 154, 166)"]).toContain(d.bg);
    for (const d of dots) expect([5, 6.5, 8]).toContain(Math.round(d.w * 2) / 2);
    expect(new Set(dots.map((d) => Math.round(d.w * 2) / 2)).size).toBeGreaterThan(1);
    await rows.first().locator("button.dd-mx-cell").first().click();
    const pop = page.getByTestId("dd-scatter-popup");
    await expect(pop).toBeVisible();
    const dot = pop.getByTestId("dd-scatter-dot").first();
    await dot.hover();
    await expect(page.locator(".dd-tip .dd-tip-title")).not.toBeEmpty();
    // Zoom with the wheel, then drag along time, then Reset.
    const reset = pop.getByRole("button", { name: "Reset" });
    await expect(reset).toBeDisabled();
    const b = (await pop.locator(".dd-scatter").boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 30);
    await page.mouse.wheel(0, -400);
    await expect(reset).toBeEnabled();
    const ticks = async () => (await pop.locator(".dd-xtick").allInnerTexts()).join("|");
    const before = await ticks();
    await page.mouse.move(b.x + b.width * 0.7, b.y + 30);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.3, b.y + 30, { steps: 5 });
    await page.mouse.up();
    await expect.poll(ticks).not.toBe(before);
    await reset.click();
    await expect(reset).toBeDisabled();
    await expectAccessible(page, "Dashboard: a scatter plot's popup");
    // Pressing a signal opens its record.
    await pop.getByTestId("dd-scatter-dot").first().click();
    await expect(page).toHaveURL(/signal=/);
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("Show all makes the matrix scroll through every competitor", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    // More competitors than the seed has: six more, each named by one recent signal.
    await page.route("**/api/competitors?*", async (route) => {
      const real = await (await route.fetch()).json();
      const base = real.entries[0];
      const date = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
      const extra = ["Bayer", "Takeda", "Amgen", "GSK", "Merck & Co.", "Eli Lilly"].map((c, i) => ({ ...base, id: `extra-${i}`, code: `X-${i}`, title: `${c} news`, date, competitors: [c] }));
      await route.fulfill({ json: { ...real, entries: [...real.entries, ...extra] } });
    });
    await page.goto("/dashboard");
    await page.getByRole("group", { name: "Time frame" }).getByRole("button", { name: "All" }).click();
    const show = page.getByRole("button", { name: /^Show all \d+/ });
    await expect(show).toBeVisible();
    const n = Number((await show.innerText()).match(/\d+/)![0]);
    expect(n).toBeGreaterThan(9);
    const body = page.locator(".dd-mx-body");
    const h = (await body.boundingBox())!.height;
    await show.click();
    await expect(page.getByTestId("dd-mx-row")).toHaveCount(n);
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto")).toBe(true);
    expect(Math.abs((await body.boundingBox())!.height - h)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Show the top 9" }).click();
    await expect(page.getByTestId("dd-mx-row")).toHaveCount(9);
  });

  test("the Profiles: five icons and a search, the change in Activity, the analysis or Company Profile, two focus bars, and a footer", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/dashboard");
    for (const id of ["dd-macro-profile", "dd-comp-profile"]) {
      const p = page.getByTestId(id);
      const picker = p.getByRole("group", { name: /^Choose a / });
      await expect(picker.getByRole("button")).toHaveCount(6);
      await expect(picker.getByRole("button", { pressed: true })).toHaveCount(1);
      await expect(p.getByTestId("dd-change")).toHaveText(/^(▲ |▼ )?([+-]?\d+%|New|—)/);
    }
    const macro = page.getByTestId("dd-macro-profile");
    await expect(macro.getByTestId("dd-focus-subtrends")).toBeVisible();
    await expect(macro.getByTestId("dd-focus-competitors")).toBeVisible();
    // Another Macrotrend from the icons.
    const second = macro.getByRole("group", { name: /^Choose a / }).getByRole("button").nth(1);
    const name = await second.getAttribute("aria-label");
    await second.click();
    await expect(macro.getByTestId("dd-macro-profile-name")).toHaveText(name!);
    await expect(second).toHaveAttribute("aria-pressed", "true");
    // Any Macrotrend from the search, Manufacturing (no Subtrends) among them.
    await macro.getByRole("button", { name: /^Search every Macrotrend/ }).click();
    const search = macro.getByLabel("Search for a Macrotrend");
    await search.fill("manuf");
    await page.keyboard.press("Enter");
    await expect(macro.getByTestId("dd-macro-profile-name")).toHaveText("Manufacturing");
    await expect(macro.getByTestId("dd-focus-subtrends")).toContainText(/no Subtrends yet|No signals/);
    await expect(macro.getByTestId("dd-macro-open")).toHaveAttribute("href", "/analytics/megatrends?m=Manufacturing");
    // The competitor's quarters and Company Profile.
    const comp = page.getByTestId("dd-comp-profile");
    await expect(comp.getByTestId("dd-focus-this-quarter")).toContainText("This quarter");
    await expect(comp.getByTestId("dd-focus-last-quarter")).toContainText("Last quarter");
    await expect(comp.getByTestId("dd-comp-profile-text")).toContainText("Company profile");
    await expect(macro.getByTestId("dd-macro-profile-text")).toContainText("Analysis");
    await expect(comp.getByRole("link", { name: "Add a logo" })).toHaveCount(0);
    await expectAccessible(page, "Dashboard Profiles");
    // The Macrotrend Analysis box opens the Macrotrend's analysis page (no knowledge graph).
    await macro.getByTestId("dd-macro-open").click();
    await expect(page).toHaveURL(/\/analytics\/megatrends\?m=Manufacturing/);
  });

  test("admins set a competitor's logo, and the Competitor Profile shows it", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/dashboard");
    const comp = page.getByTestId("dd-comp-profile");
    const name = (await comp.getByTestId("dd-comp-profile-name").innerText()).trim();
    await comp.getByRole("link", { name: "Add a logo" }).click();
    await expect(page).toHaveURL(/\/admin#competitor-logos$/);
    const card = page.getByTestId("competitor-logos");
    await expect(card).toBeInViewport();
    const row = card.getByTestId("logo-row").filter({ hasText: name });
    // A 1×1 PNG.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    await row.getByLabel(`Upload the logo of ${name}`).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await expect(page.locator(".toast").first()).toContainText(`Logo of ${name} saved`);
    await expect(row.locator(".dd-icon.logo img")).toBeVisible();
    await expectAccessible(page, "Admin with competitor logos");
    await page.goto("/dashboard");
    await expect(comp.getByRole("group", { name: /^Choose a / }).getByRole("button", { name, exact: true }).locator(".dd-icon.logo img")).toBeVisible();
    await expect(comp.getByRole("link", { name: "Add a logo" })).toHaveCount(0);
    // Remove it again (the other tests see initials).
    await page.goto("/admin#competitor-logos");
    await card.getByTestId("logo-row").filter({ hasText: name }).getByRole("button", { name: `Remove the logo of ${name}` }).click();
    await expect(page.locator(".toast").first()).toContainText(`Logo of ${name} removed`);
  });
});

test.describe("request 71: the Dashboard", () => {
  test("a handle shares the height between the charts and the Profiles, and is remembered", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("split-set")) {
        localStorage.removeItem("eradigm.dashboard.split");
        sessionStorage.setItem("split-set", "1");
      }
    });
    await page.goto("/dashboard");
    const chart = page.locator("section.dd-chart.left");
    const profile = page.getByTestId("dd-macro-profile");
    await expect(page.getByTestId("dd-mx-row").first()).toBeVisible();
    const h0 = (await chart.boundingBox())!.height;
    const p0 = (await profile.boundingBox())!.height;
    // Drag the handle up: shorter charts, taller Profiles; the page still fits.
    const split = page.getByRole("separator", { name: "Resize the charts and the profiles" });
    const s = (await split.boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 - 120, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await chart.boundingBox())!.height).toBeLessThan(h0 - 80);
    expect((await profile.boundingBox())!.height).toBeGreaterThan(p0 + 80);
    // Both columns move together.
    expect(Math.abs((await page.locator("section.dd-chart.right").boundingBox())!.height - (await chart.boundingBox())!.height)).toBeLessThanOrEqual(1);
    const dash = page.getByTestId("analytics-dashboard");
    expect(await dash.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    // Kept on this computer.
    const after = (await chart.boundingBox())!.height;
    await page.reload();
    await expect(page.getByTestId("dd-mx-row").first()).toBeVisible();
    expect(Math.abs((await chart.boundingBox())!.height - after)).toBeLessThanOrEqual(2);
    // With the keyboard: End gives the charts the most room, Enter goes back to the default.
    await split.focus();
    await page.keyboard.press("End");
    await expect(split).toHaveAttribute("aria-valuenow", "75");
    await page.keyboard.press("Enter");
    await expect(split).toHaveAttribute("aria-valuenow", "56");
    await expectAccessible(page, "Dashboard with the handle");
  });
});
