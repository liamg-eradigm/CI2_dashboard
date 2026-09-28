import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

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
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = bad.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `Accessibility violations on ${label}`).toEqual([]);
}

export const test = base;
export { expect };
