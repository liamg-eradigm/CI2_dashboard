import { expect, expectAccessible, signInAs, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ANALYST = { "x-dev-user": "l.griffith@example.com" };
const navLinks = (page: Page) => page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" }).getByRole("link").allInnerTexts();
const clean = (l: string[]) => l.map((t) => t.replace(/\s*\d+$/, "").trim());

/** A Secondary entry awaiting review with every field filled in (through the API, as an analyst). */
async function draftEntry(page: Page, title: string) {
  return page.evaluate(
    async ({ title, h }) => {
      const j = { ...h, "content-type": "application/json" };
      const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: j, body: JSON.stringify({ stream: "secondary" }) })).json();
      const values = {
        ...item.draft,
        record_id: `S-${Date.now().toString(36)}`,
        title,
        date: "2026-09-20",
        macrotrend: "Geopolitics",
        subtrend: "IRA Pricing/Tariffs",
        growth: "Stable",
        impact: "Medium",
        source: "PR",
        competitors: ["Pfizer"],
        action: "Not Actioned",
        key_details: "Pfizer agreed a most-favored-nation price deal with CMS for its Medicaid portfolio.",
      };
      const r = await fetch(`/api/items/${item.id}/draft`, { method: "PATCH", headers: j, body: JSON.stringify({ values, version: item.version }) });
      if (!r.ok) throw new Error(await r.text());
      return { id: item.id as string, code: item.code as string };
    },
    { title, h: ANALYST },
  );
}

