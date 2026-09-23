import { describe, expect, it } from "vitest";
import { pillarCompleteness } from "./pillarCompleteness";

const criteria = [
  { attribute: "country.cost_of_living_index", pillar: "economics" },
  { attribute: "country.total_tax_rate_effective", pillar: "economics" },
  { attribute: "country.economic_outlook", pillar: "economics" },
  { attribute: "country.homicide_rate", pillar: "safety" },
];

describe("how complete a chosen pillar is", () => {
  it("counts the pillar's attributes with nothing stored against them", () => {
    const complete = pillarCompleteness(
      criteria,
      [{ attribute: "country.cost_of_living_index" }],
      "economics",
    );

    expect(complete).toEqual({
      missing: 2,
      counted: 3,
      sentence: "2 of the 3 attributes in economics have no stored value.",
    });
  });

  it("says so plainly when every attribute in the pillar has one", () => {
    const complete = pillarCompleteness(
      criteria,
      [{ attribute: "country.homicide_rate" }],
      "safety",
    );

    expect(complete?.missing).toBe(0);
    expect(complete?.sentence).toBe(
      "Every attribute in safety has a stored value.",
    );
  });

  /** "1 of the 1 attributes" reads as though part of the pillar survived. None of it did. */
  it("says nothing is stored rather than counting all of it as a fraction", () => {
    expect(pillarCompleteness(criteria, [], "safety")?.sentence).toBe(
      "Nothing in safety has a stored value.",
    );
  });

  it("agrees with the verb when exactly one attribute is missing", () => {
    const complete = pillarCompleteness(
      criteria,
      [
        { attribute: "country.cost_of_living_index" },
        { attribute: "country.total_tax_rate_effective" },
      ],
      "economics",
    );

    expect(complete?.sentence).toBe(
      "1 of the 3 attributes in economics has no stored value.",
    );
  });

  /** Ids are the catalog's; a reader is shown words. The pillar stays lowercase mid-sentence. */
  it("prints a multi-word pillar id as words", () => {
    const complete = pillarCompleteness(
      [{ attribute: "country.x", pillar: "quality_of_life" }],
      [],
      "quality_of_life",
    );

    expect(complete?.sentence).toBe(
      "Nothing in quality of life has a stored value.",
    );
  });
});

describe("how complete the whole set is", () => {
  it("counts every scored attribute when no pillar is chosen", () => {
    const complete = pillarCompleteness(
      criteria,
      [{ attribute: "country.cost_of_living_index" }],
      null,
    );

    expect(complete).toEqual({
      missing: 3,
      counted: 4,
      sentence:
        "3 of the 4 attributes this set scores have no stored value.",
    });
  });

  it("says so when the set's every attribute has a figure", () => {
    const complete = pillarCompleteness(
      criteria,
      criteria.map((each) => ({ attribute: each.attribute })),
      null,
    );

    expect(complete?.sentence).toBe(
      "Every attribute this set scores has a stored value.",
    );
  });
});

describe("what it refuses to count", () => {
  /**
   * A criterion the set does not score carries no weight, so a missing figure for it changes
   * no number -- calling the pillar incomplete over it would send the reader after data that
   * cannot move the score (`reqs.md` 3.0).
   */
  it("leaves out a criterion the set does not score", () => {
    const complete = pillarCompleteness(
      [
        { attribute: "country.homicide_rate", pillar: "safety" },
        {
          attribute: "country.perceived_safety_index",
          pillar: "safety",
          is_scored: false,
        },
      ],
      [{ attribute: "country.homicide_rate" }],
      "safety",
    );

    expect(complete?.counted).toBe(1);
    expect(complete?.missing).toBe(0);
  });

  /** Before the criteria set arrives there is nothing to be complete against. */
  it("says nothing at all when the set is not loaded", () => {
    expect(pillarCompleteness(null, [{ attribute: "a" }], null)).toBeNull();
    expect(pillarCompleteness(undefined, undefined, "economics")).toBeNull();
  });

  it("says nothing about a pillar this set does not score", () => {
    expect(pillarCompleteness(criteria, [], "climate")).toBeNull();
  });

  /**
   * A superseded or rejected figure is still a stored value, and the Status column below says
   * which. The count must not take a different view of "has a figure" from the table it sits
   * above.
   */
  it("counts a superseded figure as a stored value", () => {
    const complete = pillarCompleteness(
      [{ attribute: "country.homicide_rate", pillar: "safety" }],
      [{ attribute: "country.homicide_rate" }],
      "safety",
    );

    expect(complete?.missing).toBe(0);
  });
});
