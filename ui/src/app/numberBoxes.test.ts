// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

/**
 * Guard 1 of PL-024 (UF-026): **a box that takes a number is a NumberField.** The rule editor's
 * `type="number"` boxes report text they cannot parse as "", which the form read as "no bound";
 * the household and settings boxes filtered every keystroke. `eslint.config.js` refuses both
 * shapes everywhere but `shell/NumberField.tsx`; the last ledgered call site, the rule editor,
 * moved onto it in C02 U3, and the ledger went with it.
 */

const UI_ROOT = join(__dirname, "..", "..");
const FIELD = "src/shell/NumberField.tsx";
const MESSAGE = "A box that takes a number is a NumberField";

const eslint = new ESLint({ cwd: UI_ROOT });

async function ruleFor(path: string): Promise<Linter.RuleEntry | undefined> {
  const config = (await eslint.calculateConfigForFile(join(UI_ROOT, path))) as {
    rules?: Record<string, Linter.RuleEntry>;
  };
  return config.rules?.["no-restricted-syntax"];
}

async function numberBoxesIn(source: string, path: string): Promise<number> {
  const rule = await ruleFor(path);
  if (rule === undefined) return 0;
  const messages = new Linter({ configType: "flat" }).verify(
    source,
    [
      {
        files: ["**/*.tsx"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: { "no-restricted-syntax": rule },
      },
    ],
    join(UI_ROOT, path),
  );
  return messages.filter((message) => message.message.includes(MESSAGE)).length;
}

/**
 * Every component the product ships, as a path from the interface's root. `main.tsx` mounts the
 * app and draws nothing, and the product lint block leaves it out with the scaffolding.
 */
function productComponents(directory = "src"): string[] {
  return readdirSync(join(UI_ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return ["mocks", "testing"].includes(entry.name) ? [] : productComponents(path);
    const component = path.endsWith(".tsx") && !path.endsWith(".test.tsx") && path !== "src/main.tsx";
    return component ? [path] : [];
  });
}

const BOXES = `
  export const Boxes = () => (
    <>
      <input type="number" step="any" />
      <input inputMode="decimal" />
    </>
  );
`;

describe("a box that takes a number", () => {
  it.each([
    "src/routes/configure/household/NewPanel.tsx",
    "src/shell/NewShellPart.tsx",
    "src/app/NewWiring.tsx",
  ])("is refused in %s, written by hand", async (path) => {
    expect(await numberBoxesIn(BOXES, path)).toBe(2);
  });

  it("is the shared field's own business", async () => {
    const field = readFileSync(join(UI_ROOT, FIELD), "utf8");

    expect(await numberBoxesIn(BOXES, FIELD)).toBe(0);
    // The exemption is needed: the field itself sets the keypad.
    expect(await numberBoxesIn(field, "src/shell/NewShellPart.tsx")).toBeGreaterThan(0);
  });

  it("is exempt nowhere but the shared field, now that every screen draws it", async () => {
    const exempt: string[] = [];
    for (const path of productComponents()) {
      if (path !== FIELD && (await numberBoxesIn(BOXES, path)) !== 2) exempt.push(path);
    }

    expect(exempt).toEqual([]);
  });

  it("keeps the other bans on the shared field", async () => {
    const banned = JSON.stringify(await ruleFor(FIELD));

    expect(banned).toContain("JSXAttribute[name.name='style']");
    expect(banned).toContain("toFixed");
  });
});
