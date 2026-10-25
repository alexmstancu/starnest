import { defineConfig, devices } from "@playwright/test";

// End-to-end tests are owned by the master agent, not by the workstream that wrote the
// screen (devplan.md 0.2). They drive a real browser against the real backend and import
// nothing from src/ -- which is what makes them a test of the product rather than of the
// implementation.

/**
 * **A stack of its own, never yours** (UI-03). The suite writes -- a pillar weight, a gate's
 * enforcement and answer, the spend cap, a small acquisition -- and it used to attach to
 * whatever answered on the ports Docker publishes, which is the live database. `make e2e`
 * restores a throwaway copy of the newest backup, migrates it, and hands its address here; this
 * starts a backend and a Vite on it, on ports Docker does not publish, and never reuses a
 * server it did not start. Run any other way, it refuses rather than guess at a database.
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: run the browser suite with \`make e2e\`, which restores its own database`,
    );
  }
  return value;
}

const databaseUrl = required("E2E_DATABASE_URL");
const backendPort = required("E2E_BACKEND_PORT");
const uiPort = required("E2E_UI_PORT");

// **Only a database named for the suite.** The URL carries the password, so the refusal names
// the database and nothing else.
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_e2e")) {
  throw new Error(
    `refusing to run the browser suite against "${databaseName}": only a throwaway database whose name ends in _e2e, as \`make e2e\` makes one`,
  );
}

const backendOrigin = `http://127.0.0.1:${backendPort}`;

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
    baseURL: `http://localhost:${uiPort}`,
    // Times are shown on the reader's clock; a fixed zone that is not UTC keeps a spec from
    // passing only because the machine running it happens to sit in UTC (`vite.config.ts`).
    timezoneId: "Europe/Bucharest",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  // **A spec that writes what nothing can delete runs last** (PL-084): a typed figure has no
  // DELETE, so it goes in its own project after every other spec has read the copy as restored.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /hand-entry\.spec\.ts/,
    },
    {
      name: "writes-last",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /hand-entry\.spec\.ts/,
      dependencies: ["chromium"],
    },
  ],

  // The real backend, not a mock. A gate that passes against a mock proves the mock works.
  webServer: [
    {
      command:
        'cd ../backend && uv run python -c "from starnest.main import run; run()"',
      url: `${backendOrigin}/v1/settings`,
      // Never someone else's server: a busy port is refused, not borrowed.
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: databaseUrl,
        PORT: backendPort,
        // **The suite cannot spend.** With no key the paid path is off, so no spec can reach
        // a model by accident -- structural rather than true because no spec happens to.
        ANTHROPIC_API_KEY: "",
      },
    },
    {
      command: `npm run dev -- --port ${uiPort} --strictPort`,
      url: `http://localhost:${uiPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { BACKEND_ORIGIN: backendOrigin },
    },
  ],
});
