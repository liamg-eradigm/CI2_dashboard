import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the admin, analyst and client roles, including axe
 * accessibility checks. Starts a fresh, seeded local API worker and the
 * dashboard dev server (dev sign-in via the X-Dev-User header).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5183",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    { command: "bash scripts/e2e-setup.sh", url: "http://127.0.0.1:8797/api/health", timeout: 180_000, reuseExistingServer: false },
    {
      command: "npx vite --port 5183 --host 127.0.0.1 --strictPort",
      cwd: "apps/web",
      env: { API_ORIGIN: "http://127.0.0.1:8797" },
      url: "http://127.0.0.1:5183",
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
