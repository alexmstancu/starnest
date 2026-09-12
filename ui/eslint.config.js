import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The interface's lint rules.
 *
 * `package.json` has called `eslint .` since the project began, with no config file and no
 * plugins installed, so the script failed on every invocation and `make check` never called it
 * -- half the codebase was unlinted and nothing said so (`known-issues.md` D23).
 *
 * **Type-aware rules are on.** They cost a `tsc` pass per run, which is the price of catching
 * the faults that matter in a client whose whole job is to render what a typed contract
 * returned: a promise nobody awaited, a `catch` that widens an error to `any`, a nullable field
 * from `schema.ts` read as though it were always there.
 */
export default tseslint.config(
  { ignores: ["dist", "coverage", "playwright-report", "test-results", "src/api/schema.ts"] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  // Carries the plugin and its TypeScript resolver, which is what lets `no-cycle` follow an
  // import through a path alias and a `.tsx` extension rather than giving up on it.
  importX.flatConfigs.typescript,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // **No import cycles.** TypeScript compiles them happily and the bundler resolves them
      // at runtime, usually -- until a module reads a binding that is still `undefined` because
      // the other half of the cycle has not finished evaluating. The failure surfaces as a
      // blank screen far from its cause. The backend has the same rule as a test over its
      // import graph (`tests/unit/test_architecture.py`); this is that check for the client.
      //
      // It also keeps the interface's own layering honest: `shell/` and `routes/` read `api/`,
      // and `api/` has no business reading either of them.
      "import-x/no-cycle": ["error", { maxDepth: Infinity }],
      "import-x/no-self-import": "error",

      // The stale-draft defect fixed in cbef101 was exactly this rule's quarry: an effect that
      // read a value it had not declared. An error, not a warning.
      "react-hooks/exhaustive-deps": "error",

      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // `tsconfig.json` sets `noPropertyAccessFromIndexSignature`, so a lookup into a free-form
      // bag -- `process.env`, an `Error.details` the contract types as an open object -- must be
      // written with brackets. This rule would demand the opposite; the compiler wins, and the
      // bracket is worth having: it marks the reads that can come back undefined.
      "@typescript-eslint/dot-notation": "off",

      // Reported, not enforced. Five call sites set state from an effect to follow something
      // that arrived asynchronously -- a default selection once the list loads, an input
      // following the weight the server rebalanced to. Each has a derived-state formulation
      // and none is a bug today, so this stays visible without failing the gate
      // (`known-issues.md` D24).
      "react-hooks/set-state-in-effect": "warn",

      // An unawaited promise in a client that fetches is a request whose failure nobody sees.
      "@typescript-eslint/no-floating-promises": "error",

      // Errors cross the boundary as `unknown` by design (`errorPresentation.ts`): the code is
      // what gets branched on, and narrowing has to be explicit.
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",

      // `_` prefixed arguments are the destructuring idiom for "deliberately unused".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  {
    // Tests reach for the DOM and for msw's loosely typed request bodies, where insisting on
    // full type narrowing buys nothing: the assertion is the check.
    files: ["**/*.test.{ts,tsx}", "src/testing/**", "src/mocks/**", "e2e/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      // `() => {}` is how a test says "this callback is deliberately inert".
      "@typescript-eslint/no-empty-function": "off",
      // An `async` test helper that does not await yet keeps its signature stable for the
      // caller, which is what the awaiting ones need.
      "@typescript-eslint/require-await": "off",
    },
  },

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  {
    // This file and any other plain JS sit outside every tsconfig project, so the type-aware
    // rules have no type information to work from and error rather than lint.
    files: ["**/*.js"],
    languageOptions: { globals: globals.node },
    ...tseslint.configs.disableTypeChecked,
  },
);
