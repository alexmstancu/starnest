import { describe, expect, it } from "vitest";
import { copyName, identifierFrom } from "./setIdentifier";

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
