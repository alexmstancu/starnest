import { defineConfig, devices } from "@playwright/test";

// End-to-end tests are owned by the master agent, not by the workstream that wrote the
// screen (devplan.md 0.2). They drive a real browser against the real backend and import
// nothing from src/ -- which is what makes them a test of the product rather than of the
// implementation.

export default defineConfig({
  testDir: "./e2e",
  // **One worker, in order.** These specs share one backend and one database, and several of
  // them write to it: gate C moves a pillar weight, minE2E moves one and asserts the ranking
  // moved with it, the sanity suite saves a setting and puts it back. Run concurrently, one
  // test's write lands inside another's before-and-after and the assertion fails about a
  // change that did happen. It passed for months because the suite was small enough for the
  // collision to be unlikely -- which is luck, not correctness, and a suite that fails one run
  // in five teaches people to re-run it rather than read it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],

  use: {
    // `localhost` rather than `127.0.0.1`: Vite binds the name, which resolves to ::1 first,
    // so the numeric form reaches nothing.
    baseURL: process.env["UI_ORIGIN"] ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // The real backend, not a mock. A gate that passes against a mock proves the mock works.
  //
  // This was `npm run dev:mock` until the backend answered, and the change to `npm run dev` is
  // the one-word change that comment promised. Both servers are started here so `make e2e` is
  // one command: the database must already be up (`make up`) and migrated, because a test
  // suite that migrates is a test suite that can destroy data.
  webServer: process.env["UI_ORIGIN"]
    ? undefined
    : [
        {
          command:
            'cd ../backend && uv run python -c "from starnest.main import run; run()"',
          url: "http://127.0.0.1:8000/v1/settings",
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          command: "npm run dev",
          url: "http://localhost:5173",
          reuseExistingServer: true,
          timeout: 60_000,
        },
      ],
});
