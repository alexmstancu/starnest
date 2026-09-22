import { describe, expect, it } from "vitest";
import { pillarMatrix, type Compared } from "./pillarMatrix";

const focus: Compared = {
  candidate: "country.portugal",
  name: "Portugal",
  score: 83,
  pillar_scores: [
    { pillar: "economics", score: 78, weight: 14 },
    { pillar: "housing", score: 80, weight: 10 },
  ],
};

const ahead: Compared = {
  candidate: "country.netherlands",
  name: "Netherlands",
  score: 84,
  pillar_scores: [
    { pillar: "economics", score: 89, weight: 14 },
    { pillar: "housing", score: 74, weight: 10 },
  ],
};

describe("the comparison matrix", () => {
  it("puts the total first, and the pillars in the order the focus sent them", () => {
    expect(pillarMatrix(focus, [ahead]).map((row) => row.label)).toEqual([
      "Total score",
      "economics",
      "housing",
    ]);
  });

  it("marks the total row, which is drawn apart from the rest", () => {
    const [total, ...pillars] = pillarMatrix(focus, [ahead]);
    expect(total?.total).toBe(true);
    expect(pillars.every((row) => !row.total)).toBe(true);
  });

  it("subtracts the focus from each comparator, per pillar", () => {
    const [total, economics, housing] = pillarMatrix(focus, [ahead]);
    expect(total?.cells[0]?.delta).toBe(1);
    expect(economics?.cells[0]?.delta).toBe(11);
    expect(housing?.cells[0]?.delta).toBe(-6);
  });

  it("carries what each row is worth, and gives the total the whole hundred", () => {
    const [total, economics] = pillarMatrix(focus, [ahead]);
    expect(total?.weight).toBe(100);
    expect(economics?.weight).toBe(14);
  });

  /** A zero delta reads as "the same", which is a measurement nobody made. */
  it("says nothing rather than zero where a comparator has no score", () => {
    const blank: Compared = {
      candidate: "country.malta",
      name: "Malta",
      score: null,
      pillar_scores: [{ pillar: "economics", score: null, weight: 14 }],
    };
    const [total, economics] = pillarMatrix(focus, [blank]);
    expect(total?.cells[0]).toEqual({
      candidate: "country.malta",
      score: null,
      delta: null,
    });
    expect(economics?.cells[0]?.delta).toBeNull();
  });

  it("says nothing rather than zero where the focus itself has no score", () => {
    const unscored: Compared = { ...focus, score: null };
    expect(pillarMatrix(unscored, [ahead])[0]?.cells[0]?.delta).toBeNull();
  });

  it("holds a pillar the comparator does not carry at all", () => {
    const partial: Compared = { ...ahead, pillar_scores: [] };
    const [, economics] = pillarMatrix(focus, [partial]);
    expect(economics?.cells[0]?.score).toBeNull();
  });

  it("is just the total when the focus was scored on no pillar", () => {
    expect(pillarMatrix({ ...focus, pillar_scores: null }, [ahead])).toHaveLength(1);
  });
});
