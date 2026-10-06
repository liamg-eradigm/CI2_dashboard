import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("admin role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "admin"));

  test("manages users (the audit log is no longer shown here)", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Deployment status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify integrity" })).toHaveCount(0);

    const email = `e2e.${Date.now()}@example.com`;
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Name", { exact: true }).fill("E2E Person");
    await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("client");
    await page.getByRole("button", { name: "+ Add user" }).click();
    await expect(page.getByRole("cell", { name: email })).toBeVisible();
    // A one-time Microsoft sign-in invite link is shown to send to the new user.
    const box = page.locator(".invite-box");
    await expect(box).toContainText("Invite link for E2E Person");
    const inviteUrl = await box.getByLabel("Invite link").inputValue();
    expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
    const row = page.getByRole("row", { name: new RegExp(email.replace(".", "\\.")) });
    await expect(row.getByText("Invite pending")).toBeVisible();
    await expectAccessible(page, "/admin with invite link");

    // The invite page greets the person and offers Microsoft sign-in.
    const invitePage = await page.context().newPage();
    await invitePage.goto(new URL(inviteUrl).pathname);
    await expect(invitePage.getByRole("heading", { name: "Accept invitation" })).toBeVisible();
    await expect(invitePage.getByText(/E2E Person, you have been invited to/)).toBeVisible();
    await expect(invitePage.getByRole("link", { name: "Accept and sign in with Microsoft" })).toHaveAttribute("href", /^\/api\/auth\/login\?invite=/);
    await expectAccessible(invitePage, "/invite/:token");
    await invitePage.goto("/invite/not-a-real-token-0000000000000000000000");
    await expect(invitePage.getByRole("heading", { name: "Invite link not valid" })).toBeVisible();
    await invitePage.close();
    await page.getByRole("button", { name: "Done" }).click();

    await row.getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText("Deactivated")).toBeVisible();
    await expectAccessible(page, "/admin");
  });

  test("shows the Microsoft sign-in page with clear error messages", async ({ page }) => {
    await page.goto("/signin?error=not_invited");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("not linked to an account on this platform yet");
    await expect(page.getByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute("href", "/api/auth/login?returnTo=%2Fdashboard");
    await expectAccessible(page, "/signin");
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
    // Its Analytics Dashboard plots only its own few entries.
    await expect(page.getByTestId("signal-timeline")).toBeVisible();
    await expect.poll(() => page.locator(".tl-pt").count()).toBeLessThanOrEqual(12);
  });
});
