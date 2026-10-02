import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ADMIN = { "x-dev-user": "admin@example.com" };

/** Runs fetch() in the page as the admin and returns the JSON body. */
async function apiAs<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, path, body, h }) => {
      const r = await fetch(path, { method, headers: { ...h, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
      return r.json();
    },
    { method, path, body, h: ADMIN },
  );
}

test.describe("request 20", () => {
  test("Pushed & Rejected: capitalised, and Delete All clears it (pushed entries stay in the Tracker)", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/inbox");
    const { item } = await apiAs(page, "POST", "/api/submissions/manual", { stream: "secondary" });
    await apiAs(page, "POST", `/api/items/${item.id}/reject`, { version: item.version, reason: "Off topic" });
    await page.reload();
    const tab = page.getByRole("button", { name: /^Pushed & Rejected \(\d+\)$/ });
    await expect(tab).toBeVisible();
    await expect(page.getByRole("button", { name: /Pushed & rejected/ })).toHaveCount(0);
    // Delete All shows only in this view.
    await expect(page.getByTestId("delete-all")).toHaveCount(0);
    await tab.click();
    await expect(page.getByText(item.code, { exact: true })).toBeVisible();
    const trackerBefore = (await apiAs(page, "GET", "/api/tracker?stream=secondary&pageSize=1000")).total as number;

    let prompt = "";
    page.once("dialog", (d) => {
      prompt = d.message();
      void d.accept();
    });
    await page.getByTestId("delete-all").click();
    await expect(page.getByRole("status").filter({ hasText: /Pushed & Rejected cleared/ })).toBeAttached();
    expect(prompt).toContain("rejected entr");
    expect(prompt).toContain("stay");
    await expect(tab).toHaveText("Pushed & Rejected (0)");
    await expect(page.getByText("Nothing here.")).toBeVisible();
    await expect(page.getByTestId("delete-all")).toHaveCount(0);
    expect((await apiAs(page, "GET", `/api/items/${item.id}`)).status).toBe("deleted");
    // The pushed entries left the Inbox, not the Tracker.
    expect((await apiAs(page, "GET", "/api/tracker?stream=secondary&pageSize=1000")).total).toBe(trackerBefore);
    await expectAccessible(page, "Inbox · Pushed & Rejected cleared");
  });

  test("Tell Me More as Long text: the same box as Key Details, with bullet indenting", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/inbox");
    const schema = await apiAs(page, "GET", "/api/schema?stream=secondary");
    if (!schema.columns.some((c: { label: string }) => c.label === "Tell Me More")) await apiAs(page, "POST", "/api/schema/columns?stream=secondary", { label: "Tell Me More", type: "text" });
    await apiAs(page, "POST", "/api/submissions/manual", { stream: "secondary" });
    await page.reload();

    // Switch it in Edit columns.
    await page.getByRole("button", { name: "Edit columns" }).click();
    await page.getByRole("button", { name: /^Tell Me More: Text\. Switch to Long text$/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Tell Me More is now Long text" })).toBeAttached();
    await expect(page.getByRole("button", { name: /^Tell Me More: Long text\. Switch to Text$/ })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: "Secondary", exact: true }).click();
    const card = page.locator(".inbox-card").first();
    const more = card.getByRole("textbox", { name: "Tell Me More", exact: true });
    const details = card.getByRole("textbox", { name: "Key Details", exact: true });
    await expect(more).toBeVisible();
    expect(await more.evaluate((el) => el.tagName)).toBe("TEXTAREA");
    const [a, b] = [await more.boundingBox(), await details.boundingBox()];
    expect(Math.abs(a!.height - b!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);

    await more.fill("");
    await more.pressSequentially("- First point");
    await more.press("Enter");
    await more.press("Tab");
    await more.pressSequentially("Sub point");
    await expect(more).toHaveValue("- First point\n  - Sub point");
  });

  test("Megatrends (requests 21 and 22): the summary fills three quarters of a right-hand column in large type; the graph runs the full height", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/megatrends");
    const panel = page.getByTestId("mg-panel");
    await expect(panel).toBeVisible();
    // No "Knowledge graph" kicker or "Drag to rotate" hint.
    await expect(page.getByText("Knowledge graph", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Drag to rotate/)).toHaveCount(0);
    await expect(page.getByText(/AI summaries switch on/)).toHaveCount(0);

    const stage = (await page.locator(".mg-stage").boundingBox())!;
    const shell = (await page.getByTestId("megatrends").boundingBox())!;
    const timeline = (await page.getByTestId("mg-timeline").boundingBox())!;
    // The graph starts at the top of the page and runs down to the timeline.
    expect(stage.y - shell.y).toBeLessThanOrEqual(20);
    expect(timeline.y - (stage.y + stage.height)).toBeLessThanOrEqual(20);
    // The column is on the right: the summary on top (about 3/4), the Macrotrend list below (about 1/4).
    const p = (await panel.boundingBox())!;
    const rail = (await page.locator("#mg-rail").boundingBox())!;
    expect(stage.x + stage.width - (p.x + p.width)).toBeLessThan(40);
    expect(p.x).toBeGreaterThan(stage.x + stage.width / 2);
    expect(rail.y).toBeGreaterThanOrEqual(p.y + p.height);
    expect(p.height / (p.height + rail.height)).toBeGreaterThan(0.68);
    expect(p.height / (p.height + rail.height)).toBeLessThan(0.82);
    // Breadcrumbs stay at the top left of the graph.
    const crumbs = (await page.getByRole("navigation", { name: "Graph level" }).boundingBox())!;
    expect(crumbs.x - stage.x).toBeLessThan(40);

    // Select a Macrotrend: its summary in large type, in the same lighter box.
    await page.getByTestId("mg-macros").getByRole("button").first().click();
    await expect(page.locator("#mg-panel-title")).toBeVisible();
    expect(parseFloat(await panel.getByTestId("mg-summary").evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
    const style = await panel.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, align: getComputedStyle(el).textAlign }));
    expect(style.align).not.toBe("center");
    const [r, g, b] = style.bg.match(/[\d.]+/g)!.map(Number);
    // A shade lighter than the page (#072233 at the top), not a different colour.
    expect(r).toBeGreaterThan(7);
    expect(r + g + b).toBeLessThan(200);
    expect(b).toBeGreaterThan(r);
    await expectAccessible(page, "Megatrends · summary column");
  });
});
