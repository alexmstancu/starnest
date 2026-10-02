import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import eslintConfig from "../../eslint.config.js";

/**
 * The interface's architecture, as something the suite fails on.
 *
 * The backend has this as four `import-linter` contracts plus a test that walks its import
 * graph (`backend/tests/unit/test_architecture.py`). These are the two halves that eslint
 * cannot check on its own:
 *
 * **Whether the layering is exhaustive.** A directory missing from the zones in
 * `eslint.config.js` is simply unconstrained, and nothing would say so. Compared here against
 * the directories that actually exist, so a new one fails until somebody decides where in the
 * order it belongs.
 *
 * **Whether the design is still a plugin.** Styling lives in `styles.css`, imported once by the
 * entry point, and the tests find things by role and label rather than by class -- which is what
 * makes the post-MVP redesign a change to one file and no test.
 */

const SOURCE = join(__dirname, "..");

/** Directories that are deliberately outside the layering, and why. */
const NOT_LAYERS = new Set([
  // Test scaffolding, kept out of product code by `no-restricted-imports` instead.
  "mocks",
  "testing",
]);

function directoriesUnderSource(): string[] {
  return readdirSync(SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !NOT_LAYERS.has(name));
}

function sourceFiles(directory: string = SOURCE): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every directory named in a `no-restricted-paths` zone, on either side of it. */
function layeredDirectories(): Set<string> {
  const named = new Set<string>();
  for (const block of eslintConfig as { rules?: Record<string, unknown> }[]) {
    const zones = block.rules?.["import-x/no-restricted-paths"];
    if (!Array.isArray(zones)) continue;
    const [, options] = zones as [
      string,
      { zones?: { target: string; from: string[] }[] },
    ];
    for (const zone of options.zones ?? []) {
      for (const path of [zone.target, ...zone.from]) {
        const directory = path.replace("./src/", "").replace("./src", "");
        if (directory) named.add(directory);
      }
    }
  }
  return named;
}

describe("the layering", () => {
  it("names every directory that exists under src", () => {
    const unconstrained = directoriesUnderSource().filter(
      (directory) => !layeredDirectories().has(directory),
    );

    expect(unconstrained).toEqual([]);
  });

  it("names nothing that has gone", () => {
    const existing = new Set(directoriesUnderSource());

    const stale = [...layeredDirectories()].filter(
      (directory) => !existing.has(directory),
    );

    expect(stale).toEqual([]);
  });
});

