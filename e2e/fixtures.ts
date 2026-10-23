import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page } from "@playwright/test";

export const USERS = {
  admin: "admin@example.com",
  analyst: "l.griffith@example.com",
  client: "client@example.com",
  otherTenant: "analyst@northwind.example.com",
} as const;

/** Request 70: New Entry's sections, opened for the tests written before they were bars (the request 70 tests close them). */
export const NEW_ENTRY_FOLDS = ["import", "trend-analysis", "earnings-call", "capture-log"];

export async function signInAs(page: Page, who: keyof typeof USERS) {
  await page.addInitScript(
    ([u, folds]) => {
      localStorage.setItem("eradigm.devUser", u as string);
      localStorage.removeItem("eradigm.tenant");
      localStorage.setItem("eradigm.newEntry.open", JSON.stringify(folds));
    },
    [USERS[who], NEW_ENTRY_FOLDS] as const,
  );
  // External fonts are not needed for tests.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
}

/** Fails on serious or critical WCAG 2.1 A/AA violations. */
export async function expectAccessible(page: Page, label: string) {
  // The only iframes are sandboxed, script-less source snapshots (third-party
  // page content, not our UI); axe cannot run inside them, so skip frames.
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).options({ iframes: false }).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = bad.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `Accessibility violations on ${label}`).toEqual([]);
}

/** Pick a value in a searchable dropdown (components/Combobox.tsx): open, type to search, click the option. */
export async function choose(combo: Locator, value: string) {
  await combo.click();
  await combo.fill(value);
  await combo.page().getByRole("listbox").getByRole("option", { name: value, exact: true }).click();
  await expect(combo).toHaveValue(value);
}

/** Pick several values in a searchable multi-select dropdown, then close it. */
export async function chooseMany(combo: Locator, values: string[]) {
  await combo.click();
  for (const v of values) {
    await combo.fill(v);
    await combo.page().getByRole("listbox").getByRole("option", { name: v, exact: true }).click();
  }
  await combo.press("Escape");
  await expect(combo).toHaveValue(values.join(", "));
}

export const test = base;
export { expect };

/** The main menu. */
export const navOf = (page: Page) => page.getByRole("navigation", { name: "COMPETITIVE INTELLIGENCE" });

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A tab in the menu, by name (request 70: every tab is its own; its count may follow its name). */
export const navLink = (page: Page, item: string) => navOf(page).getByRole("link", { name: new RegExp(`^${escape(item)}(\\s+\\d+ .*)?$`) });

/** Open a tab from the menu. */
export async function goTab(page: Page, item: string) {
  await navLink(page, item).click();
}

/** The whole menu as a person sees it: "Group: Tab, Tab" per group (every group opened). */
export async function menuOf(page: Page): Promise<string[]> {
  const nav = navOf(page);
  await expect(nav.locator(".nav-group").first()).toBeVisible();
  const out: string[] = [];
  for (const g of await nav.locator(".nav-group").all()) {
    // A tab of its own (Database, request 43): just its name.
    if (await g.locator(".nav-solo").count()) {
      out.push((await g.locator(".nav-solo").innerText()).replace(/\s*\d+$/, "").trim());
      continue;
    }
    const btn = g.locator(".nav-parent");
    if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
    const name = (await btn.locator("span").first().innerText()).trim();
    const tabs = (await g.locator(".nav-sub a").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
    out.push(`${name}: ${tabs.join(", ")}`);
  }
  return out;
}

/** Search the Database page (request 48: its filters start hidden, so open them first). */
export async function searchDatabase(page: Page, text: string) {
  const toggle = page.getByTestId("filters-toggle");
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByRole("searchbox", { name: "Search contains" }).fill(text);
}

/** Database → Primary Tracker (request 56): a row opens its card; from it, the entry's full record. */
export async function openPrimaryRecord(page: Page, title: string) {
  const md = page.getByRole("button", { name: `Open Markdown for ${title}` });
  await md.locator("xpath=ancestor::tr").locator("td.date").click();
  await page.getByRole("button", { name: "Open the full record →" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Close record" })).toBeVisible();
}
