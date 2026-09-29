import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page } from "@playwright/test";

export const USERS = {
  admin: "admin@example.com",
  analyst: "l.griffith@example.com",
  client: "client@example.com",
  otherTenant: "analyst@northwind.example.com",
} as const;

export async function signInAs(page: Page, who: keyof typeof USERS) {
  await page.addInitScript((u) => {
    localStorage.setItem("eradigm.devUser", u);
    localStorage.removeItem("eradigm.tenant");
  }, USERS[who]);
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
