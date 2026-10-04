import { describe, expect, it } from "vitest";
import { pillarMatrix, pillarPriority, type Compared } from "./pillarMatrix";

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

  it("carries each pillar's id, so its attributes can be grouped under it", () => {
    const [total, economics, housing] = pillarMatrix(focus, [ahead]);
    // The total is not a pillar, so it has no id to group anything under.
    expect(total?.pillar).toBeNull();
    expect(economics?.pillar).toBe("economics");
    expect(housing?.pillar).toBe("housing");
  });
});

describe("which pillars the matrix marks as priorities", () => {
  const weighted: Compared = {
    candidate: "country.portugal",
    name: "Portugal",
    score: 83,
    pillar_scores: [
      { pillar: "economics", score: 78, weight: 25 },
      { pillar: "housing", score: 80, weight: 10 },
      { pillar: "safety", score: 64, weight: 18 },
      { pillar: "career", score: 70, weight: 12 },
    ],
  };

  it("ranks the heaviest few, heaviest first", () => {
    const priority = pillarPriority(weighted, 3);
    expect(priority.get("economics")).toBe(0);
    expect(priority.get("safety")).toBe(1);
    expect(priority.get("career")).toBe(2);
  });

  it("leaves the lighter pillars unranked rather than placing them last", () => {
    const priority = pillarPriority(weighted, 3);
    // Housing, at 10%, is outside the top three, so it is absent rather than ranked fourth.
    expect(priority.has("housing")).toBe(false);
  });

  it("ranks nothing when the focus was scored on no pillar", () => {
    expect(pillarPriority({ ...weighted, pillar_scores: null }).size).toBe(0);
  });
});

describe("what a difference is measured in", () => {
  const weighted: Compared = {
    candidate: "country.portugal",
    name: "Portugal",
    score: 83,
    pillar_scores: [
      { pillar: "economics", score: 78, weight: 14, contribution: 10.9 },
    ],
  };
  const other: Compared = {
    candidate: "country.netherlands",
    name: "Netherlands",
    score: 84,
    pillar_scores: [
      { pillar: "economics", score: 89, weight: 14, contribution: 12.5 },
    ],
  };

  it("reads the pillar score when measuring in points", () => {
    const [, economics] = pillarMatrix(weighted, [other], "points");
    expect(economics?.focus).toBe(78);
    expect(economics?.cells[0]?.delta).toBe(11);
  });

  /**
   * **A large gap on a small pillar moves little.** Eleven points on a pillar weighted at 14%
   * is worth 1.6 to the total, which is the number a reader deciding between two places needs
   * -- and the server computes it, so switching the measure reads a different figure rather
   * than doing arithmetic here.
   */
  it("reads what the pillar put into the total when measuring impact", () => {
    const [, economics] = pillarMatrix(weighted, [other], "impact");
    expect(economics?.focus).toBe(10.9);
    expect(economics?.cells[0]?.delta).toBeCloseTo(1.6, 5);
  });

  it("measures in points unless told otherwise", () => {
    expect(pillarMatrix(weighted, [other])[1]?.focus).toBe(78);
  });

  it("says nothing where the server sent no contribution to read", () => {
    const bare: Compared = {
      ...weighted,
      pillar_scores: [{ pillar: "economics", score: 78, weight: 14 }],
    };
    expect(pillarMatrix(bare, [other], "impact")[1]?.focus).toBeNull();
  });

  /** The total row is the total either way: it is already the sum of the contributions. */
  it("leaves the total alone, which is already what everything came to", () => {
    expect(pillarMatrix(weighted, [other], "impact")[0]?.focus).toBe(83);
  });
});
