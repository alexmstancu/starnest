import { describe, expect, it } from "vitest";
import type { DrillRow } from "./drillRows";
import { pillarCompleteness } from "./pillarCompleteness";

/** The catalog's names, which are not the ids title-cased: `economics` is called "Economy". */
const names = new Map([
  ["economics", "Economy"],
  ["safety", "Safety"],
]);

function inUse(attribute: string, scored = true): DrillRow {
  return {
    kind: "figure",
    attribute,
    scored,
    // Only the row's kind and attribute are counted; the figure itself is not read.
    repeated: { value: {} as never, copies: 1, firstRetrieved: null },
  };
}

function gap(attribute: string): DrillRow {
  return { kind: "missing", attribute, scored: true, why: "nothing_stored" };
}

describe("how complete the rows below are", () => {
  it("counts the scored attributes with no value in use", () => {
    const complete = pillarCompleteness(
      [inUse("a"), gap("b"), gap("c")],
      "economics",
      names,
    );

    expect(complete).toEqual({
      missing: 2,
      counted: 3,
      sentence: "2 of the 3 attributes in Economy have no value in use.",
    });
  });

  it("agrees with the verb when exactly one attribute is missing", () => {
    expect(
      pillarCompleteness([inUse("a"), inUse("b"), gap("c")], "economics", names)
        ?.sentence,
    ).toBe("1 of the 3 attributes in Economy has no value in use.");
  });

  it("says so plainly when every attribute has one", () => {
    const complete = pillarCompleteness([inUse("a")], "safety", names);

    expect(complete?.missing).toBe(0);
    expect(complete?.sentence).toBe("Every attribute in Safety has a value in use.");
  });

  /** "1 of the 1 attributes" reads as though part of the pillar survived. None of it did. */
  it("says nothing is in use rather than counting all of it as a fraction", () => {
    expect(pillarCompleteness([gap("a")], "safety", names)?.sentence).toBe(
      "Nothing in Safety has a value in use.",
    );
  });

  it("speaks of the whole set when no pillar is chosen", () => {
    expect(pillarCompleteness([inUse("a"), gap("b")], null, names)?.sentence).toBe(
      "1 of the 2 attributes this set scores has no value in use.",
    );
  });

  /**
   * A gap row sits above the rejected or switched-off figures it explains: the attribute is
   * counted once, and as missing.
   */
  it("counts an attribute once, however many rows it has", () => {
    const complete = pillarCompleteness(
      [gap("a"), inUse("a"), inUse("b"), inUse("b")],
      null,
      names,
    );

    expect(complete).toMatchObject({ missing: 1, counted: 2 });
  });

  /** NEW-08: the catalog's name, and the id made readable before the names arrive. */
  it("names the pillar as the catalog does, or its id made readable", () => {
    expect(pillarCompleteness([gap("a")], "economics", names)?.sentence).toBe(
      "Nothing in Economy has a value in use.",
    );
    expect(pillarCompleteness([gap("a")], "quality_of_life", new Map())?.sentence).toBe(
      "Nothing in Quality of life has a value in use.",
    );
  });
});

describe("what it refuses to count", () => {
  /** A descriptive figure carries no weight: its presence completes nothing. */
  it("leaves out a row the set does not score", () => {
    expect(
      pillarCompleteness([inUse("a", false), gap("b")], null, names),
    ).toMatchObject({ missing: 1, counted: 1 });
  });

  /** While the scoring is pending or failed, no row is scored, and nothing is said. */
  it("says nothing at all when no row is scored", () => {
    expect(pillarCompleteness([inUse("a", false)], null, names)).toBeNull();
    expect(pillarCompleteness([], "economics", names)).toBeNull();
  });
});
