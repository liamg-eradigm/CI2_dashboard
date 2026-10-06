import type { Page } from "@playwright/test";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

const R_AND_D = "AI Investment in R&D";
const rank = (t: string) => ["High", "Medium", "Low"].findIndex((x) => t.startsWith(`${x} impact`));

/** The sources rows' Impact (from each row's spoken text), in list order. */
async function impacts(page: Page) {
  const texts = await page.getByTestId("mg-sources").locator(".mg-source-list .sr-only").allTextContents();
  return texts.map((t) => (rank(t) < 0 ? 3 : rank(t)));
}

test.describe("request 26: sources list on the right", () => {
  test("Competitors: selecting one lists its sources by Impact; a source opens in place, with ← back to the list; the graph moves left", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/competitors");
    const sheet = page.getByTestId("mg-sheet");
    await expect(page.getByTestId("mg-timeline")).toBeVisible();
    await expect(sheet).not.toHaveClass(/open/);

    await page.goto("/competitors?c=Pfizer");
    await expect(sheet).toHaveClass(/open/);
    const list = sheet.getByRole("list", { name: "Sources of Pfizer" });
    await expect(list).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Pfizer" })).toBeVisible();
    const n = await list.getByRole("button").count();
    expect(n).toBeGreaterThan(5);
    // High first, then Medium, then Low.
    const order = await impacts(page);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBe(0);
    // The row: the Impact dot first, then the title filling the rest (measured once the drawer has slid in).
    await page.waitForTimeout(600);
    const row = list.getByRole("button").first();
    const dot = (await row.locator(".dot").boundingBox())!;
    const name = (await row.locator(".nm").boundingBox())!;
    const rb = (await row.boundingBox())!;
    expect(dot.x).toBeLessThan(name.x);
    expect(dot.x - rb.x).toBeLessThan(20);
    expect(name.width).toBeGreaterThan(rb.width * 0.75);
    await expect(row.locator(".dot")).toHaveCSS("background-color", "rgb(229, 83, 75)");
    // Half the page wide (request 34), the full height; the list scrolls inside it.
    const box = (await sheet.boundingBox())!;
    const half = (await page.locator(".mg-page").boundingBox())!.width / 2 - 24;
    expect(Math.abs(box.width - half)).toBeLessThan(2);
    expect(box.height).toBeGreaterThan(900 * 0.9);
    expect(await list.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    await expectAccessible(page, "Competitors with the sources list");

    // A source opens in the same drawer (same size), with ← back to the list.
    const title = (await row.locator(".nm").textContent())!.trim();
    await row.click();
    await expect(page).toHaveURL(/e=/);
    await expect(sheet.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await expect(list).toBeHidden();
    await expect(sheet.getByText(`1 of ${n}`)).toBeVisible();
    const box2 = (await sheet.boundingBox())!;
    expect(Math.abs(box2.width - box.width)).toBeLessThan(2);
    expect(Math.abs(box2.height - box.height)).toBeLessThan(2);
    // › steps through the list.
    await sheet.getByRole("button", { name: "Next entry in the sources list" }).click();
    await expect(sheet.getByText(`2 of ${n}`)).toBeVisible();
    await sheet.getByTestId("mg-back").click();
    await expect(page).not.toHaveURL(/e=/);
    await expect(list).toBeVisible();
    await expect(list.getByRole("button").nth(1)).toBeFocused();

    // ✕ hides the list; "Sources" brings it back. Esc: from a source back to the list, then hides it.
    await sheet.getByRole("button", { name: "Close the sources list" }).click();
    await expect(sheet).not.toHaveClass(/open/);
    await page.getByTestId("mg-sources-open").click();
    await expect(list).toBeVisible();
    await list.getByRole("button").first().click();
    await expect(sheet.getByTestId("mg-back")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).not.toHaveClass(/open/);

    // All competitors: no list.
    await page.getByRole("navigation", { name: "Graph level" }).getByRole("button", { name: "Competitors", exact: true }).click();
    await expect(page.getByTestId("mg-sources-open")).toHaveCount(0);
    await expect(sheet).not.toHaveClass(/open/);
  });

  test("Megatrends: a Subtrend lists its sources (a Macrotrend does not)", async ({ page }) => {
    await signInAs(page, "client");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/megatrends?m=${encodeURIComponent(R_AND_D)}`);
    const sheet = page.getByTestId("mg-sheet");
    await expect(page.getByRole("navigation", { name: "Graph level" }).getByRole("button", { name: R_AND_D })).toBeVisible();
    await expect(sheet).not.toHaveClass(/open/);
    await expect(page.getByTestId("mg-sources-open")).toHaveCount(0);

    await page.getByRole("list", { name: "Legend" }).getByRole("button", { name: /Computational Infrastructure/ }).click();
    await expect(sheet).toHaveClass(/open/);
    const list = sheet.getByRole("list", { name: "Sources of Computational Infrastructure" });
    await expect(list).toBeVisible();
    const n = await list.getByRole("button").count();
    const balls = await page.getByTestId("mg-ball").count();
    expect(n).toBe(balls);
    const order = await impacts(page);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    await expectAccessible(page, "Megatrends with the sources list");

    await list.getByRole("button").first().click();
    await expect(sheet.locator("dd", { hasText: "Computational Infrastructure" })).toBeVisible();
    await sheet.getByRole("button", { name: /^Back to the sources of Computational Infrastructure/ }).click();
    await expect(list).toBeVisible();
    // ✕ on a source closes the drawer.
    await list.getByRole("button").first().click();
    await sheet.getByRole("button", { name: "Close entry" }).click();
    await expect(sheet).not.toHaveClass(/open/);
    await expect(page.getByTestId("mg-sources-open")).toBeVisible();
  });
});
