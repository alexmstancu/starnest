import { describe, expect, it } from "vitest";
import type { components } from "../api/schema";
import { fetchComparison, fetchRankedCandidateDetail } from "../api/endpoints";
import { ATTRIBUTES, STORED_VALUES, pillarLines } from "./fixtures";

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

/**
 * **The default comparison is derivable from the fixtures beside it** (PL-091): each row is the
 * focus's own ranking-detail row, each comparator's score is its own, every worth is the gap at
 * the focus's weight, and every synthesis sentence restates a row. A sentence no row stands
 * behind certifies a screen against a comparison the server could never send.
 */
describe("the default comparison", () => {
  const SET = "default";
  const LEVEL = "country";
  const FOCUS_ID = "country.portugal";
  const COMPARATORS = ["country.netherlands", "country.spain"];

  async function drawn() {
    const comparison = await fetchComparison(SET, LEVEL, FOCUS_ID, COMPARATORS);
    const details = new Map(
      await Promise.all(
        [FOCUS_ID, ...COMPARATORS].map(
          async (id) => [id, await fetchRankedCandidateDetail(id, SET, LEVEL)] as const,
        ),
      ),
    );
    return { comparison, scoresOf: (id: string) => details.get(id)!.attribute_scores ?? [] };
  }

  it("has a row per focus attribute, at the weight and score its ranking detail serves", async () => {
    const { comparison, scoresOf } = await drawn();

    expect(
      comparison.attributes.map((row) => [row.attribute, row.effective_weight, row.focus.normalised_score]),
    ).toEqual(
      scoresOf(FOCUS_ID).map((row) => [row.attribute, row.effective_weight, row.normalised_score]),
    );
  });

  it("gives each comparator its own score, worth the gap at the focus's weight", async () => {
    const { comparison, scoresOf } = await drawn();

    for (const row of comparison.attributes) {
      for (const cell of row.comparators ?? []) {
        const theirs =
          scoresOf(cell.candidate ?? "").find((score) => score.attribute === row.attribute)
            ?.normalised_score ?? null;
        const ours = row.focus.normalised_score ?? null;
        expect(cell.normalised_score ?? null).toBe(theirs);
        expect(cell.weighted_contribution ?? null).toBe(
          theirs === null || ours === null ? null : ((theirs - ours) * row.effective_weight) / 100,
        );
      }
    }
  });

  it("writes only sentences its rows stand behind, by the server's rule", async () => {
    const { comparison } = await drawn();
    const names = new Map(ATTRIBUTES.map((attribute) => [attribute.id, attribute.name]));

    for (const pair of comparison.synthesis ?? []) {
      const worth = comparison.attributes.flatMap((row) => {
        const cell = (row.comparators ?? []).find((each) => each.candidate === pair.comparator)!;
        const contribution = cell.weighted_contribution;
        if (contribution === null || contribution === undefined) return [];
        const sign = contribution > 0 ? "+" : "";
        const sentence =
          `${names.get(row.attribute) ?? row.attribute}: ${cell.normalised_score} against ` +
          `${row.focus.normalised_score}, worth ${sign}${contribution.toFixed(1)} points`;
        return [{ contribution, sentence }];
      });
      const ordered = (keep: (value: number) => boolean, sign: number) =>
        worth
          .filter(({ contribution }) => keep(contribution))
          .sort((one, other) => sign * (one.contribution - other.contribution))
          .slice(0, 3)
          .map(({ sentence }) => sentence);

      expect(pair.advantages).toEqual(ordered((value) => value > 0, -1));
      expect(pair.disadvantages).toEqual(ordered((value) => value < 0, 1));
    }
  });

  it("shows each side's active stored figure, and the gap between them", async () => {
    const { comparison } = await drawn();
    const activeFigure = (candidate: string, attribute: string) =>
      STORED_VALUES.find(
        (value) => value.candidate === candidate && value.attribute === attribute && value.is_active,
      );

    for (const row of comparison.attributes) {
      expect(row.focus.value).toEqual(activeFigure(FOCUS_ID, row.attribute));
      for (const cell of row.comparators ?? []) {
        expect(cell.value).toEqual(activeFigure(cell.candidate ?? "", row.attribute));
        const [ours, theirs] = [row.focus.value, cell.value].map(
          (value) => (value?.payload as { magnitude?: number } | undefined)?.magnitude,
        );
        expect(cell.delta ?? null).toBe(
          ours === undefined || theirs === undefined ? null : Number((theirs - ours).toFixed(6)),
        );
      }
    }
  });
});
