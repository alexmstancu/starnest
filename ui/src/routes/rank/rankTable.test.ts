import { describe, expect, it } from "vitest";
import {
  PILLAR_CHART,
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

  it("draws an unscored pillar full height and hatched, never omitted", () => {
    const [, family] = pillarBars(roster);
    // No ramp colour is the signal for "nothing was stored"; the chart hatches it.
    expect(family?.fill).toBeNull();
    expect(family?.height).toBe(PILLAR_CHART.height);
    expect(family?.label).toBe("");
    expect(family?.title).toBe("family: no value stored");
  });

  /**
   * The lowest score still has a body. A bar one pixel tall is indistinguishable from a
   * missing one, and those two mean opposite things.
   */
  it("gives the lowest score a bar with a body rather than a hairline", () => {
    const [lowest] = pillarBars([
      { pillar: "x", score: 1, weight: 1, contribution: 0 },
    ]);
    expect(lowest?.height).toBe(19);
    expect(lowest?.label).toBe("1");
  });

  /** 96 and above fills the band; 40 and below sits at the floor. */
  it("scales a bar across the range the scores actually occupy", () => {
    const [top] = pillarBars([
      { pillar: "x", score: 96, weight: 1, contribution: 0 },
    ]);
    expect(top?.height).toBe(PILLAR_CHART.height);
    const [middle] = pillarBars([
      { pillar: "x", score: 68, weight: 1, contribution: 0 },
    ]);
    expect(middle?.height).toBeGreaterThan(19);
    expect(middle?.height).toBeLessThan(PILLAR_CHART.height);
  });

  it("ramps a bar's colour from amber through to teal as it scores", () => {
    const [low] = pillarBars([
      { pillar: "a", score: 40, weight: 1, contribution: 1 },
    ]);
    const [high] = pillarBars([
      { pillar: "b", score: 96, weight: 1, contribution: 1 },
    ]);
    // Amber at the floor: red channel far above blue.
    const amber = low!.fill!.bottom.match(/\d+/g)!.map(Number);
    expect(amber[0]).toBeGreaterThan(amber[2]!);
    // Teal at the ceiling: blue and green far above red.
    const teal = high!.fill!.bottom.match(/\d+/g)!.map(Number);
    expect(teal[1]).toBeGreaterThan(teal[0]!);
    expect(teal[2]).toBeGreaterThan(teal[0]!);
  });

  /** Eleven bars in 522px with 2px gutters leaves 45.6px each, and they must not overlap. */
  it("lays the bars out across the chart without overlapping", () => {
    const bars = pillarBars(
      Array.from({ length: 11 }, (_, index) => ({
        pillar: `p${index}`,
        score: 70,
        weight: 1,
        contribution: 1,
      })),
    );
    expect(bars[0]?.x).toBe(0);
    const last = bars[10]!;
    expect(last.x + last.width).toBeCloseTo(PILLAR_CHART.width, 6);
    expect(bars[1]!.x - (bars[0]!.x + bars[0]!.width)).toBeCloseTo(
      PILLAR_CHART.gap,
      6,
    );
  });

  it("titles each bar, because a stripe of colour explains nothing on its own", () => {
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
    // U+2212, not a hyphen: a hyphen is narrower than a plus at the same size, so a column
    // of signed deltas would not line up on it.
    expect(formatDelta(-8)).toBe("\u22128");
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
