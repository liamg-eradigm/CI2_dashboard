import path from "node:path";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Locator, Page } from "@playwright/test";
import { choose, chooseMany, expect, expectAccessible, signInAs, test } from "./fixtures";

const uid = () => Date.now().toString(36);

/** Fill every required tracker field of an Inbox card (plus any extras by label). */
async function fillEntry(card: Locator, v: { id: string; title: string; impact?: string; competitors?: string[]; extra?: Record<string, string> }) {
  await card.getByRole("textbox", { name: "ID", exact: true }).fill(v.id);
  await choose(card.getByRole("combobox", { name: "Macrotrend", exact: true }), "AI Investment in R&D");
  await choose(card.getByRole("combobox", { name: "Subtrend", exact: true }), "External Partnerships to Accelerate AI");
  await card.getByRole("textbox", { name: "Title", exact: true }).fill(v.title);
  await card.getByLabel("Event Date", { exact: true }).fill("2026-09-24");
  await choose(card.getByRole("combobox", { name: "Impact", exact: true }), v.impact ?? "High");
  await choose(card.getByRole("combobox", { name: "Growth Intensity", exact: true }), "Strong Increase");
  await choose(card.getByRole("combobox", { name: "Source Type", exact: true }), "PR");
  await chooseMany(card.getByRole("combobox", { name: "Competitors", exact: true }), v.competitors ?? ["AstraZeneca", "Roche"]);
  await choose(card.getByRole("combobox", { name: "Action", exact: true }), "Not Actioned");
  for (const [label, value] of Object.entries(v.extra ?? {})) await card.getByLabel(label, { exact: true }).fill(value);
}

