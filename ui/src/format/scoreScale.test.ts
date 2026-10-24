import { describe, expect, it } from "vitest";
import { isScale, scoreRange, scoreShare, scoreTrackWidth } from "./scoreScale";

/**
 * PL-062. A score is on the scale that came with it, never on 0-100 by assumption: the top of
 * the range is a setting, and a saved ranking keeps the one it was computed on.
 */
describe("the range a score is on", () => {
  it("names the scale the response carried", () => {
    expect(scoreRange(150)).toBe("0–150");
    expect(scoreRange(50)).toBe("0–50");
  });

  it("names nothing when no scale came with the scores", () => {
    expect(scoreRange(null)).toBe("");
    expect(scoreRange(undefined)).toBe("");
  });

  it("names nothing for a scale no score can be on", () => {
    expect(scoreRange(0)).toBe("");
    expect(scoreRange(-10)).toBe("");
    expect(scoreRange(Number.NaN)).toBe("");
    expect(scoreRange(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("how much of its scale a score fills", () => {
  it("reads a score against its own scale, not against 100", () => {
    expect(scoreShare(75, 150)).toBe(0.5);
    expect(scoreShare(128, 150)).toBeCloseTo(0.8533, 4);
  });

  it("is the whole scale at the top and nothing at the bottom", () => {
    expect(scoreShare(150, 150)).toBe(1);
    expect(scoreShare(0, 150)).toBe(0);
  });

  it("never draws past either end", () => {
    expect(scoreShare(200, 150)).toBe(1);
    expect(scoreShare(-5, 150)).toBe(0);
  });

  it("is unknown without a score or without a scale", () => {
    expect(scoreShare(null, 150)).toBeNull();
    expect(scoreShare(undefined, 150)).toBeNull();
    expect(scoreShare(Number.NaN, 150)).toBeNull();
    expect(scoreShare(80, null)).toBeNull();
    expect(scoreShare(80, undefined)).toBeNull();
    expect(scoreShare(80, 0)).toBeNull();
  });
});

describe("how wide a score's track is drawn", () => {
  it("is the share of its own scale, as a percentage of the track", () => {
    expect(scoreTrackWidth(128, 150)).toBe("85.3%");
    expect(scoreTrackWidth(75, 150)).toBe("50%");
    expect(scoreTrackWidth(40, 50)).toBe("80%");
  });

  it("never runs past the end of the track", () => {
    expect(scoreTrackWidth(150, 150)).toBe("100%");
    expect(scoreTrackWidth(180, 150)).toBe("100%");
  });

  it("draws no track when the score or the scale is missing", () => {
    expect(scoreTrackWidth(null, 150)).toBeNull();
    expect(scoreTrackWidth(80, null)).toBeNull();
    expect(scoreTrackWidth(80, undefined)).toBeNull();
  });
});

describe("whether a response carried a scale", () => {
  it("knows a positive, finite top of the range", () => {
    expect(isScale(150)).toBe(true);
    expect(isScale(1)).toBe(true);
  });

  it("knows none in a missing, zero, negative or unbounded one", () => {
    for (const none of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isScale(none)).toBe(false);
    }
  });
});
