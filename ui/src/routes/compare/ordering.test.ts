import { describe, expect, it } from "vitest";
import { inScoreOrder, orderByScore, pillarPriority, pillarWeightsAt, rankInPillar } from "./ordering";

describe("the set's pillar weights at one level", () => {
  const set = {
    pillar_weights: [
      { pillar: "economics", level: "country", weight: 16.9 },
      { pillar: "housing", level: "city", weight: 50 },
      { pillar: "safety", level: "country", weight: 20 },
    ],
  };

  it("keeps the weights configured at this level, as configured", () => {
    expect([...pillarWeightsAt(set, "country")]).toEqual([
      ["economics", 16.9],
      ["safety", 20],
    ]);
  });

  it("holds nothing while the set or the level is unknown", () => {
    expect(pillarWeightsAt(null, "country").size).toBe(0);
    expect(pillarWeightsAt(set, null).size).toBe(0);
  });
});

/**
 * PL-104. **"#N priority" ranks the set's configured weights**, never the focus's redistributed
 * ones, so it does not move when only the focus changes.
 */
describe("which pillars are priorities", () => {
  const weights = new Map([
    ["economics", 25],
    ["housing", 10],
    ["safety", 18],
    ["career", 12],
  ]);

  it("ranks the heaviest three, heaviest first", () => {
    const priority = pillarPriority(weights);

    expect([...priority]).toEqual([
      ["economics", 0],
      ["safety", 1],
      ["career", 2],
    ]);
  });

  it("leaves a lighter pillar unranked rather than placing it fourth", () => {
    expect(pillarPriority(weights).has("housing")).toBe(false);
  });

  it("never makes a pillar weighted at nothing a priority", () => {
    const priority = pillarPriority(new Map([["economics", 0], ["safety", 5]]));

    expect([...priority]).toEqual([["safety", 0]]);
  });

  it("breaks a tie by the set's own order", () => {
    const priority = pillarPriority(new Map([["housing", 20], ["economics", 20]]));

    expect(priority.get("housing")).toBe(0);
    expect(priority.get("economics")).toBe(1);
  });

  it("ranks nothing when no weight is known", () => {
    expect(pillarPriority(new Map()).size).toBe(0);
  });
});

/** PL-098. "#N in pillar" ranks a pillar's attributes by what each counted for. */
describe("an attribute's place in its pillar", () => {
  it("ranks the three heaviest, a tie in the server's order", () => {
    const places = rankInPillar([
      { attribute: "a", weight: 10 },
      { attribute: "b", weight: 20 },
      { attribute: "c", weight: 20 },
      { attribute: "d", weight: 5 },
    ]);

    expect([...places]).toEqual([
      ["b", 0],
      ["c", 1],
      ["a", 2],
    ]);
  });

  it("never places an attribute that counted for nothing, or whose weight is unknown", () => {
    const places = rankInPillar([
      { attribute: "a", weight: 0 },
      { attribute: "b", weight: null },
    ]);

    expect(places.size).toBe(0);
  });
});

describe("the comparators' order (PL-103)", () => {
  it("puts the highest score first and no score last, keeping ties in the order chosen", () => {
    const chosen = [
      { candidate: "ee", score: null },
      { candidate: "es", score: 64 },
      { candidate: "nl", score: 71 },
      { candidate: "mt", score: 64 },
    ];

    expect(orderByScore(chosen).map((each) => each.candidate)).toEqual(["nl", "es", "mt", "ee"]);
  });

  it("puts each card where its comparator's column is", () => {
    const comparison = {
      comparators: [
        { candidate: "es", score: 64 },
        { candidate: "nl", score: 71 },
      ],
      synthesis: [{ comparator: "es" }, { comparator: "nl" }],
    };

    expect(inScoreOrder(comparison).synthesis.map((pair) => pair.comparator)).toEqual(["nl", "es"]);
  });
});
