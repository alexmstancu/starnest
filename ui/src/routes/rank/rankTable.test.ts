import { describe, expect, it } from "vitest";
import {
  confidenceBands,
  confidenceLabel,
  coverageBar,
  deltaTone,
  formatDelta,
  pillarBars,
} from "./rankTable";

describe("the coverage bar", () => {
  it.each([
    [90, "good"],
    [75, "good"],
    [70, "fair"],
    [60, "fair"],
    [59.9, "weak"],
    [0, "weak"],
  ])("reads %s%% as %s", (coverage, tone) => {
    expect(coverageBar(coverage).tone).toBe(tone);
  });

  it("carries the percentage through as a width", () => {
    expect(coverageBar(73.4).width).toBe("73.4%");
  });

  it("treats a missing coverage as nothing covered rather than as full width", () => {
    expect(coverageBar(null)).toEqual({ width: "0%", tone: "weak" });
    expect(coverageBar(undefined).width).toBe("0%");
  });

  it("clamps a figure outside the scale instead of drawing past the track", () => {
    expect(coverageBar(140).width).toBe("100%");
    expect(coverageBar(-20).width).toBe("0%");
  });
});

describe("the confidence bands", () => {
  const split = { absolute: 0, high: 82.5, medium: 11, low: 6.5 };

  it("orders them strongest first, whatever order the payload used", () => {
    expect(
      confidenceBands({ low: 6.5, high: 82.5, medium: 11 }).map((b) => b.grade),
    ).toEqual(["high", "medium", "low"]);
  });

  it("leaves out a grade worth nothing rather than drawing it at zero width", () => {
    expect(confidenceBands(split).map((b) => b.grade)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("keeps `absolute`, which the domain defines and the design's own data never had", () => {
    const bands = confidenceBands({ absolute: 40, high: 60 });
    expect(bands.map((b) => b.grade)).toEqual(["absolute", "high"]);
    expect(bands[0]?.tone).toBe("strong");
  });

  it("titles each band so the bar is readable without the legend", () => {
    expect(confidenceBands(split)[0]?.title).toBe(
      "high confidence: 83% of the scored weight",
    );
  });

  it("is empty when nothing was answered, rather than one full-width band", () => {
    expect(confidenceBands(null)).toEqual([]);
    expect(confidenceBands({})).toEqual([]);
  });
});

describe("the confidence label", () => {
  it("reads the split the way the design writes it", () => {
    expect(confidenceLabel({ high: 82.5, medium: 11, low: 6.5 })).toBe(
      "83h / 11m / 7l",
    );
  });

  it("says nothing rather than `0h / 0m / 0l` when there is no split", () => {
    expect(confidenceLabel(undefined)).toBe("—");
  });
});

describe("the pillar chart", () => {
  const roster = [
    { pillar: "economics", score: 80, weight: 16.3, contribution: 13.1 },
    { pillar: "family", score: null, weight: 4, contribution: 0 },
    { pillar: "housing", score: 20, weight: 10, contribution: 2 },
  ];

  it("draws one bar per pillar, in the order they arrive", () => {
    expect(pillarBars(roster).map((b) => b.pillar)).toEqual([
      "economics",
      "family",
      "housing",
    ]);
  });

  it("draws an unscored pillar full height in its own tone, never omitted", () => {
    const [, family] = pillarBars(roster);
    expect(family?.tone).toBe("none");
    expect(family?.height).toBe("26");
    expect(family?.title).toBe("family: no score");
  });

  it("gives a very low score a visible stub rather than a hairline", () => {
    const [, , housing] = pillarBars(roster);
    // 20% of 26 would be 5.2; the floor of 8% keeps it distinguishable from absent.
    expect(Number(housing?.height)).toBeGreaterThanOrEqual(
      Number(housing?.height),
    );
    expect(
      Number(
        pillarBars([{ pillar: "x", score: 1, weight: 1, contribution: 0 }])[0]
          ?.height,
      ),
    ).toBeCloseTo(2.08, 2);
  });

  it("tones a bar by what it scored", () => {
    const tones = pillarBars([
      { pillar: "a", score: 90, weight: 1, contribution: 1 },
      { pillar: "b", score: 60, weight: 1, contribution: 1 },
      { pillar: "c", score: 10, weight: 1, contribution: 1 },
    ]).map((b) => b.tone);
    expect(tones).toEqual(["good", "fair", "weak"]);
  });

  it("titles each bar, because a 4px stripe explains nothing on its own", () => {
    expect(pillarBars(roster)[0]?.title).toBe("economics: 80, weight 16.3%");
  });

  it("draws nothing when the ranking carried no pillars", () => {
    expect(pillarBars([])).toEqual([]);
    expect(pillarBars(null)).toEqual([]);
  });
});

describe("the difference from home", () => {
  it("signs the number the way the design does", () => {
    expect(formatDelta(11)).toBe("+11");
    expect(formatDelta(-8)).toBe("-8");
  });

  it("says nothing rather than zero when there is nothing to compare against", () => {
    expect(formatDelta(null)).toBe("—");
    expect(formatDelta(undefined)).toBe("—");
  });

  it("reads level as level, so home itself is not coloured as a win", () => {
    expect(deltaTone(0)).toBe("level");
    expect(deltaTone(null)).toBe("level");
    expect(deltaTone(3)).toBe("ahead");
    expect(deltaTone(-3)).toBe("behind");
  });
});
