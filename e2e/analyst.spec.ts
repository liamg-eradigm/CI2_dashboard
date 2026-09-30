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

  test("Input has one HTML source card with a Primary/Secondary switch and no URL option; each goes to its own inbox", async ({ page }) => {
    await page.goto("/input");
    const card = page.getByTestId("source-card");
    await expect(page.getByTestId("source-primary")).toHaveCount(0);
    await expect(card.getByRole("heading", { name: "Add a source" })).toBeVisible();
    // The same Primary/Secondary switch as the spreadsheet import.
    await expect(card.getByTestId("stream-primary")).toHaveText("Primary Source");
    await expect(card.getByTestId("stream-primary")).toHaveAttribute("aria-pressed", "true");
    await expect(card).toContainText("Sent to the Primary Inbox");
    await expect(page.getByRole("textbox", { name: /url/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Capture source|^URL$/ })).toHaveCount(0);
    await card.getByTestId("stream-secondary").click();
    await expect(card).toContainText("Sent to the Secondary Inbox · Source Tier: Reviewed-Secondary");
    await expect(card.getByRole("button", { name: "Process file for Secondary Source" })).toBeVisible();
    await expectAccessible(page, "/input source card");

    const title = `Pfizer secondary routing ${uid()}`;
    const file = htmlFile("secondary.html", `<!DOCTYPE html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Pfizer has piloted an AI assistant for field teams in two regions, the company said.</p><p>The pilot runs until 2027.</p></article></body></html>`);
    await uploadTo(page, "secondary", file);
    await expect(page.getByText("Complete · sent to the Secondary Inbox")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("table", { name: "Capture log" }).locator("tr", { hasText: "secondary.html" }).first()).toContainText("Secondary");
    await page.getByRole("button", { name: "Complete in Secondary Inbox →" }).click();
    await expect(page).toHaveURL(/\/inbox\?stream=secondary/);
    const inbox = page.locator(".inbox-card", { hasText: title });
    await expect(inbox.getByRole("textbox", { name: "Source Tier", exact: true })).toHaveValue("Reviewed-Secondary");
    await page.getByTestId("stream-primary").click();
    await expect(page.locator(".inbox-card", { hasText: title })).toHaveCount(0);
  });

  test("sends a blank manual entry to the chosen Inbox, filled in entirely there and approved", async ({ page }) => {
    await page.goto("/input");
    const card = page.getByTestId("source-card");
    await card.getByTestId("stream-secondary").click();
    await card.getByRole("button", { name: "✎ Manual entry" }).click();
    await expect(page.getByRole("heading", { name: "Blank entry sent to the Secondary Inbox" })).toBeVisible();
    await expect(page.getByText("blank manual entry, no source file")).toBeVisible();
    // No capture steps for a manual entry.
    await expect(page.getByRole("heading", { name: /Capture · / })).toHaveCount(0);
    await page.getByRole("button", { name: "Complete in Secondary Inbox →" }).click();
    await expect(page).toHaveURL(/\/inbox\?stream=secondary/);
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
    await entry.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.getByText(/SIG-\d+ published to the tracker/).first()).toBeVisible();
    // In the Secondary Tracker with a green plus to attach the HTML later.
    await page.goto("/tracker?stream=secondary");
    await page.getByRole("searchbox").fill(title);
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
    const card = page.getByTestId("source-card");
    await card.getByTestId("stream-secondary").click();
    await card.dispatchEvent("dragenter", { dataTransfer: dt });
    await card.dispatchEvent("dragover", { dataTransfer: dt });
    await card.dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByTestId("drop-zone-html")).toContainText("dropped.html");
    await expect(page.getByTestId("drop-zone-import")).not.toContainText("dropped.html");
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
    await uploadTo(page, "primary", file);
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
    // The Tracker has its own order: reordering the Inbox does not change it.
    await page.goto("/tracker");
    await expect(page.locator("table thead th:not(.src-col):not(.pick-col)").first()).toContainText("Title", { timeout: 15_000 });
    await expect(page.locator("table thead th:not(.src-col):not(.pick-col)")).toHaveCount(9);
    await restoreOrder(page, "primary", original);
  });

  test("edits the Tracker and Phantoms tables separately, from the Inbox columns only", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Edit columns" }).click();
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

    // The tables follow.
    await page.goto("/tracker");
    const heads = () => page.locator("table thead th:not(.src-col):not(.pick-col)").allInnerTexts();
    await expect.poll(async () => (await heads())[0]).toMatch(/^Action/i);
    await page.goto("/phantoms");
    await expect.poll(async () => (await heads()).at(-1)).toMatch(/^Macrotrend/i);
    expect((await heads()).join("|").toLowerCase()).not.toContain("key metrics");

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
    await restoreOrder(page, "primary", original, "source");
  });

  test("a long-text manual entry with an old Event Date is approved, flagged and one click away", async ({ page }) => {
    await page.goto("/input");
    const src = page.getByTestId("source-card");
    await src.getByTestId("stream-secondary").click();
    await src.getByRole("button", { name: "✎ Manual entry" }).click();
    await page.getByRole("button", { name: "Complete in Secondary Inbox →" }).click();
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
    await card.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.locator(".toast").last()).toContainText(/SIG-\d+ published to the tracker as rev 1 · its Event Date \(12 Mar 2024\) is outside the default last-three-months view/);
    // Hidden by the default dates in the Tracker, with a hint and "Show all dates".
    await page.goto("/tracker?stream=secondary");
    await page.getByRole("searchbox").fill(title);
    await expect(page.locator("table tbody td.title", { hasText: title })).toHaveCount(0);
    const hint = page.getByTestId("dates-hint");
    await expect(hint).toContainText("1 more entry is outside these dates");
    await hint.getByRole("button", { name: "Show all dates" }).click();
    await expect(page.locator("table tbody td.title", { hasText: title })).toBeVisible();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
    // The Dashboard says so too.
    await page.goto("/dashboard");
    await expect(page.locator(".dates-banner")).toContainText("outside these dates");
    // From the Inbox: View in Tracker opens the entry, with the dates widened to include it.
    await page.goto("/inbox?stream=secondary");
    await page.getByRole("button", { name: /^Approved & rejected/ }).click();
    const done = page.locator(".inbox-card", { has: page.locator(".code", { hasText: code }) });
    await done.getByRole("link", { name: "View in Tracker →" }).click();
    await expect(page).toHaveURL(/\/tracker\?.*from=2024-03-12/);
    await expect(page.getByRole("dialog").getByRole("heading", { name: title })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("table tbody td.title", { hasText: title })).toBeVisible();
  });

  test("Delete Tracker Entry from the record: gone from the Tracker, still in Phantoms", async ({ page }) => {
    await page.goto("/tracker");
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
    await expectAccessible(page, "/tracker delete choice");
    await confirm.getByLabel(/Reason/).fill("E2E tracker-only deletion");
    const code = (await confirm.locator("#del-title").innerText()).match(/SIG-\d+/)?.[0] as string;
    await confirm.getByRole("button", { name: "Delete Tracker Entry" }).click();
    await expect(page.locator(".toast")).toContainText(`Deleted ${code} from the Tracker · still in Phantoms`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("table tbody td.title", { hasText: title })).toHaveCount(0);
    await page.getByRole("navigation").getByRole("link", { name: "Phantoms" }).click();
    await page.getByRole("searchbox").fill(title);
    await expect(page.locator("table tbody td.title", { hasText: title })).toBeVisible();
  });

  test("selects Phantoms entries with tick boxes: Delete Phantom Entry, then Delete Globally", async ({ page }) => {
    await page.goto("/phantoms");
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
    const bar = page.getByRole("group", { name: "Selected entries" });
    // The header box selects the whole page, and again clears it.
    const all = page.getByRole("checkbox", { name: "Select every entry on this page" });
    await all.check();
    await expect(bar).toContainText(`${await rows.count()} selected`);
    await all.uncheck();
    await expect(bar).toHaveCount(0);

    // One entry from Phantoms only: it stays in the Tracker.
    const only = (await rows.nth(0).locator("td.title").innerText()).trim();
    await rows.nth(0).getByRole("checkbox").check();
    await expect(bar).toContainText("1 selected");
    await bar.getByRole("button", { name: "Delete selected" }).click();
    const one = page.getByRole("alertdialog", { name: /^Delete SIG-\d+\?$/ });
    await expect(one).toContainText("Delete Phantom Entry removes it from Phantoms only. It stays in the Tracker and on the Dashboard.");
    await one.getByRole("button", { name: "Delete Phantom Entry" }).click();
    await expect(page.locator(".toast")).toContainText(/Deleted SIG-\d+ from Phantoms · still in the Tracker/);
    await expect(page.locator("table tbody td.title", { hasText: only })).toHaveCount(0);

    // Two entries globally: gone from the Tracker too.
    const titles = [(await rows.nth(0).locator("td.title").innerText()).trim(), (await rows.nth(1).locator("td.title").innerText()).trim()];
    await rows.nth(0).getByRole("checkbox").check();
    await rows.nth(1).getByRole("checkbox").check();
    await expect(bar).toContainText("2 selected");
    await bar.getByRole("button", { name: "Delete selected" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete 2 entries?" });
    await expect(confirm.getByRole("button", { name: "Delete Phantom Entries" })).toBeVisible();
    await expect(confirm).toContainText(titles[0]!);
    await expectAccessible(page, "/phantoms delete confirmation");
    await confirm.getByLabel(/Reason/).fill("E2E bulk deletion");
    await confirm.getByRole("button", { name: "Delete Globally" }).click();
    await expect(page.locator(".toast")).toContainText("Deleted 2 entries globally");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    for (const t of titles) await expect(page.locator("table tbody td.title", { hasText: t })).toHaveCount(0);
    await page.getByRole("navigation").getByRole("link", { name: "Tracker" }).click();
    const search = page.getByRole("searchbox");
    await search.fill(titles[0]!);
    await expect(page.locator("table tbody td.title", { hasText: titles[0]! })).toHaveCount(0);
    // The Phantom-only deletion is still in the Tracker.
    await search.fill(only);
    await expect(page.locator("table tbody td.title", { hasText: only })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Columns · Secondary" })).toBeVisible();
    await expectAccessible(page, "/inbox secondary");
  });

  test("Phantoms: approved entries appear with their own columns and an MD icon that opens the Markdown file as a side pane", async ({ page }) => {
    const title = `Sanofi opens AI hub ${uid()}`;
    const file = htmlFile("phantom.html", `<!DOCTYPE html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Sanofi has opened an AI hub in Paris with 300 staff, the company said on Monday.</p><p>The hub opens in 2027.</p></article></body></html>`);
    await page.goto("/input");
    await uploadTo(page, "secondary", file);
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
    // Phantoms has its own columns (Secondary: Publisher, Header… but no Macrotrend).
    await expect(page.locator("table thead")).toContainText("Publisher");
    await expect(page.locator("table thead")).not.toContainText("Macrotrend");
    // The MD icon opens the Markdown file as a full side pane; Download is at the top right.
    await row.locator("td.md-col").getByRole("button", { name: `Open Markdown for ${title}: Paris` }).click();
    const panel = page.getByRole("dialog", { name: `${title}: Paris` });
    const md = panel.getByLabel("Markdown source");
    await expect(md).toContainText(`id: ${rid}`);
    const [paneBox, mdBox] = [(await panel.boundingBox())!, (await md.boundingBox())!];
    expect(mdBox.height).toBeGreaterThan(paneBox.height * 0.75);
    const dl = panel.getByRole("button", { name: "Download Markdown" });
    const dlBox = (await dl.boundingBox())!;
    expect(dlBox.y).toBeLessThan(paneBox.y + 80);
    expect(dlBox.x).toBeGreaterThan(paneBox.x + paneBox.width / 2);
    const [download] = await Promise.all([page.waitForEvent("download"), dl.click()]);
    expect(download.suggestedFilename()).toBe(`${rid}.md`);
    const text = readFileSync((await download.path())!, "utf8");
    expect(text.startsWith(`---\nid: ${rid}\ntitle: "${title}: Paris"\nevent_date: 2026-09-24\nsource_type: PR\nSource:\n  Publisher: Sanofi\n  URL: https://www.sanofi.com/ai-hub\n`)).toBe(true);
    expect(text).toContain("Source_tier: Reviewed-Secondary\nCompetitors: Sanofi\n");
    expect(text).toContain("QC:\n  Reviewed_by: L. Griffith\n");
    expect(text).toContain("## Key Details\n300 staff.\n\nOpens 2027.\n");
    // The pane shows it raw and rendered.
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

  test("Deliverables → Alerts: High Impact Phantoms of both streams, each with a .docx alert that opens as a side pane", async ({ page }) => {
    await page.goto("/deliverables");
    await expect(page.getByRole("navigation").getByRole("link", { name: "Deliverables" })).toHaveAttribute("aria-current", "page");
    // The central Alerts / Newsletter switch.
    const sw = page.getByRole("group", { name: "Deliverable" });
    const [swBox, content] = [(await sw.boundingBox())!, (await page.locator(".content").boundingBox())!];
    expect(Math.abs(swBox.x + swBox.width / 2 - (content.x + content.width / 2))).toBeLessThanOrEqual(4);
    await expect(page.getByTestId("deliv-alerts")).toHaveAttribute("aria-pressed", "true");
    // Only High Impact entries, with the Phantoms columns (and Alert, Markdown, Source).
    const heads = await page.locator("table thead th").allInnerTexts();
    expect(heads.slice(0, 4).map((h) => h.trim().toLowerCase())).toEqual(["alert", "markdown", "source", "id"]);
    const impacts = await page.evaluate(async () => {
      const h = { "x-dev-user": localStorage.getItem("eradigm.devUser") ?? "" };
      const get = async (s: string) => ((await (await fetch(`/api/deliverables/alerts?stream=${s}&from=2000-01-01&to=2100-01-01&pageSize=25`, { headers: h })).json()) as { rows: { values: { impact: string } }[] }).rows.map((r) => r.values.impact);
      return [...(await get("primary")), ...(await get("secondary"))];
    });
    expect(impacts.length).toBeGreaterThan(0);
    expect(new Set(impacts)).toEqual(new Set(["High"]));
    await expectAccessible(page, "/deliverables alerts");

    // The .docx: the Title in bold 32 pt, viewed in the pane and downloaded.
    const row = page.locator("table tbody tr").first();
    const title = (await row.locator("td.title").innerText()).trim();
    await row.getByRole("button", { name: `Open the alert for ${title}` }).click();
    const pane = page.getByRole("dialog", { name: title });
    const para = pane.locator(".docx-host section.docx p").first();
    await expect(para).toHaveText(title, { timeout: 15_000 });
    const style = await para.locator("span").first().evaluate((e) => ({ weight: getComputedStyle(e).fontWeight, size: getComputedStyle(e).fontSize }));
    expect(Number(style.weight)).toBeGreaterThanOrEqual(700);
    // 32 pt, as rendered in CSS pixels.
    expect(Math.round(parseFloat(style.size))).toBe(Math.round((32 * 96) / 72));
    const [download] = await Promise.all([page.waitForEvent("download"), pane.getByRole("button", { name: "Download .docx" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^[\w-]+-alert\.docx$/);
    const bytes = readFileSync((await download.path())!);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    await expectAccessible(page, "/deliverables alert pane");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The same row also opens its Markdown and saved page.
    await row.getByRole("button", { name: `Open Markdown for ${title}` }).click();
    await expect(page.getByRole("dialog").getByLabel("Markdown source")).toContainText(title);
    await page.keyboard.press("Escape");
    await page.getByTestId("stream-secondary").click();
    await expect(page.locator(".stream-note")).toContainText("Secondary Phantoms with High Impact");
  });

  test("Deliverables → Newsletter: tick High / Medium entries from both streams, name it and create the .docx", async ({ page }) => {
    await page.goto("/deliverables?d=newsletter");
    await expect(page.getByTestId("deliv-newsletter")).toHaveAttribute("aria-pressed", "true");
    const list = page.getByTestId("newsletters");
    const table = page.locator("section[aria-label='Approved signals table']");
    // The Newsletters table sits above the entries.
    expect((await list.boundingBox())!.y).toBeLessThan((await table.boundingBox())!.y);
    await expect(list.locator("thead th")).toHaveText([/Newsletter/i, /Name/i, /Phantoms used/i]);
    const before = await list.locator("tbody tr").count();
    const create = page.getByRole("button", { name: "Create Newsletter" });
    await expect(create).toBeDisabled();
    const rows = table.locator("tbody tr");
    const t1 = (await rows.nth(0).locator("td.title").innerText()).trim();
    await rows.nth(0).getByRole("checkbox").check();
    // Selection is kept across streams.
    await page.getByTestId("stream-secondary").click();
    await expect(page.locator(".stream-note")).toContainText("Secondary Phantoms with High or Medium Impact");
    const t2 = (await rows.nth(0).locator("td.title").innerText()).trim();
    await rows.nth(0).getByRole("checkbox").check();
    await expect(page.getByRole("group", { name: "Selected entries" })).toContainText("2 selected");
    await create.click();
    const dialog = page.getByRole("dialog", { name: "Create newsletter" });
    await expect(dialog).toContainText(t1);
    await expect(dialog).toContainText(t2);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Name the newsletter first");
    const name = `AI briefing ${uid()}`;
    await dialog.getByLabel("Newsletter name").fill(name);
    await expectAccessible(page, "/deliverables create newsletter");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".toast").last()).toContainText(`Created newsletter “${name}”`);
    await expect(page.getByRole("group", { name: "Selected entries" })).toContainText("0 selected");
    await expect(list.locator("tbody tr")).toHaveCount(before + 1);
    const nl = list.locator("tbody tr").first();
    await expect(nl).toContainText(name);
    await expect(nl.locator(".nl-items li")).toHaveCount(2);
    await expect(nl.locator(".nl-items")).toContainText(t1);
    await expect(nl.locator(".nl-items")).toContainText(t2);
    // It opens as a side pane showing the name, bold 32 pt, and downloads.
    await nl.getByRole("button", { name: `Open newsletter ${name}` }).click();
    const pane = page.getByRole("dialog", { name });
    await expect(pane.locator(".docx-host section.docx p").first()).toHaveText(name, { timeout: 15_000 });
    const [download] = await Promise.all([page.waitForEvent("download"), pane.getByRole("button", { name: "Download .docx" }).click()]);
    expect(download.suggestedFilename()).toBe(`${name.replace(/ /g, "-")}.docx`);
    await page.keyboard.press("Escape");
    await expectAccessible(page, "/deliverables newsletter");
  });

  test("Inbox and Input pass automated accessibility checks", async ({ page }) => {
    for (const p of ["/inbox", "/input"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, p);
    }
  });
});
