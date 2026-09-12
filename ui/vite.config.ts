import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    // In development the interface runs on Vite and the backend on 8000. Proxying /v1 here
    // reproduces exactly what nginx does in the container (ui/nginx.conf), so the
    // client uses the same relative paths in both, and CORS never enters the picture.
    proxy: {
      "/v1": {
        target: process.env["BACKEND_ORIGIN"] ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Playwright drives the built app from outside and owns e2e/. Vitest must not try to
    // collect those files as unit tests.
    exclude: ["e2e/**", "node_modules/**", "dist/**"],

    // **A timeout here is a deadlock detector, not a performance budget.** Every test in this
    // suite waits on an event rather than on a clock, so a slow machine should make them slower
    // and not red. The default five seconds started failing one Configure test during a full
    // `make check` -- the screen now mounts seven panels behind six requests, and typing into
    // one of them re-renders all of them, which is real work rather than a hang
    // (`known-issues.md` P13). Fifteen seconds still catches a test that will never finish.
    testTimeout: 15_000,

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",

      // 85% everywhere, and a higher bar on the three directories that carry behaviour.
      //
      // It is a floor on the code, not a ceiling on the testing. The target is full coverage
      // of features and functionality; this number only catches whole regions nobody
      // exercised. `thresholds` fails the run rather than printing a warning nobody reads.
      //
      // **The global bar rose from 75 to 85 on 2026-09-05, because 75 had stopped being a
      // check.** Both sides sit near 98%, so a three-quarters floor left roughly a fifth of
      // the suite deletable without the gate noticing.
      //
      // **The per-directory bars exist because a global one hides a bad neighbourhood.** One
      // under-tested directory disappears behind a codebase's worth of well-tested ones, and
      // gets less visible as the codebase grows. These are set below where each directory
      // actually sits -- `routes` is the tightest at 91.5% branches -- so a component can land
      // mid-build without blocking the gate on its way to being finished.
      //
      // **Deliberately not per-file.** Only one file here has under ten statements, but the
      // backend has eighteen of seventy-five, and a rule that is right on one side of the
      // repository and noise on the other is a rule nobody trusts. Per-directory says the
      // useful half of what per-file would say and none of the noisy half.
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
        statements: 85,

        "src/routes/**": { lines: 95, branches: 88, functions: 95, statements: 95 },
        "src/api/**": { lines: 95, branches: 88, functions: 95, statements: 95 },
        "src/shell/**": { lines: 95, branches: 88, functions: 95, statements: 95 },
      },

      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // **Test scaffolding is not product code.** `mocks/` is the msw server the unit tests
        // run against and `testing/` is the render helper; measuring them told us that 308 of
        // 1,287 lines were the tests testing themselves. Worse, it flattered the total:
        // `fixtures.ts` is 183 statements of test data scoring 100%, while `handlers.ts`
        // dragged branch coverage down for not exercising paths in a mock nobody should be
        // exercising. Excluding both moved the real number the right way -- product branch
        // coverage is 95.9%, not the 92.8% the mixed figure reported.
        "src/mocks/**",
        "src/testing/**",
        // Generated from docs/openapi.yaml. Testing generated types tests the generator.
        "src/api/schema.ts",
        "src/main.tsx",
        "src/test-setup.ts",
        // Starts the msw service worker, which exists only in a real browser. The Playwright
        // smoke spec is what proves it works; a jsdom test could only prove the import
        // resolves. The handlers it registers ARE covered -- every unit test runs against them.
        "src/mocks/browser.ts",
        "**/*.d.ts",
      ],
    },
  },
});
