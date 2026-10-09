import path from "node:path";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Locator, Page } from "@playwright/test";
import { choose, chooseMany, expect, expectAccessible, searchDatabase, signInAs, test } from "./fixtures";

const uid = () => Date.now().toString(36);

/** Fill every required tracker field of an Inbox card (plus any extras by label). */
async function fillEntry(card: Locator, v: { id?: string; title: string; impact?: string; competitors?: string[]; extra?: Record<string, string> }) {
  // The ID is filled in automatically (Date_Competitor_Title); there is no field for it.
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

/** How many Phantoms rows match a search (request 48: Phantoms has no page of its own; checked through the API). */
async function phantomsMatching(page: Page, q: string, stream: "primary" | "secondary" = "secondary") {
  return page.evaluate(
    async ({ q, stream }) => {
      const res = await fetch(`/api/phantoms?${new URLSearchParams({ stream, q, from: "2000-01-01", to: "2100-01-01", pageSize: "50" })}`, { headers: { "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" } });
      return ((await res.json()) as { rows: unknown[] }).rows.length;
    },
    { q, stream },
  );
}

/** Upload an HTML file through the one Input source card, as a Primary or a Secondary source. */
async function uploadTo(page: Page, stream: "primary" | "secondary", file: string) {
  const card = page.getByTestId("source-card");
  await card.getByTestId(`stream-${stream}`).click();
  await card.locator('input[type="file"]').setInputFiles(file);
  await card.getByRole("button", { name: `Process file for ${stream === "primary" ? "Primary" : "Secondary"} Source` }).click();
}

function htmlFile(name: string, html: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
  const file = path.join(dir, name);
  writeFileSync(file, html);
  return file;
}

// Eradigm staff work across Input, the Eradigm Inbox and the Database:
// since contract 1.12 only admins see all of those tabs (analysts' tabs: request19.spec.ts).
test.describe("Eradigm staff (admin)", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "admin"));

  test("completes an empty Inbox draft from the saved page: validation, manual entry and approve", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Eradigm Inbox", exact: true })).toBeVisible();
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

    await card.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(card.getByText(/Validation failed\. Complete: Title, Event Date, Macrotrend, Subtrend, Growth Intensity, Impact, Source Type, Competitors, Action/)).toBeVisible();
    await fillEntry(card, { id: `P-E2E-${uid()}`, title: "AstraZeneca and Roche form pre-competitive AI alliance", extra: { "Key Details": "Shared models.\n\nEach partner keeps its own assets." } });
    await card.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker as rev 1/).first()).toBeVisible();
    await page.getByRole("button", { name: /Pushed & Rejected/ }).click();
    await expect(page.locator(".inbox-card", { hasText: "AstraZeneca and Roche form pre-competitive AI alliance" }).getByText(/Pushed to Tracker · SIG-/)).toBeVisible();
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

  test("Input has one HTML source card with a Primary/Secondary switch (Secondary first) and no URL option; both go to the Eradigm Inbox", async ({ page }) => {
    await page.goto("/input");
    const card = page.getByTestId("source-card");
    await expect(page.getByTestId("source-primary")).toHaveCount(0);
    await expect(card.getByRole("heading", { name: "Add a source" })).toBeVisible();
    // The same Primary/Secondary switch as the spreadsheet import.
    await expect(card.getByTestId("stream-primary")).toHaveText("Primary Source");
    await expect(card.getByTestId("stream-secondary")).toHaveAttribute("aria-pressed", "true");
    await card.getByTestId("stream-primary").click();
    await expect(card).toContainText("Sent to the Eradigm Inbox as a Primary entry");
    await expect(page.getByRole("textbox", { name: /url/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Capture source|^URL$/ })).toHaveCount(0);
    await card.getByTestId("stream-secondary").click();
    await expect(card).toContainText("Sent to the Eradigm Inbox as a Secondary entry · Source Tier: Reviewed-Secondary");
    await expect(card.getByRole("button", { name: "Process file for Secondary Source" })).toBeVisible();
    await expectAccessible(page, "/input source card");

    const title = `Pfizer secondary routing ${uid()}`;
    const file = htmlFile("secondary.html", `<!DOCTYPE html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Pfizer has piloted an AI assistant for field teams in two regions, the company said.</p><p>The pilot runs until 2027.</p></article></body></html>`);
    await uploadTo(page, "secondary", file);
    await expect(page.getByText("Complete · sent to the Eradigm Inbox (Secondary)")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("table", { name: "Capture log" }).locator("tr", { hasText: "secondary.html" }).first()).toContainText("Secondary");
    await page.getByRole("button", { name: "Complete in Eradigm Inbox →" }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    const inbox = page.locator(".inbox-card", { hasText: title });
    await expect(inbox.getByRole("textbox", { name: "Source Tier", exact: true })).toHaveValue("Reviewed-Secondary");
    await expect(inbox.getByTestId("stream-tag")).toHaveText("Secondary");
    // One inbox for both: the filter narrows it to one tracker.
    await page.getByRole("group", { name: "Show entries from" }).getByRole("button", { name: "Primary" }).click();
    await expect(page.locator(".inbox-card", { hasText: title })).toHaveCount(0);
  });

  test("sends a blank manual entry to the chosen Inbox, filled in entirely there and approved", async ({ page }) => {
    await page.goto("/input");
    const card = page.getByTestId("source-card");
    await card.getByTestId("stream-secondary").click();
    await card.getByRole("button", { name: "✎ Manual entry" }).click();
    await expect(page.getByRole("heading", { name: "Blank entry sent to the Eradigm Inbox (Secondary)" })).toBeVisible();
    await expect(page.getByText("blank manual entry, no source file")).toBeVisible();
    // No capture steps for a manual entry.
    await expect(page.getByRole("heading", { name: /Capture · / })).toHaveCount(0);
    await page.getByRole("button", { name: "Complete in Eradigm Inbox →" }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    const blank = page.locator(".inbox-card", { hasText: "Manual entry" }).filter({ hasText: "Awaiting analyst entry" }).first();
    await expect(blank).toBeVisible();
    await expect(blank.getByText("manual entry: fill in every required field")).toBeVisible();
    await expect(blank.getByRole("button", { name: /Re-capture|Reprocess/ })).toHaveCount(0);
    await expect(blank.getByRole("button", { name: "View source" })).toHaveCount(0);
    await expect(blank.getByRole("textbox", { name: "Source Tier", exact: true })).toHaveValue("Reviewed-Secondary");
    const code = (await blank.locator(".code").innerText()).trim();
    const entry = page.locator(".inbox-card", { has: page.locator(".code", { hasText: code }) });
    const title = `Manual Sanofi entry ${uid()}`;
    await fillEntry(entry, { id: `S-MAN-${uid()}`, title, impact: "High", competitors: ["Sanofi"], extra: { Publisher: "Sanofi", Header: "Typed in by hand." } });
    await expectAccessible(page, "/inbox manual entry");
    await entry.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker/).first()).toBeVisible();
    // In the Secondary Tracker (on the Database page, request 48) with a green plus to attach the HTML later.
    await page.goto("/database?stream=secondary");
    await searchDatabase(page, title);
    await expect(page.locator("table tbody tr", { hasText: title }).getByRole("button", { name: `Attach the HTML page for ${title}` })).toBeVisible();
  });

  test("processes a SingleFile upload end-to-end into Needs review", async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
    const file = path.join(dir, "roche-lab.html");
    writeFileSync(
      file,
      `<!DOCTYPE html><html><!--\n Page saved with SingleFile \n url: https://newsroom.example.com/e2e-roche-lab-${Date.now().toString(36)} \n saved date: Wed Sep 24 2026\n--><head><title>Roche opens robotics-enabled lab</title><meta property="article:published_time" content="2026-09-24"><script>alert(1)</script></head><body><article><h1>Roche opens robotics-enabled autonomous lab in Basel ${Date.now().toString(36)}</h1><p>Roche has opened an autonomous laboratory where robotics-enabled labs run design-make-test cycles for small molecules around the clock.</p><p>The company said the lab will double experimental throughput for its early discovery teams by 2027.</p></article></body></html>`,
    );
    await page.goto("/input");
    await uploadTo(page, "primary", file);
    await expect(page.getByText("Complete · sent to the Eradigm Inbox (Primary)")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".step", { hasText: "Content scan before storage" })).toContainText("script(s) stripped");
    await expect(page.locator(".step", { hasText: "Data policy check" })).toContainText("nothing sent to any external service");
    await expect(page.locator(".step", { hasText: "Routed to Needs review" })).toContainText("every tracker field empty");
    await expect(page.getByRole("heading", { name: "Model output" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sent to the Eradigm Inbox (Primary)" })).toBeVisible();
    await expectAccessible(page, "/input with results");
    await page.getByRole("button", { name: "Complete in Eradigm Inbox →" }).click();
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
    const card = page.getByTestId("source-card");
    await card.getByTestId("stream-secondary").click();
    await card.dispatchEvent("dragenter", { dataTransfer: dt });
    await card.dispatchEvent("dragover", { dataTransfer: dt });
    await card.dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByTestId("drop-zone-html")).toContainText("dropped.html");
    await expect(page.getByTestId("drop-zone-import")).not.toContainText("dropped.html");
    await card.getByRole("button", { name: "Process file for Secondary Source" }).click();
    await expect(page.getByText("Complete · sent to the Eradigm Inbox (Secondary)")).toBeVisible({ timeout: 30_000 });
  });

  test("warns about a source already in the tracker, but lets it through and requires an explicit override to approve (Secondary entries only)", async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
    // Same URL as the published Primary seed entry SIG-1100: Primary entries are never duplicates (request 27).
    const primaryFile = path.join(dir, "primary-again.html");
    writeFileSync(
      primaryFile,
      `<!DOCTYPE html><html><!--\n Page saved with SingleFile \n url: https://source.example.com/sig-1100 \n saved date: Wed Sep 24 2026\n--><head><title>Roche DTP again</title></head><body><article><h1>Roche brings DTP offering to a national retail pharmacy chain (primary again)</h1><p>Roche has extended its direct-to-patient offering to a national retail pharmacy chain, the company said.</p><p>The roll-out covers all stores by 2027.</p></article></body></html>`,
    );
    await page.goto("/input");
    await uploadTo(page, "primary", primaryFile);
    await expect(page.getByText(/sent to the Eradigm Inbox \(Primary\)/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Possible duplicate/)).toHaveCount(0);
    // Same URL as the published Secondary seed entry SIG-1102.
    const file = path.join(dir, "again.html");
    writeFileSync(
      file,
      `<!DOCTYPE html><html><!--\n Page saved with SingleFile \n url: https://newsroom.example.com/sig-1102 \n saved date: Wed Sep 24 2026\n--><head><title>Again</title></head><body><article><h1>A tracked story, re-saved</h1><p>The same story as a Secondary entry already in the Tracker, saved a second time.</p><p>It continues in 2027.</p></article></body></html>`,
    );
    await page.goto("/input");
    await uploadTo(page, "secondary", file);
    await expect(page.getByText(/Possible duplicate: this source is already in the tracker as SIG-1102/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/sent to the Eradigm Inbox \(Secondary\)/).first()).toBeVisible();

    await page.goto("/inbox");
    await expect(page.locator(".inbox-card", { hasText: "primary again" }).first().getByText(/Duplicate of/)).toHaveCount(0);
    const first = page.locator(".inbox-card", { hasText: "re-saved" }).first();
    await expect(first.getByText("⚠ Duplicate of SIG-1102")).toBeVisible();
    // Track the card by its Inbox code: its title changes once the analyst types one.
    const code = (await first.locator(".code").innerText()).trim();
    const card = page.locator(".inbox-card", { has: page.locator(".code", { hasText: code }) });
    await fillEntry(card, { id: `P-DUP-${uid()}`, title: "Roche DTP retail roll-out (second entry)", impact: "Medium", competitors: ["Roche"] });
    await card.getByRole("button", { name: "✓ Push to Tracker" }).click();
    const dialog = card.getByRole("alertdialog");
    await expect(dialog).toContainText("Duplicate — SIG-1102 is already in the tracker");
    await expect(dialog.getByRole("link", { name: /Open SIG-1102 in the Database/ })).toHaveAttribute("href", /\/database\?signal=/);
    await expectAccessible(page, "/inbox duplicate confirmation");
    await dialog.getByRole("button", { name: "Cancel — don't approve" }).click();
    await expect(card.getByRole("alertdialog")).toHaveCount(0);
    await card.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await card.getByRole("button", { name: "Approve anyway (override duplicate)" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker as rev 1 \(duplicate confirmed\)/).first()).toBeVisible();
    // Leave the Inbox as the other tests expect it: reject the Primary copy.
    await page.evaluate(async () => {
      const h = { "x-eci-request": "1", "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "", "content-type": "application/json" };
      const items: { id: string; version: number; title: string | null }[] = await (await fetch("/api/items?status=needs_review", { headers: h })).json();
      for (const i of items.filter((x) => (x.title ?? "").includes("primary again"))) await fetch(`/api/items/${i.id}/reject`, { method: "POST", headers: h, body: JSON.stringify({ version: i.version }) });
    });
  });

  test("reorders tracker columns: A–Z, Z–A, move buttons and drag and drop", async ({ page }) => {
    await page.goto("/inbox");
    // The column editor opens on Secondary.
    const original = [...(await schemaOf(page, "secondary")).columns].sort((a, b) => a.position - b.position).map((c) => c.key);
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
    // The Tracker has its own order: reordering the Inbox does not change it (request 48: the Tracker table has no page of its own).
    await expect(page.getByTestId("table-cols-tracker").locator(".tcol-label").first()).toHaveText("Title");
    await expect(page.getByTestId("table-cols-tracker").locator(".tcol-label")).toHaveCount(9);
    await restoreOrder(page, "secondary", original);
  });

  test("edits the Tracker and Phantoms tables separately, from the Inbox columns only", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Edit columns" }).click();
    // The column editor works on one tracker at a time (Secondary first).
    await expect(page.getByRole("heading", { name: "Secondary Inbox columns" })).toBeVisible();
    await page.getByRole("group", { name: "Columns of" }).getByTestId("stream-primary").click();
    await expect(page.getByRole("heading", { name: "Primary Inbox columns" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Primary Tracker columns" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Primary Phantoms columns" })).toBeVisible();
    const tracker = page.getByTestId("table-cols-tracker");
    const phantoms = page.getByTestId("table-cols-phantoms");
    const names = (t: typeof tracker) => t.locator(".tcol-label").allInnerTexts();
    expect(await names(tracker)).toEqual(["Title", "Event Date", "Macrotrend", "Subtrend", "Growth Intensity", "Impact", "Source Type", "Competitors", "Action"]);
    expect((await names(phantoms)).slice(0, 4)).toEqual(["ID", "Title", "Event Date", "Source Role"]);
    await expectAccessible(page, "/inbox column tables");

    // Tracker: sort A → Z, then move a column with the keyboard buttons.
    await tracker.getByRole("button", { name: "Sort Primary Tracker columns A to Z" }).click();
    await expect(page.locator(".toast").last()).toContainText("Primary Tracker columns sorted A → Z");
    await expect.poll(() => names(tracker)).toEqual(["Action", "Competitors", "Event Date", "Growth Intensity", "Impact", "Macrotrend", "Source Type", "Subtrend", "Title"]);
    await tracker.getByRole("button", { name: "Move column Title up" }).click();
    await expect.poll(async () => (await names(tracker)).slice(-2)).toEqual(["Title", "Subtrend"]);

    // Phantoms: remove Key Metrics, add Macrotrend (only Inbox columns can be added).
    await phantoms.getByRole("button", { name: "Remove Key Metrics from the Primary Phantoms" }).click();
    await expect(page.locator(".toast").last()).toContainText("Removed “Key Metrics” from the Primary Phantoms");
    await choose(phantoms.getByRole("combobox", { name: "Inbox column to add to the Primary Phantoms" }), "Macrotrend");
    await phantoms.getByRole("button", { name: "+ Add to Phantoms" }).click();
    await expect.poll(async () => (await names(phantoms)).at(-1)).toBe("Macrotrend");
    expect(await names(phantoms)).not.toContain("Key Metrics");
    // Key Metrics is still an Inbox column.
    await expect(page.getByLabel("Rename column Key Metrics", { exact: true })).toBeVisible();

    // Saved: the tables keep them after a reload (request 48: they have no pages of their own; they shape exports, Markdown and the graphs' entries).
    await page.reload();
    await page.getByRole("button", { name: "Edit columns" }).click();
    await page.getByRole("group", { name: "Columns of" }).getByTestId("stream-primary").click();
    await expect.poll(async () => (await names(tracker))[0]).toBe("Action");
    await expect.poll(async () => (await names(phantoms)).at(-1)).toBe("Macrotrend");
    expect(await names(phantoms)).not.toContain("Key Metrics");

    // Put the defaults back for the other tests.
    await page.evaluate(async () => {
      const h = { "content-type": "application/json", "x-eci-request": "1", "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" };
      const send = (method: string, url: string, body: unknown) => fetch(url, { method, headers: h, body: JSON.stringify(body) });
      await send("PATCH", "/api/schema/columns/macrotrend?stream=primary", { inPhantoms: false });
      await send("PATCH", "/api/schema/columns/key_metrics?stream=primary", { inPhantoms: true });
      await send("PUT", "/api/schema/columns/order?stream=primary", { table: "tracker", keys: ["title", "date", "macrotrend", "subtrend", "growth", "impact", "source", "competitors", "action"] });
    });
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
    await restoreOrder(page, "secondary", original, "source");
  });

  test("a long-text manual entry with an old Event Date is approved, flagged and one click away", async ({ page }) => {
    await page.goto("/input");
    const src = page.getByTestId("source-card");
    await src.getByTestId("stream-secondary").click();
    await src.getByRole("button", { name: "✎ Manual entry" }).click();
    await page.getByRole("button", { name: "Complete in Eradigm Inbox →" }).click();
    const blank = page.locator(".inbox-card", { hasText: "Manual entry" }).filter({ hasText: "Awaiting analyst entry" }).first();
    const code = (await blank.locator(".code").innerText()).trim();
    const card = page.locator(".inbox-card", { has: page.locator(".code", { hasText: code }) });
    const title = `Old long entry ${uid()}`;
    const para = "Sanofi’s “AI-first” strategy — announced on 24 Sept — covers 12 sites; it's worth €1.2bn. ✓\n\n";
    await fillEntry(card, {
      id: `S-OLD-${uid()}`,
      title,
      competitors: ["Sanofi"],
      extra: { Publisher: para.repeat(10).replace(/\n/g, " ").slice(0, 1500), Header: para.repeat(80), "Key Details": para.repeat(80), "CI Perspective": para.repeat(80) },
    });
    await card.getByLabel("Event Date", { exact: true }).fill("2024-03-12");
    await card.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(page.locator(".toast").last()).toContainText(/SIG-\d+ published to the tracker as rev 1/);
    // The default dates start at the oldest entry, so it is in view straight away (no date hint).
    await page.goto("/database?stream=secondary");
    await searchDatabase(page, title);
    await expect(page.getByLabel("Event Date from")).toHaveValue("2024-03-12");
    await expect(page.locator("table tbody td.title", { hasText: title })).toBeVisible();
    await expect(page.getByTestId("dates-hint")).toHaveCount(0);
    await expect(page).not.toHaveURL(/from=/);
    // The Analytics Dashboard plots it too (all dates, no filters).
    await page.goto("/dashboard");
    await expect(page.getByTestId("signal-timeline").getByRole("button", { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`) })).toHaveCount(1);
    // From the Inbox: View in Database opens the entry.
    await page.goto("/inbox?stream=secondary");
    await page.getByRole("button", { name: /^Pushed & Rejected/ }).click();
    const done = page.locator(".inbox-card", { has: page.locator(".code", { hasText: code }) });
    await done.getByRole("link", { name: "View in Database →" }).click();
    await expect(page).toHaveURL(/\/database\?.*signal=/);
    await expect(page.getByRole("dialog").getByRole("heading", { name: title })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("table tbody td.title", { hasText: title })).toBeVisible();
  });

  test("Delete Tracker Entry from the record: gone from the Tracker, still in Phantoms", async ({ page }) => {
    await page.goto("/database");
    // The oldest entry (the Phantoms test below works on the newest ones).
    await page.locator("table thead").getByRole("button", { name: /^Event Date/ }).click();
    await expect(page).toHaveURL(/dir=asc/);
    const firstRow = page.locator("table tbody tr").first();
    const title = (await firstRow.locator("td.title").innerText()).trim();
    await firstRow.locator("td.title button").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = drawer.getByRole("alertdialog");
    await expect(confirm).toContainText("Delete Tracker Entry removes it from the Tracker, the Dashboard and Tracker exports. It stays in Phantoms.");
    await expect(confirm).toContainText("Delete Globally removes it from the Tracker, Phantoms, the Dashboard and all exports");
    await expect(confirm.getByRole("button", { name: "Delete Globally" })).toBeVisible();
    await expectAccessible(page, "/database delete choice");
    await confirm.getByLabel(/Reason/).fill("E2E tracker-only deletion");
    const code = (await confirm.locator("#del-title").innerText()).match(/SIG-\d+/)?.[0] as string;
    await confirm.getByRole("button", { name: "Delete Tracker Entry" }).click();
    await expect(page.locator(".toast")).toContainText(`Deleted ${code} from the Tracker · still in Phantoms`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("table tbody td.title", { hasText: title })).toHaveCount(0);
    // Still in Phantoms (its Markdown and its alert use it).
    expect(await phantomsMatching(page, title)).toBeGreaterThan(0);
  });

  test("selects Database entries with tick boxes: Delete Tracker Entry, then Delete Globally", async ({ page }) => {
    // Three entries of its own (in the Tracker and Phantoms), so other tests' deletions never get in the way.
    const tag = `TICK-${uid()}`;
    await page.goto("/dashboard");
    await page.evaluate(async (tag) => {
      const h = { "x-eci-request": "1", "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "", "content-type": "application/json" };
      for (const n of [1, 2, 3]) {
        const { item } = await (await fetch("/api/submissions/manual", { method: "POST", headers: h, body: JSON.stringify({ stream: "secondary" }) })).json();
        const values = { ...item.draft, title: `${tag} entry ${n}`, date: `2026-09-1${n}`, macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", growth: "Stable", impact: "High", source: "PR", competitors: ["Roche"], action: "Not Actioned" };
        const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST", headers: h, body: JSON.stringify({ values, version: item.version }) });
        if (!res.ok) throw new Error(await res.text());
      }
    }, tag);
    // Request 48: the Database page (Phantoms has no page of its own any more).
    await page.goto(`/database?${new URLSearchParams({ "db.q": tag })}`);
    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(3);
    const bar = page.getByRole("group", { name: "Selected entries" });
    // The header box selects the whole page, and again clears it.
    const all = page.getByRole("checkbox", { name: "Select every entry on this page" });
    await all.check();
    await expect(bar).toContainText("3 selected");
    await all.uncheck();
    await expect(bar).toHaveCount(0);

    // One entry from the Tracker only: it stays in Phantoms.
    const only = (await rows.nth(0).locator("td.title").innerText()).trim();
    await rows.nth(0).getByRole("checkbox").check();
    await expect(bar).toContainText("1 selected");
    await bar.getByRole("button", { name: "Delete selected" }).click();
    const one = page.getByRole("alertdialog", { name: /^Delete SIG-\d+\?$/ });
    await expect(one).toContainText("Delete Tracker Entry removes it from the Tracker, the Dashboard and Tracker exports. It stays in Phantoms.");
    await one.getByRole("button", { name: "Delete Tracker Entry" }).click();
    await expect(page.locator(".toast")).toContainText(/Deleted SIG-\d+ from the Tracker · still in Phantoms/);
    await expect(page.locator("table tbody td.title", { hasText: only })).toHaveCount(0);
    expect(await phantomsMatching(page, only)).toBe(1);

    // Two entries globally: gone from Phantoms too.
    await expect(rows).toHaveCount(2);
    const titles = [(await rows.nth(0).locator("td.title").innerText()).trim(), (await rows.nth(1).locator("td.title").innerText()).trim()];
    await rows.nth(0).getByRole("checkbox").check();
    await rows.nth(1).getByRole("checkbox").check();
    await expect(bar).toContainText("2 selected");
    await bar.getByRole("button", { name: "Delete selected" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete 2 entries?" });
    await expect(confirm.getByRole("button", { name: "Delete Tracker Entries" })).toBeVisible();
    await expect(confirm).toContainText(titles[0]!);
    await expectAccessible(page, "/database delete confirmation");
    await confirm.getByLabel(/Reason/).fill("E2E bulk deletion");
    await confirm.getByRole("button", { name: "Delete Globally" }).click();
    await expect(page.locator(".toast")).toContainText("Deleted 2 entries globally");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(rows).toHaveCount(0);
    for (const t of titles) expect(await phantomsMatching(page, t)).toBe(0);
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

  test("one Eradigm Inbox for both trackers: each entry with its own tag and fields, and a filter", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Eradigm Inbox", exact: true })).toBeVisible();
    // Primary and Secondary entries side by side (one of each awaiting review).
    const pick = await page.evaluate(async () => {
      const items = (await (await fetch("/api/items?status=needs_review", { headers: { "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" } })).json()) as { stream: string; code: string; withClient: boolean }[];
      const one = (st: string) => items.find((i) => i.stream === st && !i.withClient)!.code;
      return { p: one("primary"), s: one("secondary") };
    });
    const card = (code: string) => page.locator(".inbox-card", { has: page.locator(".code", { hasText: new RegExp(`^${code}$`) }) });
    const sec = card(pick.s);
    const pri = card(pick.p);
    await expect(sec.getByTestId("stream-tag")).toHaveText("Secondary");
    await expect(pri.getByTestId("stream-tag")).toHaveText("Primary");
    // Each with its own tracker's fields.
    await expect(sec.getByRole("textbox", { name: "Source Tier", exact: true })).toHaveValue("Reviewed-Secondary");
    await expect(pri.getByRole("textbox", { name: "Source Role", exact: true })).toBeVisible();
    const filter = page.getByRole("group", { name: "Show entries from" });
    await filter.getByRole("button", { name: "Secondary" }).click();
    await expect(sec).toBeVisible();
    await expect(pri).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Columns · Secondary" })).toBeVisible();
    await filter.getByRole("button", { name: "Primary" }).click();
    await expect(pri).toBeVisible();
    await expect(sec).toHaveCount(0);
    // The column editor follows the Primary / Secondary view (request 31).
    await expect(page.getByRole("heading", { name: "Columns · Primary" })).toBeVisible();
    await filter.getByRole("button", { name: "All" }).click();
    await expect(sec).toBeVisible();
    await expectAccessible(page, "/inbox");
  });

  test("Phantoms: approved entries get a Markdown file (Database → Markdown column) that opens as a side pane", async ({ page }) => {
    const title = `Sanofi opens AI hub ${uid()}`;
    const file = htmlFile("phantom.html", `<!DOCTYPE html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Sanofi has opened an AI hub in Paris with 300 staff, the company said on Monday.</p><p>The hub opens in 2027.</p></article></body></html>`);
    await page.goto("/input");
    await uploadTo(page, "secondary", file);
    await expect(page.getByText("Complete · sent to the Eradigm Inbox (Secondary)")).toBeVisible({ timeout: 30_000 });
    await page.goto("/inbox?stream=secondary");
    const first = page.locator(".inbox-card", { hasText: title });
    const code = (await first.locator(".code").innerText()).trim();
    const card = page.locator(".inbox-card", { has: page.locator(".code", { hasText: code }) });
    // The ID is filled in automatically: Date_Competitor_Title.
    const rid = `2026-09-24_Sanofi_${title}: Paris`;
    await fillEntry(card, {
      title: `${title}: Paris`,
      impact: "High",
      competitors: ["Sanofi"],
      extra: { Publisher: "Sanofi", URL: "https://www.sanofi.com/ai-hub", Header: "Sanofi opens a Paris AI hub.", "Key Details": "300 staff.\n\nOpens 2027.", "CI Perspective": "Raises the stakes for peers." },
    });
    await card.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker/).first()).toBeVisible();

    // In the Secondary Tracker (not the Primary one), and in Secondary Phantoms (Impact High ≥ Medium): the Database's Markdown column (request 48).
    await page.goto(`/database?${new URLSearchParams({ stream: "secondary", "db.q": title })}`);
    await expect(page.locator("td.title", { hasText: `${title}: Paris` })).toBeVisible();
    await page.getByTestId("stream-primary").click();
    await expect(page.locator("td.title", { hasText: `${title}: Paris` })).toHaveCount(0);
    await page.getByTestId("stream-secondary").click();
    const row = page.locator("table tbody tr", { hasText: `${title}: Paris` });
    await expect(row).toBeVisible();
    // The MD icon opens the Markdown file as a full side pane; Download is at the top right.
    await row.getByRole("button", { name: `Open Markdown for ${title}: Paris` }).click();
    const panel = page.getByRole("dialog", { name: `${title}: Paris` });
    const md = panel.getByLabel("Markdown source");
    await expect(md).toContainText(`id: "${rid}"`);
    const [paneBox, mdBox] = [(await panel.boundingBox())!, (await md.boundingBox())!];
    expect(mdBox.height).toBeGreaterThan(paneBox.height * 0.75);
    const dl = panel.getByRole("button", { name: "Download Markdown" });
    const dlBox = (await dl.boundingBox())!;
    expect(dlBox.y).toBeLessThan(paneBox.y + 80);
    expect(dlBox.x).toBeGreaterThan(paneBox.x + paneBox.width / 2);
    const [download] = await Promise.all([page.waitForEvent("download"), dl.click()]);
    expect(download.suggestedFilename()).toBe(`${rid.replace(/[^A-Za-z0-9._-]+/g, "_")}.md`);
    const text = readFileSync((await download.path())!, "utf8");
    expect(text.startsWith(`---\nid: "${rid}"\ntitle: "${title}: Paris"\nevent_date: 2026-09-24\nsource_type: PR\nSource:\n  Publisher: Sanofi\n  URL: https://www.sanofi.com/ai-hub\n`)).toBe(true);
    expect(text).toContain("Source_tier: Reviewed-Secondary\nCompetitors: Sanofi\n");
    expect(text).toContain("QC:\n  Reviewed_by: E. Admin\n");
    expect(text).toContain("## Key Details\n300 staff.\n\nOpens 2027.\n");
    // The pane shows it raw and rendered.
    await expectAccessible(page, "/database Markdown panel");
    await panel.getByRole("button", { name: "Preview" }).click();
    await expect(panel.getByRole("heading", { name: "CI Perspective" })).toBeVisible();
    await expect(panel.getByText("Raises the stakes for peers.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("import follows the Inbox columns: option changes apply on the next check, without choosing the file again", async ({ page }) => {
    await page.goto("/input");
    const card = page.getByTestId("import-card");
    await card.getByTestId("stream-primary").click();
    const header = ["ID", "Title", "Event Date", "Source Role", "Macrotrend", "Subtrend", "Growth Intensity", "Impact", "Source Type", "Competitors", "Action"];
    const title = `Analyst call insight ${uid()}`;
    // An option name no other test uses; the sheet has it in lower case.
    const option = `Expert Call ${uid().toUpperCase()}`;
    const row = [`P-AC-${uid()}`, title, "2026-09-02", "Oncology KOL", "ai investment in r&d", "Agentic AI Platforms", "stable", "LOW", option.toLowerCase(), "roche", "Not actioned"];
    await card.locator('input[type="file"]').setInputFiles(htmlFile("analyst.csv", `${header.join(",")}\n${row.map((v) => `"${v}"`).join(",")}\n`));
    await expect(card.getByTestId("drop-zone-import")).toContainText("1 row ready");
    // What each column accepts, from the current Primary Inbox columns.
    const rules = card.getByTestId("import-rules");
    await rules.locator("summary").click();
    const sourceRule = rules.locator("tr", { has: page.getByText("Source Type", { exact: true }) });
    await expect(sourceRule).toContainText("One of the options: ");
    await expect(sourceRule).not.toContainText(option);
    await expectAccessible(page, "/input import rules");
    // It is not an option yet: the problem names the value and the allowed options.
    await card.getByRole("button", { name: "Check and import" }).click();
    const problems = card.getByRole("table", { name: "Import problems" });
    await expect(problems).toContainText(`“${option.toLowerCase()}” is not a Primary Source Type option. Options: `);
    await expect(problems).toContainText("Add or rename options under Inbox → Edit columns (Primary Inbox), then check again.");
    await expect(problems.locator("tbody tr")).toHaveCount(1); // the other values match despite their capitals
    // The option is added in the Primary Inbox (here through the API, as from another tab)…
    await page.evaluate(async (value) => {
      const res = await fetch("/api/schema/columns/source/options?stream=primary", {
        method: "POST",
        headers: { "content-type": "application/json", "x-eci-request": "1", "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error(`add option failed ${res.status}`);
    }, option);
    // …and the same file passes on the next check, with the value stored as the option.
    await card.getByRole("button", { name: "Check and import" }).click();
    await expect(card.getByText(/Imported 1 entry into the Primary Tracker \(SIG-\d+\)/)).toBeVisible({ timeout: 30_000 });
    await expect(sourceRule).toContainText(option);
    await page.goto(`/database?${new URLSearchParams({ stream: "primary", "db.q": title })}`);
    const tr = page.locator("table tbody tr", { hasText: title });
    await expect(tr).toContainText(option);
    await expect(tr).toContainText("AI Investment in R&D");
  });

  test("the import keeps the chosen file when switching between the Primary and Secondary Tracker", async ({ page }) => {
    await page.goto("/input");
    const card = page.getByTestId("import-card");
    await card.locator('input[type="file"]').setInputFiles(htmlFile("cols.csv", "ID,Title,Source Role\nP-1,Hello,KOL\n"));
    await expect(card.getByText(/Missing required columns?: /)).toBeVisible();
    await card.getByTestId("stream-secondary").click();
    await expect(card.getByText(/Not a Secondary Tracker column: “Source Role”/)).toBeVisible();
    await card.getByTestId("stream-primary").click();
    await expect(card.getByText(/Not a Secondary Tracker column/)).toHaveCount(0);
    await expect(card.getByTestId("drop-zone-import")).toContainText("cols.csv");
  });

  test("imports a spreadsheet into the Primary Tracker, then attaches the HTML with the green plus", async ({ page }) => {
    await page.goto("/input");
    const card = page.getByTestId("import-card");
    // Secondary first; switch to the Primary Tracker.
    await expect(card.getByTestId("stream-secondary")).toHaveAttribute("aria-pressed", "true");
    await card.getByTestId("stream-primary").click();
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
    // Its header is read: it has only five columns, so the required ones it lacks are listed up front.
    await expect(card.getByText(/Missing required columns: “Macrotrend”, “Subtrend”, /)).toBeVisible();
    await expect(card.getByRole("button", { name: "Check and import" })).toBeDisabled();
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
    await card.getByRole("link", { name: "Open the Primary Tracker in the Database →" }).click();
    await expect(page).toHaveURL(/\/database\?stream=primary$/);
    await searchDatabase(page, title);

    // No saved page yet: a green plus on the left; the row itself opens the entry's fields (request 54), not the page.
    const tr = page.locator("table tbody tr", { hasText: title });
    await expect(tr.getByRole("button", { name: `Attach the HTML page for ${title}` })).toBeVisible();
    await tr.locator("td.date").click();
    await expect(page.getByTestId("entry-fields")).toBeVisible();
    await page.keyboard.press("Escape");
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
    await expectAccessible(page, "/database saved-page pane");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // It is in Primary Phantoms with the Primary Markdown (the Database's Markdown column).
    await tr.getByRole("button", { name: `Open Markdown for ${title}` }).click();
    const md = page.getByRole("dialog").getByLabel("Markdown source");
    await expect(md).toContainText(`id: ${id}`);
    await expect(md).toContainText("Source:\n  Role: Oncology KOL");
    await expect(md).toContainText("## Key Intelligence Question\nWhat is Roche piloting?");
    await expect(md).not.toContainText("Agentic AI Platforms");
  });

  test("edits a Tracker entry and pushes it again; its Phantom (and Markdown) keeps the first version", async ({ page }) => {
    await page.goto("/database?stream=primary");
    const row = page.locator("table tbody tr").nth(2);
    const title = (await row.locator("td.title").innerText()).trim();
    await row.getByRole("button", { name: `Edit ${title}` }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Edit entry")).toBeVisible();
    // A field of the edit form by its label (a textarea's accessible name also contains its text).
    const field = (label: string) => drawer.locator(".edit-form .field").filter({ has: page.getByText(label, { exact: true }) }).locator("input, textarea").first();
    const newTitle = `${title} (edited ${uid()})`;
    await field("Title *").fill(newTitle);
    // The approval checks run again: a cleared required field is flagged next to it.
    const id = await field("ID *").inputValue();
    await field("ID *").fill("");
    await drawer.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(drawer.getByRole("alert")).toContainText("One field needs attention before approval");
    await expect(drawer.locator(".field-err")).toContainText(/ID/);
    await field("ID *").fill(id);
    await expectAccessible(page, "/database edit form");
    await drawer.getByRole("button", { name: "✓ Push to Tracker" }).click();
    await expect(page.locator(".toast").last()).toContainText(/SIG-\d+ pushed to the Tracker again as rev \d+ · its Phantom is unchanged/);
    await expect(drawer.getByRole("heading", { name: newTitle })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("table tbody tr", { hasText: newTitle })).toBeVisible();
    // Its Phantom keeps the first version: the Markdown (Database → Markdown column), with no Edit in its pane.
    await page.locator("table tbody tr", { hasText: newTitle }).getByRole("button", { name: `Open Markdown for ${newTitle}` }).click();
    const md = page.getByRole("dialog").getByLabel("Markdown source");
    await expect(md).toContainText(`title: ${title}`);
    await expect(md).not.toContainText(newTitle);
  });

  test("Inbox and Input pass automated accessibility checks", async ({ page }) => {
    for (const p of ["/inbox", "/input"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, p);
    }
  });
});