/** Put the columns (or a column's options) back in the default order via the API. */
async function restoreOrder(page: Page, stream: "primary" | "secondary", keys: string[], optionsOf?: string) {
  await page.evaluate(
    async ({ stream, keys, optionsOf }) => {
      const url = optionsOf ? `/api/schema/columns/${optionsOf}/options/order?stream=${stream}` : `/api/schema/columns/order?stream=${stream}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-eci-request": "1", "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" },
        body: JSON.stringify(optionsOf ? { values: keys } : { keys }),
      });
      if (!res.ok) throw new Error(`restore failed ${res.status}`);
    },
    { stream, keys, optionsOf },
  );
}

async function schemaOf(page: Page, stream: "primary" | "secondary") {
  return page.evaluate(async (stream) => {
    const res = await fetch(`/api/schema?stream=${stream}`, { headers: { "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" } });
    return (await res.json()) as { columns: { key: string; label: string; position: number; inTracker: boolean; options?: string[] }[] };
  }, stream);
}

function htmlFile(name: string, html: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
  const file = path.join(dir, name);
  writeFileSync(file, html);
  return file;
}

test.describe("analyst role", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "analyst"));

  test("completes an empty Inbox draft from the saved page: validation, manual entry and approve", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
    const card = page.locator(".inbox-card", { hasText: "AstraZeneca and Roche form pre-competitive AI alliance" });
    // Manual entry: every tracker field starts empty and no AI output is shown.
    await expect(card.getByText("Awaiting analyst entry")).toBeVisible();
    await expect(card.getByText(/LLM draft/)).toHaveCount(0);
    await expect(card.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
    // The Primary layout: source details instead of Secondary's publisher fields.
    await expect(card.getByRole("textbox", { name: "Source Role", exact: true })).toHaveValue("");
    await expect(card.getByRole("textbox", { name: "Source Tier", exact: true })).toHaveCount(0);
    await expect(card.getByRole("combobox", { name: "Macrotrend", exact: true })).toHaveValue("");
    // The analyst opens the saved page to read the source.
    await expect(card.getByRole("link", { name: /Open saved page in new tab/ })).toHaveAttribute("href", /^\/source\/itm_/);
    await card.getByRole("button", { name: "View saved page" }).click();
    await expect(card.frameLocator("iframe.snapshot-frame").getByText("pool de-identified screening data")).toBeVisible();

    await card.getByRole("button", { name: "✓ Approve" }).click();
    await expect(card.getByText(/Validation failed\. Complete: ID, Title, Event Date, Macrotrend, Subtrend, Growth Intensity, Impact, Source Type, Competitors, Action/)).toBeVisible();
    await fillEntry(card, { id: `P-E2E-${uid()}`, title: "AstraZeneca and Roche form pre-competitive AI alliance", extra: { "Key Details": "Shared models.\n\nEach partner keeps its own assets." } });
    await card.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker as rev 1/).first()).toBeVisible();
    await page.getByRole("button", { name: /Approved & rejected/ }).click();
    await expect(page.locator(".inbox-card", { hasText: "AstraZeneca and Roche form pre-competitive AI alliance" }).getByText(/Approved · SIG-/)).toBeVisible();
  });

  test("Inbox dropdowns are searchable, including the Competitor multi-select", async ({ page }) => {
    await page.goto("/inbox");
    const card = page.locator(".inbox-card", { hasText: "Novartis opens AI academy" });
    // Competitor is a dropdown (not free text) that searches and allows several values.
    const comp = card.getByRole("combobox", { name: "Competitors", exact: true });
    await expect(card.getByRole("textbox", { name: "Competitors", exact: true })).toHaveCount(0);
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
    await card.getByRole("textbox", { name: "Title", exact: true }).click();
    await page.reload();
    const again = page.locator(".inbox-card", { hasText: "Novartis opens AI academy" });
    await expect(again.getByRole("combobox", { name: "Competitors", exact: true })).toHaveValue("Novartis");
    await expect(again.getByRole("combobox", { name: "Subtrend", exact: true })).toHaveValue(/Tiered AI accreditation/);
  });

  test("Input has two identical, aligned HTML sources and no URL option; each goes to its own inbox", async ({ page }) => {
    await page.goto("/input");
    const primary = page.getByTestId("source-primary");
    const secondary = page.getByTestId("source-secondary");
    await expect(primary.getByRole("heading", { name: "Primary Source" })).toBeVisible();
    await expect(secondary.getByRole("heading", { name: "Secondary Source" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /url/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Capture source|^URL$/ })).toHaveCount(0);
    const [pb, sb] = [(await primary.boundingBox())!, (await secondary.boundingBox())!];
    expect(Math.abs(pb.x - sb.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(pb.width - sb.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(pb.height - sb.height)).toBeLessThanOrEqual(1);
    expect(sb.y).toBeGreaterThan(pb.y + pb.height - 1);
    const [pz, sz] = [(await page.getByTestId("drop-zone-primary").boundingBox())!, (await page.getByTestId("drop-zone-secondary").boundingBox())!];
    expect(Math.abs(pz.x - sz.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(pz.width - sz.width)).toBeLessThanOrEqual(1);

    const title = `Pfizer secondary routing ${uid()}`;
    const file = htmlFile("secondary.html", `<!DOCTYPE html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Pfizer has piloted an AI assistant for field teams in two regions, the company said.</p><p>The pilot runs until 2027.</p></article></body></html>`);
    await secondary.locator('input[type="file"]').setInputFiles(file);
    await secondary.getByRole("button", { name: "Process file for Secondary Source" }).click();
    await expect(page.getByText("Complete · sent to the Secondary Inbox")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("table", { name: "Capture log" }).locator("tr", { hasText: "secondary.html" }).first()).toContainText("Secondary");
    await page.getByRole("button", { name: "Complete in Secondary Inbox →" }).click();
    await expect(page).toHaveURL(/\/inbox\?stream=secondary/);
    const card = page.locator(".inbox-card", { hasText: title });
    await expect(card.getByRole("textbox", { name: "Source Tier", exact: true })).toHaveValue("Reviewed-Secondary");
    await page.getByTestId("stream-primary").click();
    await expect(page.locator(".inbox-card", { hasText: title })).toHaveCount(0);
  });

  test("processes a SingleFile upload end-to-end into Needs review", async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
    const file = path.join(dir, "roche-lab.html");
    writeFileSync(
      file,
      `<!DOCTYPE html><html><!--\n Page saved with SingleFile \n url: https://newsroom.example.com/e2e-roche-lab-${Date.now().toString(36)} \n saved date: Wed Sep 24 2026\n--><head><title>Roche opens robotics-enabled lab</title><meta property="article:published_time" content="2026-09-24"><script>alert(1)</script></head><body><article><h1>Roche opens robotics-enabled autonomous lab in Basel ${Date.now().toString(36)}</h1><p>Roche has opened an autonomous laboratory where robotics-enabled labs run design-make-test cycles for small molecules around the clock.</p><p>The company said the lab will double experimental throughput for its early discovery teams by 2027.</p></article></body></html>`,
    );
    await page.goto("/input");
    await page.getByTestId("source-primary").locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Process file for Primary Source" }).click();
    await expect(page.getByText("Complete · sent to the Primary Inbox")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".step", { hasText: "Content scan before storage" })).toContainText("script(s) stripped");
    await expect(page.locator(".step", { hasText: "Data policy check" })).toContainText("nothing sent to any external service");
    await expect(page.locator(".step", { hasText: "Routed to Needs review" })).toContainText("every tracker field empty");
    await expect(page.getByRole("heading", { name: "Model output" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sent to the Primary Inbox" })).toBeVisible();
    await expectAccessible(page, "/input with results");
    await page.getByRole("button", { name: "Complete in Primary Inbox →" }).click();
    const card = page.locator(".inbox-card", { hasText: "Roche opens robotics-enabled" }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText("Awaiting analyst entry")).toBeVisible();
  });

  test("accepts an HTML file by drag and drop", async ({ page }) => {
    await page.goto("/input");
    const html = `<!DOCTYPE html><html><head><title>Dropped file</title></head><body><article><h1>Sanofi pilots dropped-file AI triage ${Date.now().toString(36)}</h1><p>Sanofi has piloted an AI triage tool across three trial sites, the company said on Monday.</p><p>The pilot runs until the end of 2026.</p></article></body></html>`;
    const dt = await page.evaluateHandle((h) => {
      const d = new DataTransfer();
      d.items.add(new File([h], "dropped.html", { type: "text/html" }));
      return d;
    }, html);
    const card = page.getByTestId("source-secondary");
    await card.dispatchEvent("dragenter", { dataTransfer: dt });
    await card.dispatchEvent("dragover", { dataTransfer: dt });
    await card.dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByTestId("drop-zone-secondary")).toContainText("dropped.html");
    await expect(page.getByTestId("drop-zone-primary")).not.toContainText("dropped.html");
    await card.getByRole("button", { name: "Process file for Secondary Source" }).click();
    await expect(page.getByText("Complete · sent to the Secondary Inbox")).toBeVisible({ timeout: 30_000 });
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
    await page.getByTestId("source-primary").locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Process file for Primary Source" }).click();
    await expect(page.getByText(/Possible duplicate: this source is already in the tracker as SIG-1100/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/sent to the Primary Inbox/).first()).toBeVisible();

    await page.goto("/inbox");
    const first = page.locator(".inbox-card", { hasText: "re-saved" }).first();
    await expect(first.getByText("⚠ Duplicate of SIG-1100")).toBeVisible();
    // Track the card by its Inbox code: its title changes once the analyst types one.
    const code = (await first.locator(".code").innerText()).trim();
    const card = page.locator(".inbox-card", { has: page.locator(".code", { hasText: code }) });
    await fillEntry(card, { id: `P-DUP-${uid()}`, title: "Roche DTP retail roll-out (second entry)", impact: "Medium", competitors: ["Roche"] });
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
    const original = [...(await schemaOf(page, "primary")).columns].sort((a, b) => a.position - b.position).map((c) => c.key);
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
    // Drag the third column onto the first row.
    const before = await labels();
    const third = before[2] as string;
    const handle = page.locator(".schema-row", { has: page.getByLabel(`Rename column ${third}`, { exact: true }) }).locator(".drag-handle");
    await handle.dragTo(page.locator(".schema-row").first());
    await expect.poll(async () => (await labels())[0]).toBe(third);
    // The Tracker uses the new order (the Inbox-only columns stay out of the Tracker).
    await page.goto("/tracker");
    const trackerFirst = (await schemaOf(page, "primary")).columns.filter((c) => c.inTracker).sort((a, b) => a.position - b.position)[0]?.label as string;
    await expect(page.locator("table thead th:not(.src-col):not(.pick-col)").first()).toContainText(trackerFirst, { timeout: 15_000 });
    await expect(page.locator("table thead th:not(.src-col):not(.pick-col)")).toHaveCount(9);
    await restoreOrder(page, "primary", original);
  });

  test("reorders dropdown options: A–Z, Z–A, move buttons and drag and drop", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Edit columns" }).click();
    const row = page.locator(".schema-row", { has: page.getByLabel("Rename column Source Type", { exact: true }) });
    await row.getByRole("button", { name: /options/ }).click();
    const panel = page.locator(".opt-panel");
    const opts = () => panel.locator("input[aria-label^='Rename option']").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const original = await opts();
    await panel.getByRole("button", { name: "Sort Source Type options Z to A" }).click();
    await expect(page.locator(".toast").last()).toContainText("Source Type options sorted Z → A");
    await expect.poll(opts).toEqual([...original].sort((a, b) => b.localeCompare(a, undefined, { sensitivity: "base", numeric: true })));
    await panel.getByRole("button", { name: "Sort Source Type options A to Z" }).click();
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
    await card.getByRole("combobox", { name: "Source Type", exact: true }).click();
    await expect(page.getByRole("listbox").getByRole("option").first()).toHaveText(last);
    await page.keyboard.press("Escape");
    // Growth intensity / Impact explain that their order is also the level.
    await page.getByRole("button", { name: "Edit columns" }).click();
    await page.locator(".schema-row", { has: page.getByLabel("Rename column Impact", { exact: true }) }).getByRole("button", { name: /options/ }).click();
    await expect(page.locator(".order-note")).toContainText("the order is also the level");
    // Restore the original Source Type order for the other tests.
    await restoreOrder(page, "primary", original, "source");
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

  test("selects Phantoms entries with tick boxes and deletes them", async ({ page }) => {
    await page.goto("/phantoms");
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
    const titles = [(await rows.nth(0).locator("td.title").innerText()).trim(), (await rows.nth(1).locator("td.title").innerText()).trim()];
    await rows.nth(0).getByRole("checkbox").check();
    await rows.nth(1).getByRole("checkbox").check();
    const bar = page.getByRole("group", { name: "Selected entries" });
    await expect(bar).toContainText("2 selected");
    // The header box selects the whole page, and again clears it.
    const all = page.getByRole("checkbox", { name: "Select every entry on this page" });
    await all.check();
    await expect(bar).toContainText(`${await rows.count()} selected`);
    await all.uncheck();
    await expect(bar).toHaveCount(0);
    await rows.nth(0).getByRole("checkbox").check();
    await rows.nth(1).getByRole("checkbox").check();
    await bar.getByRole("button", { name: "Delete selected" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete 2 entries?" });
    await expect(confirm).toContainText("will disappear from the Tracker, Phantoms, the Dashboard and exports");
    await expect(confirm).toContainText(titles[0]!);
    await expectAccessible(page, "/phantoms delete confirmation");
    await confirm.getByLabel(/Reason/).fill("E2E bulk deletion");
    await confirm.getByRole("button", { name: "Delete 2 entries" }).click();
    await expect(page.locator(".toast")).toContainText("Deleted 2 entries from the tracker");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    for (const t of titles) await expect(page.locator("table tbody td.title", { hasText: t })).toHaveCount(0);
    // Gone from the Tracker too.
    await page.getByRole("navigation").getByRole("link", { name: "Tracker" }).click();
    await page.getByRole("searchbox").fill(titles[0]!);
    await expect(page.locator("table tbody td.title", { hasText: titles[0]! })).toHaveCount(0);
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
    const row = page.locator(".schema-grid", { has: page.getByLabel("Rename column Source Type") });
    await row.getByRole("button", { name: /options/ }).click();
    await page.getByLabel("New option").fill("Analyst Call");
    await page.getByRole("button", { name: "+ Add option" }).click();
    await expect(page.locator(".toast")).toContainText("Added “Analyst Call” to Source Type");
    await expect(page.getByText("Markdown field · locked").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Chart field · locked" })).toHaveCount(0);
    await expect(page.getByText("Chart field · locked").first()).toBeVisible();
  });

  test("switches between the Primary and Secondary Inbox, with red unprocessed counts on the outer corners", async ({ page }) => {
    await page.goto("/inbox");
    const pBtn = page.getByTestId("stream-primary");
    const sBtn = page.getByTestId("stream-secondary");
    await expect(pBtn).toHaveText(/Primary Inbox/);
    await expect(sBtn).toHaveText(/Secondary Inbox/);
    const counts = await page.evaluate(async () => (await fetch("/api/items/counts", { headers: { "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" } })).json());
    for (const [btn, key, side] of [[pBtn, "primary", "left"], [sBtn, "secondary", "right"]] as const) {
      const badge = page.getByTestId(`count-${key}`);
      if (!counts[key]) {
        await expect(badge).toHaveCount(0);
        continue;
      }
      await expect(badge).toHaveText(String(counts[key]));
      const b = (await badge.boundingBox())!;
      const o = (await btn.boundingBox())!;
      expect(b.y).toBeLessThan(o.y); // sits on the top edge
      if (side === "left") expect(b.x).toBeLessThan(o.x + 4);
      else expect(b.x + b.width).toBeGreaterThan(o.x + o.width - 4);
    }
    // Secondary shows only Secondary uploads, with its own column editor.
    await sBtn.click();
    await expect(page).toHaveURL(/stream=secondary/);
    await expect(page.locator(".inbox-card", { hasText: "Partnering with employers to widen access" })).toBeVisible();
    await expect(page.locator(".inbox-card", { hasText: "AstraZeneca and Roche form pre-competitive" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Tracker columns · Secondary Inbox" })).toBeVisible();
    await expectAccessible(page, "/inbox secondary");
  });

  test("Phantoms: approved entries appear with a Markdown panel and a Download Markdown button on the left of each row", async ({ page }) => {
    const title = `Sanofi opens AI hub ${uid()}`;
    const file = htmlFile("phantom.html", `<!DOCTYPE html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Sanofi has opened an AI hub in Paris with 300 staff, the company said on Monday.</p><p>The hub opens in 2027.</p></article></body></html>`);
    await page.goto("/input");
    await page.getByTestId("source-secondary").locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Process file for Secondary Source" }).click();
    await expect(page.getByText("Complete · sent to the Secondary Inbox")).toBeVisible({ timeout: 30_000 });
    await page.goto("/inbox?stream=secondary");
    const first = page.locator(".inbox-card", { hasText: title });
    const code = (await first.locator(".code").innerText()).trim();
    const card = page.locator(".inbox-card", { has: page.locator(".code", { hasText: code }) });
    const rid = `S-PH-${uid()}`;
    await fillEntry(card, {
      id: rid,
      title: `${title}: Paris`,
      impact: "High",
      competitors: ["Sanofi"],
      extra: { Publisher: "Sanofi", URL: "https://www.sanofi.com/ai-hub", Header: "Sanofi opens a Paris AI hub.", "Key Details": "300 staff.\n\nOpens 2027.", "CI Perspective": "Raises the stakes for peers." },
    });
    await card.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker/).first()).toBeVisible();

    // In the Secondary Tracker (not the Primary one), and in Secondary Phantoms (Impact High ≥ Medium).
    await page.goto("/tracker?stream=secondary");
    await expect(page.locator("td.title", { hasText: `${title}: Paris` })).toBeVisible();
    await page.getByTestId("stream-primary").click();
    await expect(page.locator("td.title", { hasText: `${title}: Paris` })).toHaveCount(0);
    await page.getByRole("navigation").getByRole("link", { name: "Phantoms" }).click();
    await page.getByTestId("stream-secondary").click();
    const row = page.locator("table tbody tr", { hasText: `${title}: Paris` });
    await expect(row).toBeVisible();
    // The Download Markdown button is in the Markdown column, after the selection tick box.
    await expect(row.locator("td.md-col").getByRole("button", { name: /Download Markdown/ })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: /Download Markdown/ }).click()]);
    expect(download.suggestedFilename()).toBe(`${rid}.md`);
    const text = readFileSync((await download.path())!, "utf8");
    expect(text.startsWith(`---\nid: ${rid}\ntitle: "${title}: Paris"\nevent_date: 2026-09-24\nsource_type: PR\nSource:\n  Publisher: Sanofi\n  URL: https://www.sanofi.com/ai-hub\n`)).toBe(true);
    expect(text).toContain("Source_tier: Reviewed-Secondary\nCompetitors: Sanofi\n");
    expect(text).toContain("QC:\n  Reviewed_by: L. Griffith\n");
    expect(text).toContain("## Key Details\n300 staff.\n\nOpens 2027.\n");
    // The side panel shows the same Markdown, raw and rendered.
    await row.locator("td.title button").click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByLabel("Markdown source")).toContainText(`id: ${rid}`);
    await expectAccessible(page, "/phantoms Markdown panel");
    await panel.getByRole("button", { name: "Preview" }).click();
    await expect(panel.getByRole("heading", { name: "CI Perspective" })).toBeVisible();
    await expect(panel.getByText("Raises the stakes for peers.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("imports a spreadsheet into the Primary Tracker, then attaches the HTML with the green plus", async ({ page }) => {
    await page.goto("/input");
    const card = page.getByTestId("import-card");
    await expect(card.getByTestId("stream-primary")).toHaveAttribute("aria-pressed", "true");
    // The template has exactly the Primary Tracker's column names.
    const [tpl] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: /Download the Primary Tracker template/ }).click()]);
    expect(tpl.suggestedFilename()).toBe("eradigm-primary-tracker-import-template.xlsx");
    const id = `P-XL-${uid()}`;
    const title = `Imported KOL insight ${uid()}`;
    const header = ["ID", "Title", "Event Date", "Source Role", "Macrotrend", "Subtrend", "Growth Intensity", "Impact", "Source Type", "Competitors", "Action", "Key Intelligence Question"];
    const row = [id, title, "2026-09-01", "Oncology KOL", "AI Investment in R&D", "Agentic AI Platforms", "Stable", "Low", "Primary Source", "Roche, Novartis", "Not Actioned", "What is Roche piloting?"];
    // A real Excel workbook is read in the browser (first sheet, blank rows skipped).
    await card.locator('input[type="file"]').setInputFiles(path.join(path.dirname(new URL(import.meta.url).pathname), "../packages/shared/test/fixtures/legacy.xlsx"));
    await expect(card.getByTestId("drop-zone-import")).toContainText("3 rows ready to check and import");
    // A mistake first: an unknown column is reported and nothing is imported.
    const badCsv = htmlFile("bad.csv", `${[...header, "Colour"].join(",")}\n${[...row.map((v) => `"${v}"`), "blue"].join(",")}\n`);
    await card.locator('input[type="file"]').setInputFiles(badCsv);
    await expect(card.getByText(/Not a Primary Tracker column: “Colour”/)).toBeVisible();
    await expect(card.getByRole("button", { name: "Check and import" })).toBeDisabled();
    // Invalid values: every problem is listed by row and column, and nothing is written.
    const invalid = htmlFile("invalid.csv", `${header.join(",")}\n${row.map((v, i) => (i === 4 ? '"Not a macrotrend"' : `"${v}"`)).join(",")}\n`);
    await card.locator('input[type="file"]').setInputFiles(invalid);
    await card.getByRole("button", { name: "Check and import" }).click();
    await expect(card.getByText(/Nothing was imported: 2 problems to fix in invalid.csv/)).toBeVisible();
    await expect(card.getByRole("table", { name: "Import problems" })).toContainText("Macrotrend");
    // A good file (dropped): imported into the Primary Tracker.
    const good = htmlFile("legacy.csv", `${header.join(",")}\n${row.map((v) => `"${v}"`).join(",")}\n`);
    const dt = await page.evaluateHandle((text) => {
      const d = new DataTransfer();
      d.items.add(new File([text], "legacy.csv", { type: "text/csv" }));
      return d;
    }, readFileSync(good, "utf8"));
    await card.dispatchEvent("dragenter", { dataTransfer: dt });
    await card.dispatchEvent("dragover", { dataTransfer: dt });
    await card.dispatchEvent("drop", { dataTransfer: dt });
    await expect(card.getByTestId("drop-zone-import")).toContainText("1 row ready");
    await card.getByRole("button", { name: "Check and import" }).click();
    await expect(card.getByText(/Imported 1 entry into the Primary Tracker \(SIG-\d+\)/)).toBeVisible({ timeout: 30_000 });
    await expectAccessible(page, "/input after import");
    await card.getByRole("link", { name: "Open the Primary Tracker →" }).click();
    await expect(page).toHaveURL(/\/tracker$/);
    await page.getByRole("searchbox").fill(title);

    // No saved page yet: a green plus on the left; the row itself no longer opens anything.
    const tr = page.locator("table tbody tr", { hasText: title });
    await expect(tr.locator("td.src-col").getByRole("button", { name: `Attach the HTML page for ${title}` })).toBeVisible();
    await tr.locator("td.date").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const html = htmlFile("kol.html", `<!DOCTYPE html><html><head><title>KOL notes</title><script>alert(1)</script></head><body><article><h1>KOL notes on Roche</h1><p>The KOL said Roche is piloting agentic AI in two early research sites.</p><p>Results are expected in 2027.</p></article></body></html>`);
    await tr.locator('input[type="file"]').setInputFiles(html);
    await expect(page.locator(".toast")).toContainText(/Saved page attached to SIG-\d+/);
    // The icon opens the saved page itself as the side pane (not a new tab).
    const open = tr.getByRole("button", { name: `Open saved page for ${title}` });
    await expect(open).toBeVisible();
    await open.click();
    const pane = page.getByRole("dialog", { name: title });
    await expect(pane.frameLocator("iframe.snapshot-frame").getByText("piloting agentic AI")).toBeVisible();
    // The page fills the pane below its header.
    const [paneBox, frameBox] = [await pane.boundingBox(), await pane.locator("iframe.snapshot-frame").boundingBox()];
    expect(frameBox!.height).toBeGreaterThan(paneBox!.height * 0.8);
    await expectAccessible(page, "/tracker saved-page pane");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // It is in Primary Phantoms with the Primary Markdown.
    await page.getByRole("navigation").getByRole("link", { name: "Phantoms" }).click();
    await expect(page).toHaveURL(/\/phantoms\?q=/);
    const ph = page.locator("table tbody tr", { hasText: title });
    await ph.locator("td.title button").click();
    const md = page.getByRole("dialog").getByLabel("Markdown source");
    await expect(md).toContainText(`id: ${id}`);
    await expect(md).toContainText("Source:\n  Role: Oncology KOL");
    await expect(md).toContainText("## Key Intelligence Question\nWhat is Roche piloting?");
    await expect(md).not.toContainText("Agentic AI Platforms");
  });

  test("Inbox and Input pass automated accessibility checks", async ({ page }) => {
    for (const p of ["/inbox", "/input"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, p);
    }
  });
});
