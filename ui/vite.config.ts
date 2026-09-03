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

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",

      // The same bar as the backend: 75% lines and branches for the MVP.
      //
      // It is a floor on the code, not a ceiling on the testing. The target is full coverage
      // of features and functionality; this number only catches whole regions nobody
      // exercised. `thresholds` fails the run rather than printing a warning nobody reads.
      thresholds: {
        lines: 75,
        branches: 75,
        functions: 75,
        statements: 75,
      },

      include: ["src/**/*.{ts,tsx}"],
      exclude: [
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
