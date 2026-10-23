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
