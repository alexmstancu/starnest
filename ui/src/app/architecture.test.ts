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
          /querySelector\(["'`]\./.test(source) ||
          source.includes("getElementsByClassName") ||
          /closest\(["'`]\./.test(source)
        );
      })
      .map((path) => path.replace(`${SOURCE}/`, ""));

    expect(byClass).toEqual([]);
  });
});
