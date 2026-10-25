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

/**
 * Each brace the sheet leaves unbalanced, by line: a block opened and never closed, or a `}`
 * that closes nothing. Comments and quoted strings are blanked first, keeping their newlines,
 * so a brace inside either counts for nothing and the lines still match the file's.
 */
function unclosedBlocksIn(sheet: string): string[] {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  const code = sheet
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, blank);
  const problems: string[] = [];
  const opened: number[] = [];
  let line = 1;
  for (const character of code) {
    if (character === "\n") line += 1;
    else if (character === "{") opened.push(line);
    else if (character === "}" && opened.pop() === undefined) {
      problems.push(`line ${line}: a } that closes nothing`);
    }
  }
  return [...problems, ...opened.map((at) => `line ${at}: a block never closed`)];
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
  it("parses: every block the sheet opens, it closes", () => {
    /**
     * **Two appends to the end of the sheet can merge into one that does not parse, with no
     * conflict.** Git took a final `}` as context both sides shared, so one lane's rules landed
     * inside the other's last block and its closing brace was lost. Vite then refused the whole
     * sheet and every browser test failed, while every unit test passed: jsdom never parses it.
     */
    const stylesheet = readFileSync(join(SOURCE, "styles.css"), "utf8");
    expect(unclosedBlocksIn(stylesheet)).toEqual([]);
  });

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

  it("styles every run-progress meter segment the markup can emit", () => {
    /**
     * **A modifier class used in markup with no matching rule is invisible until a browser
     * renders it.** `RunScreen.tsx` builds `meter__fill--${segment.kind}` from the kinds
     * `runProgress.ts` declares, and the SVG `<rect>` falls back to a default *black* fill for
     * any kind the sheet does not style -- which shipped: the Acquire summary bar rendered solid
     * black while the per-source bars beside it were teal. The confidence meters never exercise
     * these kinds, and neither the undeclared-token nor the modifier-order guard reads markup.
     *
     * Same shape as the guards above: the union in `runProgress.ts` and the rules in
     * `styles.css` are two artifacts that must agree, so compare them.
     */
    const progress = readFileSync(join(SOURCE, "routes/run/runProgress.ts"), "utf8");
    const union = /kind:\s*("[a-z]+"(?:\s*\|\s*"[a-z]+")*)/.exec(progress)?.[1] ?? "";
    const kinds = [...union.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
    expect(kinds).not.toEqual([]);

    const stylesheet = readFileSync(join(SOURCE, "styles.css"), "utf8");
    const styled = new Set(
      [...stylesheet.matchAll(/\.meter__fill--([a-z]+)\s*\{/g)].map((match) => match[1]),
    );

    expect(kinds.filter((kind) => !styled.has(kind))).toEqual([]);
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

/** Product source as text with its comments removed, so prose about a pattern never matches it. */
function productSource(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function productFiles(): string[] {
  return sourceFiles().filter(
    (path) =>
      !/\.test\.tsx?$/.test(path) &&
      !path.includes(`${SOURCE}/mocks/`) &&
      !path.includes(`${SOURCE}/testing/`) &&
      !path.endsWith("api/schema.ts"),
  );
}

/** Each ledger entry must still be needed: a listed file that no longer matches is stale. */
function againstLedger(found: string[], ledger: Record<string, string>) {
  return {
    unlisted: found.filter((path) => !(path in ledger)),
    stale: Object.keys(ledger).filter((path) => !found.includes(path)),
  };
}

describe("a link claims to be the current page only in the tab bar", () => {
  /**
   * PL-021. `NavLink` marks itself `aria-current="page"` by matching the path alone, so a
   * sidebar row, a remedy or a saved ranking used it and claimed to be where the reader already
   * was. The tabs are the one place that claim is the point; everything else is a `Link`.
   */
  it("imports NavLink in shell/TabBar.tsx and nowhere else", () => {
    const importing = productFiles()
      .filter((path) =>
        /import\s*(type\s*)?\{[^}]*\bNavLink\b[^}]*\}\s*from\s*["']react-router(-dom)?["']/.test(
          productSource(path),
        ),
      )
      .map((path) => path.replace(`${SOURCE}/`, ""));

    expect(importing).toEqual(["shell/TabBar.tsx"]);
  });
});

describe("typed text becomes a number in one place", () => {
  /**
   * PL-024 (UF-026). Four modules called `Number()` on typed text, each with rules of its own,
   * and one of them read "72,000" as 72 and said "Saved.". `format/typedNumber.ts` is the one
   * parser now; a screen that turns text into a number elsewhere is listed here with the reason
   * or the cluster that moves it, and an entry that is no longer needed fails.
   */
  const LEDGER: Record<string, string> = {
    "routes/configure/weights.ts": "permanent: a range slider's value is always a number in range",
    "routes/run/acquisitionDiff.ts": "permanent: a select's value, never typed",
  };

  it("happens nowhere else in a screen, unless the ledger says why", () => {
    const parsing = productFiles()
      .filter((path) => /\/(routes|shell)\//.test(path))
      .filter((path) =>
        /\b(Number|parseFloat|parseInt)\s*\(|Number\.(parseFloat|parseInt)\s*\(/.test(
          productSource(path),
        ),
      )
      .map((path) => path.replace(`${SOURCE}/`, ""));

    expect(againstLedger(parsing, LEDGER)).toEqual({ unlisted: [], stale: [] });
  });
});

describe("every class the markup uses is styled", () => {
  /**
   * PL-027 (UF-037). A class with no rule is invisible until a browser renders it: the rule
   * editor and the "Accept an uncapped spend" checkbox shipped with no layout at all. This
   * generalises the meter test above to every class a component can emit.
   *
   * A class counts as styled when a selector names it, or names one of its `--` modifiers. A
   * class built from a template (`chip--${tone}`) needs a selector with that prefix. Anything
   * else is listed with the cluster that owns it, and an entry that is styled or gone fails.
   */
  const LEDGER: Record<string, string> = {
    notice__message: "C01",
    "screen--configure": "C01",
    fieldset: "C01",
    "matrix__cell--focus": "C07",
    "lock-icon": "C08 (PL-109): sized by its attributes, a hook with no rule yet",
    "pillar-card__fill": "C05 (PL-062): a hook; its colour is the rect's fill attribute, a datum",
  };

  const STRING = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
  const strings = (text: string) =>
    [...text.matchAll(STRING)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");

  /** Every string inside a `className={...}` expression, its braces balanced. */
  function classNameExpressions(text: string): string[] {
    return [...text.matchAll(/className=\{/g)].flatMap((match) => {
      const start = (match.index ?? 0) + "className={".length;
      let depth = 1;
      let end = start;
      while (depth > 0 && end < text.length) {
        if (text[end] === "{") depth++;
        if (text[end] === "}") depth--;
        end++;
      }
      return strings(text.slice(start, end - 1));
    });
  }

  /** What a component can put in a class attribute, as written in its source. */
  function classesIn(text: string): string[] {
    const direct = [...text.matchAll(/className="([^"]*)"/g)].map((match) => match[1] ?? "");
    // A class kept in a variable or a map (`CHIP_CLASS`, `rowClass`) is found by its BEM shape.
    const named = strings(text).filter((each) =>
      /^[a-z][a-z0-9-]*(__|--)[a-z0-9_${}.-]*( [a-z0-9_${}.-]+)*$/.test(each.trim()),
    );
    return [...direct, ...classNameExpressions(text), ...named]
      .flatMap((each) => each.split(/\s+/))
      .filter((token) => /^[a-z][a-z0-9_-]*(\$\{.*)?$/.test(token));
  }

  function unstyledClasses(): string[] {
    const stylesheet = readFileSync(join(SOURCE, "styles.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const selectors = [...stylesheet.matchAll(/([^{}]+)\{/g)].map((match) => match[1]).join(" ");
    const styled = [...new Set([...selectors.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((m) => m[1] ?? ""))];
    const isStyled = (token: string) => {
      const template = token.indexOf("${");
      if (template === 0) return true;
      if (template > 0) {
        const prefix = token.slice(0, template);
        return styled.some((name) => name.startsWith(prefix) && name.length > prefix.length);
      }
      return styled.some((name) => name === token || name.startsWith(`${token}--`));
    };

    const unstyled = productFiles()
      .filter((path) => /\.tsx?$/.test(path))
      .flatMap((path) => classesIn(productSource(path)))
      .filter((token) => !isStyled(token));
    return [...new Set(unstyled)].sort();
  }

  it("has a rule in the stylesheet, unless the ledger names its owner", () => {
    expect(againstLedger(unstyledClasses(), LEDGER)).toEqual({ unlisted: [], stale: [] });
  });
});

describe("a checkbox is drawn with its words in one place", () => {
  /**
   * T27-4 (PL-027). `label.field` is a column flex that fills the card, so a checkbox inside it
   * was ticked by a click anywhere across the card. `shell/CheckboxField.tsx` is the one label
   * that wraps a box and its words, and every screen draws its checkboxes with it.
   */
  const LEDGER: Record<string, string> = {};

  /**
   * Whether the source has a checkbox inside a `<label>` whose classes include `field`, however
   * the class is written. A tag is read with its braces balanced, since `=>` holds a `>`.
   */
  function wrapsACheckboxInAFieldLabel(text: string): boolean {
    return [...text.matchAll(/<label\b/g)].some((match) => {
      let depth = 0;
      let end = match.index ?? 0;
      while (end < text.length && !(text[end] === ">" && depth === 0)) {
        if (text[end] === "{") depth++;
        if (text[end] === "}") depth--;
        end++;
      }
      const tag = text.slice(match.index, end);
      const classes = /className=(?:"([^"]*)"|'([^']*)'|\{([^}]*(?:\{[^}]*\}[^}]*)*)\})/.exec(tag);
      const tokens = (classes?.[1] ?? classes?.[2] ?? classes?.[3] ?? "").split(/[\s"'`{}$]+/);
      const body = text.slice(end, text.indexOf("</label>", end));
      return tokens.includes("field") && /type=\{?["'`]checkbox["'`]/.test(body);
    });
  }

  it.each([
    ['<label className="field"><input type="checkbox" />Words</label>', true],
    ['<label className="field field--inline wide" htmlFor="x">\n  <input id="x" type="checkbox" />\n</label>', true],
    ["<label htmlFor={id} className={`field ${open ? \"field--open\" : \"\"}`}><input type='checkbox' /></label>", true],
    ['<label className="field" onClick={() => go()}><input type={"checkbox"} /></label>', true],
    ["<label className='field field__label'><input type=\"checkbox\" /></label>", true],
    ['<label className={"field field--inline"}><input type="checkbox" /></label>', true],
    ["<label className={'field'}><input type=\"checkbox\" /></label>", true],
    ['<label className={`field wide`}><input type="checkbox" /></label>', true],
    ['<label className="toggle"><input type="checkbox" />Germany</label>', false],
    ['<label className="field"><input type="text" /></label><input type="checkbox" />', false],
    ['<label className="field-grid"><input type="checkbox" /></label>', false],
  ])("finds a checkbox in a hand-made field label: %s", (source, found) => {
    expect(wrapsACheckboxInAFieldLabel(source)).toBe(found);
  });

  it("is CheckboxField, unless the ledger names who moves it", () => {
    const writingTheirOwn = productFiles()
      .filter((path) => !path.endsWith("shell/CheckboxField.tsx"))
      .filter((path) => wrapsACheckboxInAFieldLabel(productSource(path)))
      .map((path) => path.replace(`${SOURCE}/`, ""));

    expect(againstLedger(writingTheirOwn, LEDGER)).toEqual({ unlisted: [], stale: [] });
  });
});

describe("the reverse proxy", () => {
  it("gives synchronous gate research a longer read timeout than a polled run", () => {
    /**
     * Gate research returns its result in the response rather than being started and polled, so
     * the 60s read timeout that suits a POST-then-poll acquisition run would turn one slow LLM
     * call -- a request is one gate's question since UI-01 -- into a 504 that hides the proposal,
     * its cost and any cap halt. The browser suite runs against Vite's dev proxy, never
     * nginx, so this is the only place the production proxy path is checked at all -- a text
     * guard, since the timeout itself cannot be exercised here.
     */
    const conf = readFileSync(join(SOURCE, "..", "nginx.conf"), "utf8");
    const researchBlock = conf.slice(conf.indexOf("location = /v1/match-rule-research"));

    expect(researchBlock).not.toBe("");
    const research = /proxy_read_timeout\s+(\d+)s/.exec(researchBlock);
    expect(research).not.toBeNull();
    expect(Number(research?.[1])).toBeGreaterThan(60);
  });
});

/**
 * UI-03. **The browser suite runs on a stack of its own, never yours.** It writes -- weights,
 * gates, settings, a small acquisition -- and it used to attach to whatever answered on the
 * ports Docker publishes, which is the live database. `make e2e` now restores a throwaway copy
 * and the config starts a backend and a Vite on it. These guard the config and the specs as
 * text, as the proxy guard above does, because no unit test can start Playwright.
 *
 * **The Makefile's half is proved by running make**, in
 * `backend/tests/unit/test_make_isolation.py`. Matching its recipes as text stayed green while
 * a command-line URL migrated the live database and `make -n` ran the suite (UIC-A1, INF-M1).
 */
describe("the browser suite's own stack", () => {
  const UI_ROOT = join(SOURCE, "..");
  const config = readFileSync(join(UI_ROOT, "playwright.config.ts"), "utf8");
  const specs = readdirSync(join(UI_ROOT, "e2e"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({
      name,
      text: readFileSync(join(UI_ROOT, "e2e", name), "utf8"),
    }));
  const everyFile = [{ name: "playwright.config.ts", text: config }, ...specs];

  /**
   * Each server the config starts, as the text of its own entry -- so a guard asks what *that*
   * server is started with, not whether a keyword appears somewhere in the file. A keyword
   * check stayed green with the backend's database line deleted, which sends it back to the
   * live `DATABASE_URL` in `.env`.
   */
  const servers = config
    .slice(config.indexOf("webServer:"))
    .split(/(?=\{\s*command:)/)
    .slice(1);
  const backend = servers.find((server) => server.includes("starnest.main")) ?? "";
  const vite = servers.find((server) => server.includes("npm run dev")) ?? "";

  it("starts exactly two servers, a backend and a Vite", () => {
    expect(servers).toHaveLength(2);
    expect(backend).not.toBe("");
    expect(vite).not.toBe("");
  });

  it("never attaches to a server it did not start, whichever server it is", () => {
    for (const server of servers) {
      expect(server).toMatch(/reuseExistingServer:\s*false\s*,/);
    }
  });

  it("names neither port the Docker stack publishes", () => {
    const naming = everyFile
      .filter(({ text }) => /\b(8000|5173)\b/.test(text))
      .map(({ name }) => name);
    expect(naming).toEqual([]);
  });

  it("starts its backend on the throwaway database make e2e restored", () => {
    expect(config).toMatch(/const databaseUrl = required\("E2E_DATABASE_URL"\);/);
    expect(config).toMatch(
      /const databaseName = new URL\(databaseUrl\)[\s\S]*?if \(!databaseName\.endsWith\("_e2e"\)\) \{\s*throw/,
    );
    expect(backend).toMatch(/DATABASE_URL:\s*databaseUrl,/);
  });

  it("starts its backend with no AI key, so the suite cannot spend", () => {
    expect(backend).toMatch(/ANTHROPIC_API_KEY:\s*"",/);
  });

  it("points its Vite at its own backend, on a port it will not share", () => {
    expect(vite).toMatch(/BACKEND_ORIGIN:\s*backendOrigin\b/);
    expect(vite).toMatch(/--strictPort/);
  });

  it("lets no spec choose its own origin", () => {
    const choosing = everyFile
      .filter(({ text }) => text.includes("UI_ORIGIN"))
      .map(({ name }) => name);
    expect(choosing).toEqual([]);
  });
});
