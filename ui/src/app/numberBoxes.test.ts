// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import eslintConfig from "../../eslint.config.js";

/**
 * Guard 1 of PL-024 (UF-026): **a box that takes a number is a NumberField.** The rule editor's
 * `type="number"` boxes report text they cannot parse as "", which the form read as "no bound";
 * the household and settings boxes filtered every keystroke. `eslint.config.js` refuses both
 * shapes everywhere but `shell/NumberField.tsx` and a ledger of today's call sites.
 *
 * eslint runs the rule; this holds the ledger to the code. A listed file that no longer draws a
 * number box of its own is stale, and fails.
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

function ledger(): string[] {
  const block = (eslintConfig as { name?: string; files?: string[] }[]).find(
    (each) => each.name === "number boxes: today's call sites, ledgered",
  );
  return block?.files ?? [];
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

  it("is ledgered only where a screen still draws one of its own", async () => {
    expect(ledger()).not.toEqual([]);

    for (const path of ledger()) {
      const source = readFileSync(join(UI_ROOT, path), "utf8");
      expect.soft(await numberBoxesIn(source, path), `${path} is exempt`).toBe(0);
      expect
        .soft(await numberBoxesIn(source, "src/routes/Unlisted.tsx"), `${path} is stale`)
        .toBeGreaterThan(0);
    }
  });

  it("keeps the other bans on a ledgered file", async () => {
    const [path] = ledger();
    const banned = JSON.stringify(await ruleFor(path ?? ""));

    expect(banned).toContain("JSXAttribute[name.name='style']");
    expect(banned).toContain("toFixed");
  });
});