describe("the folder structure", () => {
  it("has no barrel files", () => {
    /**
     * An `index.ts` re-exporting a folder reads nicely and then hides which file a symbol came
     * from -- and it is the usual way an import cycle appears, because two barrels importing
     * each other is invisible at the call site. Every import here names the file it wants.
     */
    const barrels = sourceFiles()
      .filter((path) => /\/index\.tsx?$/.test(path))
      .map((path) => path.replace(`${SOURCE}/`, ""));

    expect(barrels).toEqual([]);
  });

  it("gives each screen a folder of its own", () => {
    /**
     * `routes/` is a list of the four tabs, and each screen keeps what only it uses --
     * `CandidateDetail` belongs to Rank, `useRunScreen` to Run. A file directly under
     * `routes/` would be a fifth thing that is not a screen.
     */
    const looseFiles = readdirSync(join(SOURCE, "routes"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);

    expect(looseFiles).toEqual([]);
  });
});

describe("the design is a plugin", () => {
  it("is imported by the entry point and by nothing else", () => {
    const importers = sourceFiles()
      .filter((path) =>
        /import ["'].*\.css["']/.test(readFileSync(path, "utf8")),
      )
      .map((path) => path.replace(`${SOURCE}/`, ""));

    expect(importers).toEqual(["main.tsx"]);
  });

  it("keeps styling out of the components", () => {
    const styled = sourceFiles()
      // This file names the pattern in order to look for it, so it matches itself.
      .filter((path) => !path.endsWith("architecture.test.ts"))
      .filter((path) => readFileSync(path, "utf8").includes("style={{"))
      .map((path) => path.replace(`${SOURCE}/`, ""));

    expect(styled).toEqual([]);
  });

  it("names no custom property it never declares", () => {
    /**
     * **An undeclared custom property fails in silence.** CSS drops the whole declaration and
     * the property falls back to its initial value, so `gap: var(--space-3)` becomes
     * `gap: normal` and `padding: var(--space-4)` becomes `padding: 0` -- a card with no
     * spacing at all, on a stylesheet that parses cleanly and reports nothing. It shipped
     * exactly once, in an appended block that invented a scale this sheet does not have.
     *
     * A comment may name a token in prose, which is why only declarations are read.
     */
    const stylesheet = readFileSync(join(SOURCE, "styles.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const declared = new Set(
      [...stylesheet.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(
        (match) => match[1],
      ),
    );
    const used = [
      ...new Set(
        [...stylesheet.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(
          (match) => match[1],
        ),
      ),
    ];

    expect(used.filter((token) => !declared.has(token))).toEqual([]);
  });

  it("declares no modifier its own base rule takes back", () => {
    /**
     * **CSS breaks a tie by source order, and a modifier is the same weight as its base.**
     * `.panel--household` and `.panel` are both one class deep, so a `background` on the
     * modifier written *above* the base is simply undone — the rule parses, the class is
     * applied, the markup is right, and the page ignores it.
     *
     * It shipped three times before anything noticed: the household card rendered white for
     * as long as it had existed, and the Compare matrix was vertically capped and held to its
     * container's width, both the opposite of what the design asks for. **No behavioural test
     * could catch any of them** — only a browser reading computed styles, or this.
     *
     * The rule: for `.x--y`, every `.x` rule must come first. Descendant and compound
     * selectors are left alone, since those carry their own specificity.
     *
     * **Rules inside an `@media` block are read too.** The selector regex wanted a selector at
     * column 0, so every rule nested in one was skipped -- including the whole dark-mode
     * block, where the same cancellation is exactly as easy to write and no easier to see.
     * Nesting is removed before matching rather than special-cased, because the hazard is
     * about source order within a cascade and that is what the flattened text preserves.
     */
    const stylesheet = readFileSync(join(SOURCE, "styles.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );

    // **Every rule that holds declarations, wherever it sits.** A pattern anchored at column
    // zero read only top-level rules, so everything inside an `@media` block was invisible to
    // this -- the dark-mode block above all. Matching a body with no brace in it picks out
    // leaf rules exactly, and skips the `@media` wrapper itself, whose body has braces.
    const rules = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
      (match) => ({
        selector: (match[1] ?? "").trim(),
        at: match.index ?? 0,
        properties: new Set(
          (match[2] ?? "")
            .split(";")
            .filter((line) => line.includes(":"))
            .map((line) => (line.split(":")[0] ?? "").trim()),
        ),
      }),
    );

    const bases = new Map<string, { at: number; properties: Set<string> }[]>();
    for (const rule of rules) {
      const base = /^\.([a-z0-9-]+)$/.exec(rule.selector);
      if (base === null) continue;
      const name = base[1] ?? "";
      bases.set(name, [...(bases.get(name) ?? []), rule]);
    }

    const cancelled: string[] = [];
    for (const rule of rules) {
      const modifier = /^\.([a-z0-9-]+)--[a-z0-9-]+$/.exec(rule.selector);
      if (modifier === null) continue;
      for (const base of bases.get(modifier[1] ?? "") ?? []) {
        if (base.at < rule.at) continue;
        const lost = [...rule.properties].filter((property) =>
          base.properties.has(property),
        );
        if (lost.length > 0) {
          cancelled.push(
            `${rule.selector} loses ${lost.join(", ")} to .${modifier[1] ?? ""}, which is declared after it`,
          );
        }
      }
    }

    expect(cancelled).toEqual([]);
  });

  it("uses no monospace, which the design forbids outright", () => {
    // "No monospace anywhere" is the design's own rule and was broken three times, most
    // recently by an identifier this application had no business rendering at all.
    //
    // **Comments are stripped first.** The sheet was read whole, so a comment explaining why
    // monospace is forbidden would have failed the test that forbids it -- which is the kind
    // of guard people delete rather than satisfy.
    const stylesheet = readFileSync(join(SOURCE, "styles.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );

    expect(stylesheet).not.toMatch(/monospace/i);
  });

  it("is not what the tests depend on", () => {
    /**
     * A test that found an element by class name would break on the redesign, which is the one
     * cost the plugin boundary exists to avoid. Roles, labels and text survive it; a class does
     * not. `closest("tr")` is a tag and stays legal -- table structure is semantics, not design.
     */
    const byClass = sourceFiles()
      .filter((path) => path.endsWith(".test.ts") || path.endsWith(".test.tsx"))
      // This file states the patterns in order to look for them, so it matches itself.
      .filter((path) => !path.endsWith("architecture.test.ts"))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return (
          // `querySelectorAll` as well as `querySelector`: the same reach by a different
          // name, and the pattern matched only one spelling of it.
          /querySelectorAll?\(["'`]\./.test(source) ||
          source.includes("getElementsByClassName") ||
          /closest\(["'`]\./.test(source)
        );
      })
      .map((path) => path.replace(`${SOURCE}/`, ""));

    expect(byClass).toEqual([]);
  });
});
