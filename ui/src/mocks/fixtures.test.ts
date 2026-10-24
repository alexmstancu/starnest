import { describe, expect, it } from "vitest";
import type { components } from "../api/schema";
import { pillarLines } from "./fixtures";

type CandidateResult = components["schemas"]["CandidateResult"];

/**
 * **The mock draws a pair's pillar lines by the server's rule** (`comparison.py`, PL-099,
 * PL-100), so a card tested against it cannot pass on a line the server would never send. The
 * fixture's own comparators carry no pillar scores, so these are the only lines it draws.
 */

/** A candidate with a total and, per pillar, its score and what it put into the total. */
function scored(
  score: number | null,
  pillars: readonly (readonly [string, number | null, number])[],
): CandidateResult {
  return {
    candidate: "country.anywhere",
    name: "Anywhere",
    score,
    coverage: 90,
    match_status: "matching",
    parent_not_matching: false,
    pillar_scores: pillars.map(([pillar, pillarScore, contribution]) => ({
      pillar,
      score: pillarScore,
      weight: 20,
      contribution,
    })),
  };
}

const FOCUS = scored(70, [
  ["economics", 80, 20],
  ["housing", 60, 12],
  ["safety", 50, 5],
  ["family", null, 0],
  ["climate", 70, 7],
  ["health", 60, 6],
]);

describe("a pair's pillar lines, in the mock", () => {
  it("are each worth the comparator's contribution minus the focus's, most worth first", () => {
    const comparator = scored(72, [
      ["economics", 70, 17.5],
      ["housing", 75, 15],
      ["safety", 60, 6],
      ["family", 40, 1.6],
      ["climate", 70, 7],
      ["health", 60, 6],
    ]);

    // Climate and health are level, so neither is led or trailed on; family has no score on
    // the focus's side, so it cannot be compared.
    expect(pillarLines(FOCUS, comparator)).toEqual({
      ahead: [
        { pillar: "housing", worth: 3 },
        { pillar: "safety", worth: 1 },
      ],
      behind: [{ pillar: "economics", worth: -2.5 }],
      not_comparable: ["family"],
    });
  });

  it("keep three a side, a tie in the focus's order, and name what either side left unscored", () => {
    const comparator = scored(90, [
      ["economics", 90, 24],
      ["housing", 80, 16],
      ["safety", 80, 8],
      ["climate", 90, 9],
      ["health", null, 0],
    ]);

    expect(pillarLines(FOCUS, comparator)).toEqual({
      ahead: [
        { pillar: "economics", worth: 4 },
        { pillar: "housing", worth: 4 },
        { pillar: "safety", worth: 3 },
      ],
      behind: [],
      not_comparable: ["family", "health"],
    });
  });

  it("are none when either side has no total, while what cannot be compared is still named", () => {
    const comparator = scored(null, [["economics", 70, 17.5]]);
    const unscoredFocus = scored(null, [["economics", 80, 20]]);

    expect(pillarLines(FOCUS, comparator)).toEqual({
      ahead: [],
      behind: [],
      not_comparable: ["housing", "safety", "family", "climate", "health"],
    });
    expect(pillarLines(unscoredFocus, scored(72, [["economics", 70, 17.5]]))).toEqual({
      ahead: [],
      behind: [],
      not_comparable: [],
    });
  });
});
