import { describe, expect, it } from "vitest";
import { howScored } from "./howScored";

/**
 * PL-073. The "how was this scored" tooltip, built only from what was served: the catalog's
 * type and unit, the set's goal, method, anchors and whether it blocks, and the row's source.
 */
describe("how an attribute was scored", () => {
  const anchored = {
    goal: "minimise" as const,
    normalisation_method: "fixed" as const,
    scale_anchors: [
      { input_value: 55, score: 0 },
      { input_value: 35, score: 100 },
    ],
    blocks_if_missing: true,
  };

  it("states what it measures, the goal, the method with its anchors, the source and that it is required", () => {
    expect(
      howScored({
        criterion: anchored,
        attribute: { value_type: "Ratio", unit: "%" },
        source: "OECD",
      }),
    ).toBe(
      [
        "A percentage.",
        "Goal: lower is better.",
        "Scored against fixed anchors: 35 scores 100, 55 scores 0.",
        "Source: OECD.",
        "Required: no score without it.",
      ].join("\n"),
    );
  });

  it("says a band's ends, a percentile method, and that a missing figure's weight is spread", () => {
    expect(
      howScored({
        criterion: {
          goal: "target_range",
          target_range_min: 18,
          target_range_max: 24,
          normalisation_method: "percentile",
          blocks_if_missing: false,
        },
        attribute: undefined,
        source: "Open-Meteo",
      }),
    ).toBe(
      [
        "Goal: best between 18 and 24.",
        "Scored by percentile.",
        "Source: Open-Meteo.",
        "Not required: when missing, its weight is spread over the attributes that have a figure.",
      ].join("\n"),
    );
  });

  /** A fixed method with no anchors scores nothing, and says so rather than listing none. */
  it("says a fixed scale has no anchors set", () => {
    expect(
      howScored({
        criterion: { normalisation_method: "fixed", scale_anchors: [] },
        attribute: undefined,
        source: "Eurostat",
      }),
    ).toContain("Scored against fixed anchors, none set yet.");
  });

  /** An excluded criterion judges and does not count, so it was not scored either. */
  it("says nothing for a criterion the set excludes from scoring", () => {
    expect(
      howScored({ criterion: { is_scored: false, goal: "maximise" }, attribute: undefined, source: "Eurostat" }),
    ).toBeNull();
  });

  /** No criterion, no tooltip: an attribute the set does not judge was not scored at all. */
  it("says nothing for an attribute no criterion judges", () => {
    expect(
      howScored({ criterion: undefined, attribute: { value_type: "Count" }, source: "Eurostat" }),
    ).toBeNull();
  });
});
