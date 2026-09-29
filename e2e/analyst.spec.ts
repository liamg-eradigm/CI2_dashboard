import path from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { choose, chooseMany, expect, expectAccessible, signInAs, test } from "./fixtures";

test.describe("analyst role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "analyst"));

  test("completes an empty Inbox draft from the saved page: validation, manual entry and approve", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    const card = page.locator(".inbox-card", { hasText: "AstraZeneca and Roche form pre-competitive AI alliance" });
    // Manual entry: every tracker field starts empty and no AI output is shown.
    await expect(card.getByText("Awaiting analyst entry")).toBeVisible();
    await expect(card.getByText(/LLM draft/)).toHaveCount(0);
    await expect(card.getByRole("textbox", { name: "News title", exact: true })).toHaveValue("");
    await expect(card.getByRole("combobox", { name: "Macrotrend", exact: true })).toHaveValue("");
    // The analyst opens the saved page to read the source.
    await expect(card.getByRole("link", { name: /Open saved page in new tab/ })).toHaveAttribute("href", /^\/source\/itm_/);
    await card.getByRole("button", { name: "View saved page" }).click();
    await expect(card.frameLocator("iframe.snapshot-frame").getByText("pool de-identified screening data")).toBeVisible();

    await card.getByRole("button", { name: "✓ Approve" }).click();
    await expect(card.getByText(/Validation failed\. Complete: Date, Competitor, Macrotrend, Subtrend, News title/)).toBeVisible();
    await card.getByLabel("Date", { exact: true }).fill("2026-09-24");
    await chooseMany(card.getByRole("combobox", { name: "Competitor", exact: true }), ["AstraZeneca", "Roche"]);
    await choose(card.getByRole("combobox", { name: "Macrotrend", exact: true }), "AI Investment in R&D");
    await choose(card.getByRole("combobox", { name: "Subtrend", exact: true }), "External Partnerships to Accelerate AI");
    await card.getByRole("textbox", { name: "News title", exact: true }).fill("AstraZeneca and Roche form pre-competitive AI alliance");
    await choose(card.getByRole("combobox", { name: "Growth intensity", exact: true }), "Strong Increase");
    await choose(card.getByRole("combobox", { name: "Impact", exact: true }), "High");
    await choose(card.getByRole("combobox", { name: "Source", exact: true }), "PR");
    await choose(card.getByRole("combobox", { name: "Action", exact: true }), "Not Actioned");
    await card.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker as rev 1/).first()).toBeVisible();
    await page.getByRole("button", { name: /Approved & rejected/ }).click();
    await expect(page.locator(".inbox-card", { hasText: "AstraZeneca and Roche form pre-competitive AI alliance" }).getByText(/Approved · SIG-/)).toBeVisible();
  });

  test("Inbox dropdowns are searchable, including the Competitor multi-select", async ({ page }) => {
    await page.goto("/inbox");
    const card = page.locator(".inbox-card", { hasText: "Novartis opens AI academy" });
    // Competitor is a dropdown (not free text) that searches and allows several values.
    const comp = card.getByRole("combobox", { name: "Competitor", exact: true });
    await expect(card.getByRole("textbox", { name: "Competitor", exact: true })).toHaveCount(0);
    await comp.click();
    await comp.fill("vart");
    const list = page.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveText(["Novartis"]);
    await expectAccessible(page, "/inbox with a dropdown open");
    await page.keyboard.press("Enter");
    await comp.fill("ro");
    await expect(list.getByRole("option", { name: "Roche", exact: true })).toBeVisible();
    await expect(list.getByRole("option", { name: "Pfizer", exact: true })).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await comp.fill("zzz");
    await expect(page.getByText("No matches for “zzz”")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(comp).toHaveValue(/Novartis, /);
    // Backspace removes the last selected competitor.
    await comp.click();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");
    await expect(comp).toHaveValue("Novartis");
    // Single-value dropdowns search too; Subtrend lists only the chosen macrotrend's subtrends.
    const macro = card.getByRole("combobox", { name: "Macrotrend", exact: true });
    await macro.click();
    await macro.fill("workforce");
    await page.keyboard.press("Enter");
    await expect(macro).toHaveValue("Workforce AI Upskilling");
    const sub = card.getByRole("combobox", { name: "Subtrend", exact: true });
    await sub.click();
    const subs = await page.getByRole("listbox").getByRole("option").allInnerTexts();
    expect(subs.length).toBeGreaterThan(0);
    expect(subs).not.toContain("Mergers & Acquisitions");
    await sub.fill("tiered");
    await page.keyboard.press("Enter");
    await expect(sub).toHaveValue(/Tiered AI accreditation/);
    // Values persist as a saved draft.
    await card.getByRole("textbox", { name: "News title", exact: true }).click();
    await page.reload();
    const again = page.locator(".inbox-card", { hasText: "Novartis opens AI academy" });
    await expect(again.getByRole("combobox", { name: "Competitor", exact: true })).toHaveValue("Novartis");
    await expect(again.getByRole("combobox", { name: "Subtrend", exact: true })).toHaveValue(/Tiered AI accreditation/);
  });

  test("blocks unsafe URLs before anything is fetched", async ({ page }) => {
    await page.goto("/input");
    await page.getByRole("button", { name: "Metadata" }).click();
    await page.getByRole("button", { name: "Capture source" }).click();
    await expect(page.getByText("Stopped at step 2")).toBeVisible();
    await expect(page.locator(".step.failed", { hasText: "Destination check" })).toContainText("link-local / cloud metadata service");
    await page.getByRole("button", { name: "FTP" }).click();
    await page.getByRole("button", { name: "Capture source" }).click();
    await expect(page.getByText("Stopped at step 1")).toBeVisible();
    await expect(page.getByRole("table", { name: "Capture log" })).toContainText("ftp://files.example.com/a.html");
  });

  test("processes a SingleFile upload end-to-end into Needs review", async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
    const file = path.join(dir, "roche-lab.html");
    writeFileSync(
      file,
      `<!DOCTYPE html><html><!--\n Page saved with SingleFile \n url: https://newsroom.example.com/e2e-roche-lab-${Date.now().toString(36)} \n saved date: Wed Sep 24 2026\n--><head><title>Roche opens robotics-enabled lab</title><meta property="article:published_time" content="2026-09-24"><script>alert(1)</script></head><body><article><h1>Roche opens robotics-enabled autonomous lab in Basel ${Date.now().toString(36)}</h1><p>Roche has opened an autonomous laboratory where robotics-enabled labs run design-make-test cycles for small molecules around the clock.</p><p>The company said the lab will double experimental throughput for its early discovery teams by 2027.</p></article></body></html>`,
    );
    await page.goto("/input");
    await page.getByRole("button", { name: "HTML file" }).click();
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Process file" }).click();
    await expect(page.getByText("Complete · sent to Needs review")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".step", { hasText: "Content scan before storage" })).toContainText("script(s) stripped");
    await expect(page.locator(".step", { hasText: "Data policy check" })).toContainText("nothing sent to any external service");
    await expect(page.locator(".step", { hasText: "Routed to Needs review" })).toContainText("every tracker field empty");
    await expect(page.getByRole("heading", { name: "Model output" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sent to the Inbox" })).toBeVisible();
    await expectAccessible(page, "/input with results");
    await page.getByRole("button", { name: "Complete in Inbox →" }).click();
    const card = page.locator(".inbox-card", { hasText: "Roche opens robotics-enabled" }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText("Awaiting analyst entry")).toBeVisible();
  });

  test("accepts an HTML file by drag and drop", async ({ page }) => {
    await page.goto("/input");
    // Dropped while the URL option is selected: switches to HTML file mode by itself.
    const html = `<!DOCTYPE html><html><head><title>Dropped file</title></head><body><article><h1>Sanofi pilots dropped-file AI triage ${Date.now().toString(36)}</h1><p>Sanofi has piloted an AI triage tool across three trial sites, the company said on Monday.</p><p>The pilot runs until the end of 2026.</p></article></body></html>`;
    const dt = await page.evaluateHandle((h) => {
      const d = new DataTransfer();
      d.items.add(new File([h], "dropped.html", { type: "text/html" }));
      return d;
    }, html);
    const card = page.locator("section.card", { has: page.getByRole("heading", { name: "New source" }) });
    await card.dispatchEvent("dragenter", { dataTransfer: dt });
    await card.dispatchEvent("dragover", { dataTransfer: dt });
    await card.dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByRole("button", { name: "HTML file" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("drop-zone")).toContainText("dropped.html");
    await page.getByRole("button", { name: "Process file" }).click();
    await expect(page.getByText("Complete · sent to Needs review")).toBeVisible({ timeout: 30_000 });
  });

  test("warns about a source already in the tracker, but lets it through and requires an explicit override to approve", async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
    const file = path.join(dir, "again.html");
    // Same URL as the published seed entry SIG-1100.
    writeFileSync(
      file,
      `<!DOCTYPE html><html><!--\n Page saved with SingleFile \n url: https://source.example.com/sig-1100 \n saved date: Wed Sep 24 2026\n--><head><title>Roche DTP again</title></head><body><article><h1>Roche brings DTP offering to a national retail pharmacy chain (re-saved)</h1><p>Roche has extended its direct-to-patient offering to a national retail pharmacy chain, the company said.</p><p>The roll-out covers all stores by 2027.</p></article></body></html>`,
    );
    await page.goto("/input");
    await page.getByRole("button", { name: "HTML file" }).click();
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Process file" }).click();
    await expect(page.getByText(/Possible duplicate: this source is already in the tracker as SIG-1100/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/sent to Needs review/).first()).toBeVisible();

    await page.goto("/inbox");
    const first = page.locator(".inbox-card", { hasText: "re-saved" }).first();
    await expect(first.getByText("⚠ Duplicate of SIG-1100")).toBeVisible();
    // Track the card by its Inbox code: its title changes once the analyst types one.
    const code = (await first.locator(".code").innerText()).trim();
    const card = page.locator(".inbox-card", { has: page.locator(".code", { hasText: code }) });
    await card.getByLabel("Date", { exact: true }).fill("2026-09-24");
    await chooseMany(card.getByRole("combobox", { name: "Competitor", exact: true }), ["Roche"]);
    await choose(card.getByRole("combobox", { name: "Macrotrend", exact: true }), "AI Investment in R&D");
    await choose(card.getByRole("combobox", { name: "Subtrend", exact: true }), "External Partnerships to Accelerate AI");
    await card.getByRole("textbox", { name: "News title", exact: true }).fill("Roche DTP retail roll-out (second entry)");
    await choose(card.getByRole("combobox", { name: "Growth intensity", exact: true }), "Slight Increase");
    await choose(card.getByRole("combobox", { name: "Impact", exact: true }), "Medium");
    await choose(card.getByRole("combobox", { name: "Source", exact: true }), "PR");
    await choose(card.getByRole("combobox", { name: "Action", exact: true }), "Not Actioned");
    await card.getByRole("button", { name: "✓ Approve" }).click();
    const dialog = card.getByRole("alertdialog");
    await expect(dialog).toContainText("Duplicate — SIG-1100 is already in the tracker");
    await expect(dialog.getByRole("link", { name: /Open SIG-1100 in the Tracker/ })).toHaveAttribute("href", /\/tracker\?signal=/);
    await expectAccessible(page, "/inbox duplicate confirmation");
    await dialog.getByRole("button", { name: "Cancel — don't approve" }).click();
    await expect(card.getByRole("alertdialog")).toHaveCount(0);
    await card.getByRole("button", { name: "✓ Approve" }).click();
    await card.getByRole("button", { name: "Approve anyway (override duplicate)" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker as rev 1 \(duplicate confirmed\)/).first()).toBeVisible();
  });

  test("reorders tracker columns: A–Z, Z–A, move buttons and drag and drop", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Edit columns" }).click();
    const labels = () => page.locator(".schema-row .schema-grid input[aria-label^='Rename column']").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    await page.getByRole("button", { name: "Sort A → Z" }).click();
    await expect(page.locator(".toast")).toContainText("Columns sorted A → Z");
    await expect.poll(labels).toEqual([...(await labels())].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })));
    await page.getByRole("button", { name: "Sort Z → A" }).click();
    await expect(page.locator(".toast").last()).toContainText("Columns sorted Z → A");
    const za = await labels();
    expect(za).toEqual([...za].sort((a, b) => b.localeCompare(a, undefined, { sensitivity: "base", numeric: true })));
    // Keyboard-accessible move.
    await page.getByRole("button", { name: `Move ${za[1]} up` }).click();
    await expect.poll(async () => (await labels())[0]).toBe(za[1]);
    // Drag the last column onto the first row.
    const before = await labels();
    const last = before[before.length - 1] as string;
    const handle = page.locator(".schema-row", { has: page.getByLabel(`Rename column ${last}`, { exact: true }) }).locator(".drag-handle");
    await handle.dragTo(page.locator(".schema-row").first());
    await expect.poll(async () => (await labels())[0]).toBe(last);
    // The Tracker uses the new order.
    await page.goto("/tracker");
    await expect(page.locator("table thead th").first()).toContainText(last, { timeout: 15_000 });
    // Restore the default order for the other tests.
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Edit columns" }).click();
    for (const l of ["Action", "Source", "Impact", "Growth intensity", "News title", "Subtrend", "Macrotrend", "Competitor", "Date"]) {
      const row = page.locator(".schema-row", { has: page.getByLabel(`Rename column ${l}`, { exact: true }) });
      if (!(await row.count())) continue;
      await row.locator(".drag-handle").dragTo(page.locator(".schema-row").first());
      await expect.poll(async () => (await labels())[0]).toBe(l);
    }
  });

  test("reorders dropdown options: A–Z, Z–A, move buttons and drag and drop", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Edit columns" }).click();
    const row = page.locator(".schema-row", { has: page.getByLabel("Rename column Source", { exact: true }) });
    await row.getByRole("button", { name: /options/ }).click();
    const panel = page.locator(".opt-panel");
    const opts = () => panel.locator("input[aria-label^='Rename option']").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const original = await opts();
    await panel.getByRole("button", { name: "Sort Source options Z to A" }).click();
    await expect(page.locator(".toast").last()).toContainText("Source options sorted Z → A");
    await expect.poll(opts).toEqual([...original].sort((a, b) => b.localeCompare(a, undefined, { sensitivity: "base", numeric: true })));
    await panel.getByRole("button", { name: "Sort Source options A to Z" }).click();
    const az = [...original].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    await expect.poll(opts).toEqual(az);
    await panel.getByRole("button", { name: `Move option ${az[1]} up` }).click();
    await expect.poll(async () => (await opts())[0]).toBe(az[1]);
    const cur = await opts();
    const last = cur[cur.length - 1] as string;
    await panel.locator(".opt-drag", { has: page.getByLabel(`Rename option ${last}`, { exact: true }) }).locator(".drag-handle").dragTo(panel.locator(".opt-drag").first());
    await expect.poll(async () => (await opts())[0]).toBe(last);
    // The Inbox dropdown uses the new order.
    await page.getByRole("button", { name: "Done" }).click();
    const card = page.locator(".inbox-card").first();
    await card.getByRole("combobox", { name: "Source", exact: true }).click();
    await expect(page.getByRole("listbox").getByRole("option").first()).toHaveText(last);
    await page.keyboard.press("Escape");
    // Growth intensity / Impact explain that their order is also the level.
    await page.getByRole("button", { name: "Edit columns" }).click();
    await page.locator(".schema-row", { has: page.getByLabel("Rename column Impact", { exact: true }) }).getByRole("button", { name: /options/ }).click();
    await expect(page.locator(".order-note")).toContainText("the order is also the level");
    // Restore the original Source order for the other tests.
    await page.locator(".schema-row", { has: page.getByLabel("Rename column Source", { exact: true }) }).getByRole("button", { name: /options/ }).click();
    for (const v of [...original].reverse()) {
      await panel.locator(".opt-drag", { has: page.getByLabel(`Rename option ${v}`, { exact: true }) }).locator(".drag-handle").dragTo(panel.locator(".opt-drag").first());
      await expect.poll(async () => (await opts())[0]).toBe(v);
    }
    await expect.poll(opts).toEqual(original);
  });

  test("deletes a tracker entry after an explicit confirmation", async ({ page }) => {
    await page.goto("/tracker");
    const firstRow = page.locator("table tbody tr").first();
    const title = (await firstRow.locator("td.title").innerText()).trim();
    await firstRow.locator("td.title button").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = drawer.getByRole("alertdialog");
    await expect(confirm).toContainText("will disappear from the Tracker, the Dashboard and exports for everyone");
    await confirm.getByLabel(/Reason/).fill("E2E test deletion");
    const code = (await confirm.locator("b").innerText()).match(/SIG-\d+/)?.[0] as string;
    await confirm.getByRole("button", { name: `Delete ${code}` }).click();
    await expect(page.locator(".toast")).toContainText(`${code} deleted from the tracker`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("table tbody td.title", { hasText: title })).toHaveCount(0);
  });

  test("opens the saved page full-window in a new tab", async ({ page, context }) => {
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto("/inbox");
    const card = page.locator(".inbox-card", { hasText: "Novartis opens AI academy" });
    const [tab] = await Promise.all([context.waitForEvent("page"), card.getByRole("link", { name: /Open saved page in new tab/ }).click()]);
    await tab.waitForLoadState();
    await expect(tab.getByRole("heading", { name: "Novartis opens AI academy with three-tier certification" })).toBeVisible();
    await expect(tab.frameLocator("iframe.snapshot-frame").getByText("foundation tier by the end of 2027")).toBeVisible();
    await expect(tab.getByRole("navigation")).toHaveCount(0);
    await expectAccessible(tab, "/source/:id");
    await tab.close();
  });

  test("edits dropdown options from the Inbox column editor", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Edit columns" }).click();
    const row = page.locator(".schema-grid", { has: page.getByLabel("Rename column Source") });
    await row.getByRole("button", { name: /options/ }).click();
    await page.getByLabel("New option").fill("Analyst Call");
    await page.getByRole("button", { name: "+ Add option" }).click();
    await expect(page.locator(".toast")).toContainText("Added “Analyst Call” to Source");
    await expect(page.getByRole("button", { name: "Chart field · locked" })).toHaveCount(0);
    await expect(page.getByText("Chart field · locked").first()).toBeVisible();
  });

  test("Inbox and Input pass automated accessibility checks", async ({ page }) => {
    for (const p of ["/inbox", "/input"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, p);
    }
  });
});
