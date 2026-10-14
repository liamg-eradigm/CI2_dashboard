import { expect, signInAs, test } from "./fixtures";

const MACRO = "Robotics and Open-source Models for Pharma";

test.describe("request 60", () => {
  test("numbered lists in the Megatrends Dashboard's text keep counting: split by blank lines, with a second line in an item, or with the numbers typed", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 1440, height: 900 });
    const cell = page.getByTestId("md-section-overview");
    const numbers = () =>
      cell.locator(".rich-text ol > li").evaluateAll((lis) =>
        lis.map((li) => {
          const ol = li.parentElement!;
          return Number(ol.getAttribute("start") || 1) + [...ol.children].indexOf(li);
        }),
      );
    const write = async (keys: (string | { key: string })[]) => {
      await page.goto(`/analytics/megatrends?${new URLSearchParams({ m: MACRO })}`);
      await cell.getByRole("button", { name: /^Edit / }).click();
      const editor = cell.locator(".rt-editor");
      await editor.click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Delete");
      for (const k of keys) await (typeof k === "string" ? page.keyboard.type(k) : page.keyboard.press(k.key));
      await cell.getByRole("button", { name: "Save" }).click();
      await expect(cell.locator(".rich-text")).toBeVisible();
    };
    const enter = { key: "Enter" };

    // A blank line between the items (the reported case): 1, 2, 3, not 1, 1, 1.
    await write(["1. First", enter, enter, enter, "2. Second", enter, enter, enter, "3. Third"]);
    await expect.poll(numbers).toEqual([1, 2, 3]);
    await expect(cell.locator(".rich-text ol > li")).toHaveText(["First", "Second", "Third"]);

    // The numbers typed by hand in the list: not doubled ("2. 2.").
    await write(["1. First", enter, "2. Second", enter, "3. Third"]);
    await expect.poll(numbers).toEqual([1, 2, 3]);
    await expect(cell.locator(".rich-text ol > li")).toHaveText(["First", "Second", "Third"]);

    // A second line in an item (Shift+Enter) stays in it, and the list goes on.
    await write(["1. First", { key: "Shift+Enter" }, "still the first", enter, "Second", enter, "Third"]);
    await expect.poll(numbers).toEqual([1, 2, 3]);
    await expect(cell.locator(".rich-text ol > li").first()).toContainText("still the first");
    await expect(cell.locator(".rich-text ol")).toHaveCount(1);
    // Opened again, the editor shows the same list.
    await cell.getByRole("button", { name: /^Edit / }).click();
    await expect(cell.locator(".rt-editor ol > li")).toHaveCount(3);
    await expect(cell.locator(".rt-editor ol > li").first().locator("br")).toHaveCount(1);
  });
});
