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
    test(`request 72: at ${w}×${h} the charts fill the first screen, level and the same size; the arrow goes down to the two analyses and back`, async ({ page }) => {
      await signInAs(page, "client");
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/dashboard");
      const dash = page.getByTestId("analytics-dashboard");
      await expect(dash.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
      await expect(page.getByTestId("dd-mx-row").first()).toBeVisible();
      // White with a hint of blue.
      expect(await dash.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(245, 250, 251)");
      // Three months to begin with.
      await expect(page.getByRole("group", { name: "Time frame" }).getByRole("button", { name: "3 months" })).toHaveAttribute("aria-pressed", "true");
      const [area, matrix] = [page.locator("section.dd-chart.left"), page.locator("section.dd-chart.right")];
      await expect(area.getByRole("heading", { level: 2 })).toHaveText("Macrotrend activity");
      await expect(matrix.getByRole("heading", { level: 2 })).toHaveText("Competitor signals by Macrotrend");
      const [a, m] = [(await area.boundingBox())!, (await matrix.boundingBox())!];
      expect(Math.abs(a.y - m.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.height - m.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.width - m.width)).toBeLessThanOrEqual(1);
      // The charts and the arrow on the first screen; the analyses below it.
      const down = page.getByTestId("dd-down");
      await expect(down).toBeInViewport({ ratio: 1 });
      expect(a.y + a.height).toBeLessThanOrEqual(h);
      const title = page.getByRole("heading", { level: 2, name: "Macrotrend Analysis" });
      await expect(title).not.toBeInViewport();
      await down.click();
      await expect(title).toBeInViewport();
      await expect(page.getByRole("heading", { level: 2, name: "Competitor Analysis" })).toBeInViewport();
      await expect(page.locator("section.dd-chart.left")).not.toBeInViewport({ ratio: 0.5 });
      await page.getByTestId("dd-up").click();
      await expect(down).toBeInViewport();
      // No capitals-only text.
      expect(await dash.evaluate((el) => [...el.querySelectorAll("*")].filter((x) => getComputedStyle(x).textTransform === "uppercase").length)).toBe(0);
    });
  }

  test("Activity by Macrotrend: grey stacked areas labelled with short names, the selected Macrotrend in teal in its place; it is also the Macrotrend Analysis; its Subtrends and competitors in a popup", async ({ page }) => {
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
    await page.mouse.move(0, 0);
    expect(await chart.locator("path.dd-layer").first().getAttribute("d")).toContain("C");
    // Request 72: one tab per Macrotrend; the selected one in blue, drawn last (on top); the others grey.
    const tabs = chart.getByTestId("dd-tab");
    await expect(tabs.filter({ has: page.locator(":scope[aria-pressed='true']") })).toHaveCount(1);
    const pick = tabs.nth(1);
    const name = (await pick.innerText()).trim();
    await pick.click();
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    // Request 73: selecting never reshuffles the layers; only the selected one turns teal, the rest stay grey.
    const layers = chart.locator("path.dd-layer");
    const order = await layers.evaluateAll((els) => els.map((e) => e.getAttribute("data-layer")));
    await expect(chart.locator(`path.dd-layer[data-layer="${name}"]`)).toHaveAttribute("fill", "#0c7f88");
    expect(await layers.evaluateAll((els) => els.map((e) => e.getAttribute("data-layer")))).toEqual(order);
    await tabs.nth(2).click();
    expect(await layers.evaluateAll((els) => els.map((e) => e.getAttribute("data-layer")))).toEqual(order);
    await expect(chart.locator(`path.dd-layer[data-layer="${name}"]`)).not.toHaveAttribute("fill", "#0c7f88");
    await pick.click();
    for (const f of await layers.evaluateAll((els) => els.filter((e) => !e.hasAttribute("data-selected")).map((e) => e.getAttribute("fill")))) expect(["#d3dfe5", "#b7c9d2", "#e6eef2", "#c5d4dc"]).toContain(f);
    // Each layer wide enough carries its short name, the same as the matrix's.
    const short = ["AI R&D", "AI Upskill", "Dig Innov", "Geo", "Portfolio", "DTP", "Manufact", "Med AI", "Robotics", "Others"];
    const labels = await chart.getByTestId("dd-layer-label").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(short).toContain(l);
    // A dotted line where the last 30 days start.
    await expect(chart.getByTestId("dd-marker")).toContainText("Last 30 days");
    // The same Macrotrend in the Macrotrend Analysis below.
    await expect(page.getByTestId("dd-macro-profile-name")).toHaveText(name);
    // Its Subtrends and its top six competitors.
    await page.getByTestId("dd-breakdown").click();
    const pop = page.getByTestId("dd-macro-popup");
    await expect(pop.getByRole("heading", { level: 2 })).toHaveText(name);
    await expect(pop.getByTestId("dd-pop-subtrends")).toBeVisible();
    expect(await pop.getByTestId("dd-pop-competitors").getByTestId("dd-tab").count()).toBeLessThanOrEqual(7);
    await expectAccessible(page, "Dashboard: a Macrotrend's popup");
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    // The explanation (and the weights) behind the "i".
    await page.locator("section.dd-chart.left").getByRole("button", { name: "About this chart" }).focus();
    await expect(page.locator(".dd-tip")).toContainText("Medium 1.1, High 1.2");
  });

  test("the scatter matrix: a plot per competitor and Macrotrend, signals counted by Impact; a plot opens larger with zoom, drag and titles", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/dashboard");
    const matrix = page.getByTestId("dd-matrix");
    const rows = matrix.getByTestId("dd-mx-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(9);
    expect(await matrix.getByTestId("dd-mx-col").count()).toBeLessThanOrEqual(9);
    // Request 72: short names under the columns, the full name on hover.
    const short = ["AI R&D", "AI Upskill", "Dig Innov", "Geo", "Portfolio", "DTP", "Manufact", "Med AI", "Robotics", "Others"];
    for (const t of await matrix.getByTestId("dd-mx-col").locator("span[aria-hidden]").allInnerTexts()) expect(short).toContain(t.trim());
    const col = matrix.getByTestId("dd-mx-col").first();
    await col.hover();
    await expect(page.locator(".dd-tip")).toHaveText((await col.getAttribute("title"))!);
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
    // It scrolls when the rows need more room than the box has.
    expect(await body.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
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
    // Request 72: focus bars as Prior / Now pairs (the quarter before and this one), grey parts and one in blue.
    await expect(macro.getByTestId("dd-focus-subtrends").locator(".dd-fbar-label")).toHaveText(["Prior", "Now"]);
    await expect(macro.getByTestId("dd-focus-competitors").locator(".dd-fbar-label")).toHaveText(["Prior", "Now"]);
    const compName = (await page.getByTestId("dd-comp-profile-name").innerText()).trim();
    const blue = macro.getByTestId("dd-focus-competitors").locator(".dd-fseg.on");
    if (await blue.count()) expect(await blue.first().evaluate((el) => (el as HTMLElement).style.background)).toBe("rgb(12, 127, 136)");
    if (await blue.count()) await expect(blue.first()).toHaveText(new RegExp(`^(${compName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})?$`));
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
    await expect(comp.getByTestId("dd-focus-last-quarter").locator(".dd-fbar-label")).toHaveText("Prior");
    await expect(comp.getByTestId("dd-focus-this-quarter").locator(".dd-fbar-label")).toHaveText("Now");
    // The Macrotrend picked (Manufacturing) is the blue part of the competitor's bars, when it has one; the parts are short names.
    for (const t of await comp.locator(".dd-fseg").allInnerTexts()) expect(t.length).toBeLessThanOrEqual(10);
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