test.describe("request 19", () => {
  test("each role sees only its tabs", async ({ page, browser }) => {
    await signInAs(page, "analyst");
    await page.goto("/dashboard");
    await expect.poll(async () => clean(await navLinks(page))).toEqual(["Dashboard", "Tracker", "Phantoms", "Megatrends", "Competitors", "Eradigm Inbox"]);
    for (const path of ["/input", "/admin", "/deliverables", "/client-inbox"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
    }
    const ctx = await browser.newContext();
    const client = await ctx.newPage();
    await signInAs(client, "client");
    await client.goto("/dashboard");
    await expect.poll(async () => clean(await navLinks(client))).toEqual(["Dashboard", "Tracker", "Phantoms", "Megatrends", "Competitors", "Client Inbox"]);
    await ctx.close();
    const actx = await browser.newContext();
    const admin = await actx.newPage();
    await signInAs(admin, "admin");
    await admin.goto("/dashboard");
    await expect.poll(async () => clean(await navLinks(admin))).toEqual(["Dashboard", "Tracker", "Phantoms", "Deliverables", "Megatrends", "Competitors", "Eradigm Inbox", "Client Inbox", "Input", "Administration"]);
    await actx.close();
  });

  test("Eradigm Inbox → Client Inbox with comments → back to Eradigm → Push to Tracker", async ({ page, browser }) => {
    await signInAs(page, "analyst");
    await page.goto("/inbox");
    const title = `Pfizer MFN deal ${Date.now().toString(36)}`;
    const e = await draftEntry(page, title);
    await page.reload();
    const card = page.locator(".inbox-card", { has: page.locator(".code", { hasText: e.code }) });
    // One inbox for both trackers: each entry says which.
    await expect(card.getByTestId("stream-tag")).toHaveText("Secondary");
    await expect(card.getByRole("button", { name: "✓ Push to Tracker" })).toBeVisible();
    await expect(card.getByRole("button", { name: "✕ Reject" })).toBeVisible();
    await card.getByRole("button", { name: "↗ Send to Client" }).click();
    await expect(page.getByRole("button", { name: /^With client \(\d+\)/ })).toBeVisible();
    await page.getByRole("button", { name: /^With client/ }).click();
    await expect(card).toContainText("With the client");
    await expect(card.getByRole("button", { name: "✓ Push to Tracker" })).toHaveCount(0);

    // The client comments on highlighted words and sends it back.
    const ctx = await browser.newContext();
    const client = await ctx.newPage();
    await signInAs(client, "client");
    await client.goto("/dashboard");
    await client.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" }).getByRole("link", { name: /Client Inbox/ }).click();
    const cc = client.getByTestId("client-card").filter({ hasText: title });
    await expect(cc).toBeVisible();
    const kd = cc.locator('.ct-text[data-field="key_details"]');
    await kd.evaluate((el) => {
      const node = el.querySelector("span")!.firstChild!;
      const text = node.textContent!;
      const i = text.indexOf("most-favored-nation price deal");
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + "most-favored-nation price deal".length);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await client.getByRole("button", { name: "💬 Comment" }).click();
    const box = client.getByRole("dialog", { name: "Add a comment" });
    await expect(box).toContainText("“most-favored-nation price deal”");
    await box.getByLabel("Comment").fill("Is this for all Medicaid products or only some?");
    await box.getByRole("button", { name: "Comment" }).click();
    await expect(kd.locator("mark.ct-mark")).toHaveText("most-favored-nation price deal");
    await expect(cc.getByTestId("comments")).toContainText("Is this for all Medicaid products or only some?");
    await expectAccessible(client, "Client Inbox");
    await cc.getByRole("button", { name: "↩ Send to Eradigm" }).click();
    await expect(client.getByText("Nothing to check right now", { exact: false })).toBeVisible();
    await ctx.close();

    // Back in the Eradigm Inbox, with the comment: resolve it, then push to the Tracker.
    await page.getByRole("button", { name: /^Needs review/ }).click();
    await expect(card).toContainText("Back from");
    const comments = card.getByTestId("comments");
    await expect(comments).toContainText("Is this for all Medicaid products or only some?");
    await expect(comments).toContainText("“most-favored-nation price deal”");
    await comments.getByRole("button", { name: /most-favored-nation/ }).click();
    await expect(card.getByLabel("Key Details", { exact: true })).toBeFocused();
    await comments.getByRole("button", { name: "✓ Resolve" }).click();
    await expect(comments).toContainText("0 open");
    await expectAccessible(page, "Eradigm Inbox with client comments");
    await card.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(page.locator(".toast").last()).toContainText("published to the tracker");
  });

  test("Word-style bullets: Tab indents, Enter continues the list, Esc then Tab moves on", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto("/inbox");
    const e = await draftEntry(page, `Bullets ${Date.now().toString(36)}`);
    await page.reload();
    const card = page.locator(".inbox-card", { has: page.locator(".code", { hasText: e.code }) });
    const field = card.getByLabel("CI Perspective", { exact: true });
    await field.fill("");
    await field.focus();
    await page.keyboard.type("Deal terms");
    await page.keyboard.press("Tab");
    await expect(field).toHaveValue("- Deal terms");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Upfront");
    await page.keyboard.press("Tab");
    await expect(field).toHaveValue("- Deal terms\n  - Upfront");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("- Deal terms\n  - Upfront\n- ");
    await page.keyboard.press("Shift+Tab");
    await expect(field).toHaveValue("- Deal terms\n  - Upfront\n");
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(field).not.toBeFocused();
  });

  test("Tracker Edit: the fields first, then the page text, no saved-page window; Phantoms cannot be edited", async ({ page }) => {
    await signInAs(page, "analyst");
    await page.goto("/tracker");
    // Secondary is the default.
    await expect(page.getByTestId("stream-secondary")).toHaveAttribute("aria-pressed", "true");
    await page.locator("table.data tbody tr").first().getByRole("button", { name: /^Edit / }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Edit entry")).toBeVisible();
    const form = (await drawer.getByText("Edit entry").boundingBox())!;
    const text = (await drawer.getByTestId("edit-source-text").boundingBox())!;
    expect(text.y).toBeGreaterThan(form.y);
    await expect(drawer.locator("iframe")).toHaveCount(0);
    await expect(drawer.getByText("Bullets: Tab indents").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/phantoms");
    await expect(page.getByTestId("stream-secondary")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("table.data thead").getByText("Edit", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  });

  test("Megatrends: no filter bar, a minimisable Macrotrend list, and the timeline coloured by Impact", async ({ page }) => {
    await signInAs(page, "client");
    await page.goto("/megatrends");
    await expect(page.getByTestId("mg-panel")).toBeVisible();
    await expect(page.getByRole("group", { name: "Tracker" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Event Date period" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Megatrends", level: 1 })).toHaveCount(0);
    await page.getByRole("button", { name: "Minimise the Macrotrend list" }).click();
    await expect(page.getByTestId("mg-macros")).toBeHidden();
    await page.getByTestId("mg-rail-open").click();
    await expect(page.getByTestId("mg-macros")).toBeVisible();
    const tl = page.getByTestId("mg-timeline");
    await tl.getByRole("group", { name: "Colour the timeline by" }).getByRole("button", { name: "Impact" }).click();
    await expect(tl).toContainText("coloured by Impact");
    const legend = page.getByRole("list", { name: "Legend" });
    await expect(legend.getByRole("button")).toHaveText([/^Low/, /^Medium/, /^High/]);
    const all = await tl.getByTestId("mg-ball").count();
    await legend.getByRole("button", { name: /^High/ }).click();
    await expect.poll(() => tl.getByTestId("mg-ball").count()).toBeLessThan(all);
    await expectAccessible(page, "Megatrends coloured by Impact");
    // A taller timeline has bigger lollipops.
    const r0 = Number(await tl.getByTestId("mg-ball").first().getAttribute("r"));
    await page.getByRole("separator", { name: "Resize the timeline" }).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
    await expect.poll(async () => Number(await tl.getByTestId("mg-ball").first().getAttribute("r"))).toBeGreaterThan(r0);
  });
});
