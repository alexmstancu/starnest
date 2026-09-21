import { describe, expect, it } from "vitest";
import { totalOf, totalsByPillar, weightAsText, weightFrom } from "./weights";

/** Reading a typed weight, which both levels of weighting do and neither's markup should. */

describe("reading a typed weight", () => {
  it("reads a number", () => {
    expect(weightFrom("40")).toBe(40);
    expect(weightFrom("29.17")).toBe(29.17);
  });

  it("refuses an empty field rather than calling it zero", () => {
    expect(weightFrom("")).toBeNull();
    expect(weightFrom("   ")).toBeNull();
  });

  it("refuses something that is not a number at all", () => {
    /** Nothing is sent, so the refusal is about weights rather than about parsing. */
    expect(weightFrom("ten")).toBeNull();
    expect(weightFrom("4o")).toBeNull();
  });

  it("refuses an infinity, which is a number and not a percentage", () => {
    expect(weightFrom("Infinity")).toBeNull();
  });

  it("keeps a real zero, which is a weight somebody chose", () => {
    expect(weightFrom("0")).toBe(0);
  });
});

describe("showing a stored weight", () => {
  it("prints the number", () => {
    expect(weightAsText(65)).toBe("65");
  });

  it("shows an absent weight as empty, never as a zero standing in for not set", () => {
    expect(weightAsText(undefined)).toBe("");
  });
});

describe("the running total", () => {
  it("adds the weights up", () => {
    expect(totalOf([{ weight: 40 }, { weight: 35 }, { weight: 25 }])).toBe(100);
  });

  it("is zero for a set that weighs nothing yet", () => {
    expect(totalOf([])).toBe(0);
  });
});

describe("what each pillar's criteria come to", () => {
  it("sums the weights of the criteria in each pillar", () => {
    expect(
      totalsByPillar([
        { pillar: "housing", weight: 60 },
        { pillar: "housing", weight: 40 },
        { pillar: "career", weight: 100 },
      ]),
    ).toEqual([
      { pillar: "housing", total: 100, balanced: true },
      { pillar: "career", total: 100, balanced: true },
    ]);
  });

  it("says when a pillar does not add up", () => {
    const [housing] = totalsByPillar([
      { pillar: "housing", weight: 60 },
      { pillar: "housing", weight: 30 },
    ]);
    expect(housing).toEqual({ pillar: "housing", total: 90, balanced: false });
  });

  /**
   * The lesson migration `0477` already paid for: three siblings sharing 100 do not come to
   * 100 in binary floating point, and an exact test reports the arithmetic as broken every
   * time it is right.
   */
  /**
   * `(1 / 3) * 100` three times comes to 99.99999999999999, while `100 / 3` three times comes
   * to exactly 100 -- the same quantity by two routes, one of which leaves a residue. Which
   * route a rebalance takes is the server's business, so the check here has to survive either.
   */
  it("treats a total that misses 100 by rounding as balanced", () => {
    const third = (1 / 3) * 100;
    const [pillar] = totalsByPillar([
      { pillar: "nature", weight: third },
      { pillar: "nature", weight: third },
      { pillar: "nature", weight: third },
    ]);
    expect(pillar?.total).not.toBe(100);
    expect(pillar?.balanced).toBe(true);
  });

  /** Tolerant of rounding, not of a real gap: 99.9 is somebody's weight missing. */
  it("does not treat a real shortfall as rounding", () => {
    const [pillar] = totalsByPillar([
      { pillar: "nature", weight: 50 },
      { pillar: "nature", weight: 49.9 },
    ]);
    expect(pillar?.balanced).toBe(false);
  });

  it("counts a criterion with no weight as nothing, not as a gap", () => {
    expect(totalsByPillar([{ pillar: "health" }])).toEqual([
      { pillar: "health", total: 0, balanced: false },
    ]);
  });

  it("has nothing to say about no criteria", () => {
    expect(totalsByPillar([])).toEqual([]);
  });

  it("keeps the pillars in the order they first appear", () => {
    expect(
      totalsByPillar([
        { pillar: "career", weight: 50 },
        { pillar: "housing", weight: 50 },
        { pillar: "career", weight: 50 },
      ]).map((each) => each.pillar),
    ).toEqual(["career", "housing"]);
  });
});
