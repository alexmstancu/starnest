import { describe, expect, it } from "vitest";
import { confidenceBands, confidenceLabel, coverageBar } from "./rankTable";

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
