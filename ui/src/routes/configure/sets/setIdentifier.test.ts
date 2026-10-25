import { describe, expect, it } from "vitest";
import { copyName, identifierFrom, nameRefusal, ownIdentifier, SET_NAME_LIMIT } from "./setIdentifier";

describe("the identifier derived from a name", () => {
  it("joins words with underscores, in lower case", () => {
    expect(identifierFrom("Local employment")).toBe("local_employment");
  });

  it("drops punctuation rather than carrying it into the catalog", () => {
    expect(identifierFrom("Alex + Teodora (default)")).toBe(
      "alex_teodora_default",
    );
  });

  /** The letter survives; only the mark is dropped. */
  it("strips accents without losing the letters under them", () => {
    expect(identifierFrom("Zürich only")).toBe("zurich_only");
  });

  it("leaves no separator at either end", () => {
    expect(identifierFrom("  spaced  ")).toBe("spaced");
    expect(identifierFrom("!!!")).toBe("");
  });

  it("keeps digits, which a year or a version needs", () => {
    expect(identifierFrom("Plan 2027")).toBe("plan_2027");
  });
});

describe("the name a copy takes", () => {
  it("adds 'copy' when nothing is in the way", () => {
    expect(copyName("Local employment", ["Local employment"])).toBe(
      "Local employment copy",
    );
  });

  it("counts up rather than reusing a name already taken", () => {
    expect(
      copyName("Plan", ["Plan", "Plan copy", "Plan copy 2"]),
    ).toBe("Plan copy 3");
  });

  it("skips only the names that are taken", () => {
    expect(copyName("Plan", ["Plan", "Plan copy"])).toBe("Plan copy 2");
  });
});

/** PL-039: an identifier this tab chooses is always one the catalog accepts, `^[a-z][a-z0-9_]*$`. */
describe("an identifier of the tab's own", () => {
  it.each([
    ["Ελλάδα", /^set_[a-z0-9]+$/],
    ["!!", /^set_[a-z0-9]+$/],
    ["2026 plan", /^set_2026_plan_[a-z0-9]+$/],
    ["Zürich", /^zurich_[a-z0-9]+$/],
  ])("starts %s with a letter", (name, shape) => {
    expect(ownIdentifier(name)).toMatch(shape);
  });
});

/** PL-036, PL-041: what a set may be called. */
describe("why a name cannot be a set's", () => {
  it("refuses a name another set has, ignoring case and surrounding spaces", () => {
    expect(nameRefusal("  remote ONLY ", ["Default", "Remote only"])).toBe(
      "Another criteria set is already called “Remote only”.",
    );
  });

  it("refuses a name longer than the limit, and takes one exactly at it", () => {
    expect(nameRefusal("x".repeat(SET_NAME_LIMIT + 1), [])).toMatch(/at most 60 characters/);
    expect(nameRefusal("x".repeat(SET_NAME_LIMIT), [])).toBeNull();
  });

  it("takes a name in any script", () => {
    expect(nameRefusal("Ελλάδα", ["Default"])).toBeNull();
  });
});

describe("a copy's name, against case and length", () => {
  it("skips a name taken in another case", () => {
    expect(copyName("Plan", ["plan COPY"])).toBe("Plan copy 2");
  });

  it("shortens a long name before the suffix, so the copy's name fits", () => {
    const copy = copyName("y".repeat(SET_NAME_LIMIT), []);

    expect(copy).toHaveLength(SET_NAME_LIMIT);
    expect(copy.endsWith(" copy")).toBe(true);
  });
});
