import { describe, expect, it } from "vitest";
import {
  describeAnchors,
  describeGoal,
  describeNormalisation,
  describeThreshold,
  describeValueType,
} from "./criterionWords";

describe("what the attribute measures", () => {
  it("says the type and its unit together", () => {
    expect(describeValueType("Monetary", "EUR")).toBe("Money in EUR");
    expect(describeValueType("Quantity", "index_eu27_100")).toBe(
      "Measured in EU27 = 100",
    );
    expect(describeValueType("Count", "flights")).toBe("Counted in flights");
    expect(describeValueType("Index", "0-100")).toBe("An index on 0-100");
  });

  /** PL-029: the unit is said as a reader writes it, never as the catalog's key. */
  it("says the unit in words rather than as its identifier", () => {
    expect(describeValueType("Quantity", "percent_per_year")).toBe("Measured in % per year");
    expect(describeValueType("Index", "eu27_average_100")).toBe("An index on EU27 = 100");
    expect(describeValueType("Count", "new_unit_nobody_named")).toBe(
      "Counted in new unit nobody named",
    );
  });

  /** A unit is optional in the catalog, and half a phrase is worse than a shorter one. */
  it("drops the unit where the catalog has none", () => {
    expect(describeValueType("Monetary", null)).toBe("Money");
    expect(describeValueType("Quantity", "  ")).toBe("A measured quantity");
    expect(describeValueType("Count", undefined)).toBe("A count");
  });

  it("says the types that carry no unit in their own words", () => {
    expect(describeValueType("Ratio", "%")).toBe("A percentage");
    expect(describeValueType("LabelSet", null)).toBe("A set of labels");
    expect(describeValueType("ShareComposition", null)).toBe(
      "Shares of a whole",
    );
    expect(describeValueType("Boolean", null)).toBe("Yes or no");
    expect(describeValueType("Text", null)).toBe("Text");
    expect(describeValueType("AssignedScore", "0-10")).toBe(
      "A score somebody assigned",
    );
  });

  /**
   * **Empty, not "Unknown".** This is what a row shows while the catalog is still in flight or
   * has never heard of the attribute, and a line reading "Unknown type" would report a request
   * in progress as a fact about the data.
   */
  it("says nothing at all for a type it was not given", () => {
    expect(describeValueType(undefined, "EUR")).toBe("");
    expect(describeValueType("NotAType", null)).toBe("");
  });
});

describe("what stops a candidate matching", () => {
  it("says an absent threshold is absent", () => {
    expect(describeThreshold(null)).toBe("no threshold");
    expect(describeThreshold(undefined)).toBe("no threshold");
    expect(describeThreshold({})).toBe("no threshold");
  });

  it("reads a numeric range as bounds", () => {
    expect(describeThreshold({ min_value: 5, max_value: 20 })).toBe(
      "between 5 and 20",
    );
  });

  /** An open end is said as one: "at least 5" and "between 5 and nothing" are the same fact. */
  it("says an open end as an open end", () => {
    expect(describeThreshold({ min_value: 5, max_value: null })).toBe(
      "at least 5",
    );
    expect(describeThreshold({ min_value: null, max_value: 20 })).toBe(
      "at most 20",
    );
  });

  it("keeps a zero bound, which is a bound somebody chose", () => {
    expect(describeThreshold({ max_value: 0 })).toBe("at most 0");
  });

  /** A range shape carrying neither bound states nothing, which the server would refuse. */
  it("says no threshold for a range with both bounds cleared", () => {
    expect(describeThreshold({ min_value: null, max_value: null })).toBe(
      "no threshold",
    );
  });

  it("reads a label threshold as containment, each rule in its own clause", () => {
    expect(
      describeThreshold({
        labels: [
          { label: "english", containment_rule: "must_contain" },
          { label: "visa_required", containment_rule: "must_not_contain" },
        ],
      }),
    ).toBe("must contain english; must not contain visa_required");
  });

  /** One containment rule is the ordinary case; the clause it does not use is left out. */
  it("says one containment rule on its own", () => {
    expect(
      describeThreshold({
        labels: [{ label: "english", containment_rule: "must_contain" }],
      }),
    ).toBe("must contain english");
    expect(
      describeThreshold({
        labels: [{ label: "visa_required", containment_rule: "must_not_contain" }],
      }),
    ).toBe("must not contain visa_required");
  });

  it("treats a label threshold with no labels as no threshold", () => {
    expect(describeThreshold({ labels: [] })).toBe("no threshold");
  });

  it("reads a boolean threshold as the demand it is", () => {
    expect(describeThreshold({ required_value: true })).toBe("must be yes");
    expect(describeThreshold({ required_value: false })).toBe("must be no");
  });

  it("reads a share threshold as its label and its bounds", () => {
    expect(
      describeThreshold({ label: "renting", min_share: 20, max_share: 60 }),
    ).toBe("renting between 20 and 60");
  });

  it("names the share even where the criterion did not", () => {
    expect(describeThreshold({ min_share: 20 })).toBe("a share at least 20");
  });
});

describe("how a figure is scored", () => {
  it("says each method as what it does to the figure", () => {
    expect(describeNormalisation("fixed")).toBe("scored against fixed anchors");
    expect(describeNormalisation("percentile")).toBe("scored by percentile");
    expect(describeNormalisation("as_is")).toBe("used as published");
  });

  /** A method added to the contract before this module hears of it shows its own name. */
  it("shows an unrecognised method rather than swallowing it", () => {
    expect(describeNormalisation("something_new")).toBe("something_new");
  });
});

describe("what the goal asks of a figure", () => {
  it("says a direction as which end is better", () => {
    expect(describeGoal("minimise")).toBe("lower is better");
    expect(describeGoal("maximise")).toBe("higher is better");
  });

  it("says a band with its ends, and open ends as open", () => {
    expect(describeGoal("target_range", 18, 24)).toBe("best between 18 and 24");
    expect(describeGoal("target_range", 18, null)).toBe("best at least 18");
    expect(describeGoal("target_range", null, null)).toBe("best within a band not yet set");
  });

  /** Nothing is invented for a goal the criterion does not state. */
  it("says nothing for a goal it was not given", () => {
    expect(describeGoal(undefined)).toBe("");
  });
});

describe("the anchors of a fixed scale", () => {
  it("says each anchor as the score its figure earns, lowest figure first", () => {
    expect(
      describeAnchors([
        { input_value: 55, score: 0 },
        { input_value: 35, score: 100 },
      ]),
    ).toBe("35 scores 100, 55 scores 0");
  });

  it("says nothing where no anchor is set", () => {
    expect(describeAnchors([])).toBe("");
    expect(describeAnchors(undefined)).toBe("");
  });
});
