import { defineConfig, devices } from "@playwright/test";

// End-to-end tests are owned by the master agent, not by the workstream that wrote the
// screen (devplan.md 0.2). They drive a real browser against the real backend and import
// nothing from src/ -- which is what makes them a test of the product rather than of the
// implementation.

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],

  use: {
    baseURL: process.env.UI_ORIGIN ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Gate A onwards run against the real backend, not a mock. A gate that passes against a
  // mock proves the mock works.
  webServer: process.env.UI_ORIGIN
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
