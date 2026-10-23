import { expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("admin role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "admin"));

  test("manages people and their access to each project (the audit log is no longer shown here)", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Admin", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Deployment status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify integrity" })).toHaveCount(0);

    const email = `e2e.${Date.now()}@example.com`;
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Name", { exact: true }).fill("E2E Person");
    await expect(page.getByRole("combobox", { name: "Project", exact: true })).toHaveValue("t_demo");
    await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("client");
    await page.getByRole("button", { name: "+ Add person" }).click();
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

    // Request 61: their access per project — a client of CI SQUARED, nothing in Epilepsy; then none at all.
    const ci = row.getByRole("combobox", { name: "E2E Person: access to CI SQUARED" });
    await expect(ci).toHaveValue("client");
    await expect(row.getByRole("combobox", { name: "E2E Person: access to Epilepsy" })).toHaveValue("");
    await row.getByRole("combobox", { name: "E2E Person: access to Epilepsy" }).selectOption("analyst");
    await expect(page.locator(".toast").last()).toContainText("is now Analyst in Epilepsy");
    page.once("dialog", (d) => void d.accept());
    await ci.selectOption("");
    await expect(page.locator(".toast").last()).toContainText("no longer has access to CI SQUARED");
    await expect(ci).toHaveValue("");
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
    // Its Dashboard plots only its own few entries (request 70: since the first one).
    await page.getByRole("group", { name: "Time frame" }).getByRole("button", { name: "All" }).click();
    await expect(page.getByTestId("dd-matrix")).toBeVisible();
    // Its rows are its own competitors (from its own few entries), nobody else's.
    const own = await page.evaluate(async () => {
      const d = await (await fetch("/api/competitors?stream=all", { headers: { "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" } })).json();
      return { names: (d.competitors as { name: string }[]).map((c) => c.name), entries: (d.entries as unknown[]).length };
    });
    expect(own.entries).toBeLessThanOrEqual(12);
    const rows = await page.locator(".dd-mx-name").allInnerTexts();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(own.names).toContain(r.trim());
  });
});
