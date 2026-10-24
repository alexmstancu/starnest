import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The ranking rows' grounds, read from the stylesheet (PL-075, UF-119).
 *
 * **A state written as a bare modifier never shows.** `.table__row--open` is one class deep and
 * the row's base, `.table--ranking > tbody > tr`, is one class and two elements, so the base
 * wins whatever the order -- and the guard in `app/architecture.test.ts` compares `.x--y` with
 * `.x` only, so it could not see a base written under another name. Only a browser reading
 * computed styles shows the effect; this reads the cause.
 */
const ROW = ".table--ranking > tbody > tr";

interface Rule {
  selector: string;
  at: number;
  declarations: Map<string, string>;
}

function stylesheetRules(): Rule[] {
  const stylesheet = readFileSync(
    join(__dirname, "../../styles.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  // Leaf rules only: a body with no brace in it, so an `@media` wrapper is skipped and the
  // rules inside it are read.
  return [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match) => {
    const declarations = new Map(
      (match[2] ?? "")
        .split(";")
        .filter((line) => line.includes(":"))
        .map((line) => {
          const [property = "", ...value] = line.split(":");
          return [property.trim(), value.join(":").trim()] as const;
        }),
    );
    return (match[1] ?? "")
      .split(",")
      .map((selector) => selector.trim().replace(/\s+/g, " "))
      .map((selector) => ({ selector, at: match.index ?? 0, declarations }));
  });
}

describe("a ranking row's state", () => {
  it("is written with the row's own prefix, after the row's base", () => {
    const rules = stylesheetRules();
    const bases = rules.filter(
      (rule) => rule.selector === ROW && rule.declarations.has("background"),
    );
    expect(bases.length, `no rule gives ${ROW} a background`).toBeGreaterThan(0);
    const lastBase = Math.max(...bases.map((rule) => rule.at));

    const states = rules.filter(
      (rule) =>
        /\.table__row--[a-z-]+/.test(rule.selector) &&
        rule.declarations.has("background"),
    );
    expect(states.length).toBeGreaterThan(0);

    const misplaced = states
      .filter(
        (rule) => !rule.selector.startsWith(`${ROW}.`) || rule.at < lastBase,
      )
      .map((rule) => rule.selector);
    expect(misplaced).toEqual([]);
  });

  it("shows an open row's ground and a not-matching row's ground", () => {
    const grounds = new Map(
      stylesheetRules()
        .filter((rule) => rule.declarations.has("background"))
        .map((rule) => [rule.selector, rule.declarations.get("background")]),
    );

    expect(grounds.get(`${ROW}.table__row--open`)).toBe(
      "var(--colour-accent-surface)",
    );
    expect(grounds.get(`${ROW}.table__row--not-matching`)).toBe(
      "var(--colour-surface-raised)",
    );
    // The hover tint must not take the open row's ground back while the pointer is on it.
    expect(grounds.get(`${ROW}.table__row--open:hover`)).toBe(
      "var(--colour-accent-surface)",
    );
  });

  /**
   * PL-076. A saved ranking's rows open nothing, so the pointer and the hover tint that say a
   * row opens belong to the row that does, and to no other.
   */
  it("offers the pointer and the hover tint only on a row that opens", () => {
    const rowRules = stylesheetRules().filter((rule) =>
      rule.selector.startsWith(ROW),
    );

    const pointers = rowRules
      .filter((rule) => rule.declarations.get("cursor") === "pointer")
      .map((rule) => rule.selector);
    expect(pointers).toEqual([`${ROW}.table__row--toggle`]);

    const bareHover = rowRules
      .filter((rule) => rule.selector === `${ROW}:hover`)
      .map((rule) => rule.selector);
    expect(bareHover).toEqual([]);
    expect(
      rowRules.some(
        (rule) =>
          rule.selector === `${ROW}.table__row--toggle:hover` &&
          rule.declarations.has("background"),
      ),
    ).toBe(true);
  });
});
