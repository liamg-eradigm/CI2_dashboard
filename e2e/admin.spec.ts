import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("admin role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "admin"));

  test("verifies the audit chain and manages users", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Deployment status" })).toBeVisible();
    await page.getByRole("button", { name: "Verify integrity" }).click();
    await expect(page.getByText(/Chain intact · \d+ events verified/)).toBeVisible();

    const email = `e2e.${Date.now()}@example.com`;
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Name", { exact: true }).fill("E2E Person");
    await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("client");
    await page.getByRole("button", { name: "+ Add user" }).click();
    await expect(page.getByRole("cell", { name: email })).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(email.replace(".", "\\.")) });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText("Deactivated")).toBeVisible();
    await expectAccessible(page, "/admin");
  });

  test("cannot see another tenant's data", async ({ page }) => {
    await page.goto("/tracker?from=2000-01-01&to=2100-01-01");
    await expect(page.getByText(/of \d+ · page/)).toBeVisible();
    const text = await page.locator("table.data").innerText();
    expect(text).not.toContain("Northwind");
  });
});

test.describe("other tenant", () => {
  test("sees only its own workspace", async ({ page }) => {
    await signInAs(page, "otherTenant");
    await page.goto("/dashboard");
    await expect(page.getByText("Northwind Pharma (demo)").first()).toBeVisible();
    await expect(page.locator(".kpi .v").first()).not.toHaveText("–");
    const n = Number(await page.locator(".kpi").nth(0).locator(".n").innerText().then((t) => t.replace(/\D/g, "")));
    expect(n).toBeLessThanOrEqual(12);
  });
});
