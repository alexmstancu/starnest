import { describe, expect, it } from "vitest";
import { divergingBar, maxAbsDelta } from "./divergingBar";

/** A scale and a focus large enough not to interfere with whatever the test is about. */
const ANY_SCALE = 1000;
const ANY_FOCUS = 1000;

describe("the diverging bar", () => {
  it("is level when there is no difference", () => {
    const level = divergingBar(0, ANY_SCALE, ANY_FOCUS);
    expect(level.direction).toBe("level");
    expect(level.width).toBe(0);
    expect(level.alpha).toBe(0);
  });

  it("is level when there is no figure to compare", () => {
    expect(divergingBar(null, ANY_SCALE, ANY_FOCUS).direction).toBe("level");
    expect(divergingBar(undefined, ANY_SCALE, ANY_FOCUS).direction).toBe("level");
    expect(divergingBar(Number.NaN, ANY_SCALE, ANY_FOCUS).direction).toBe("level");
  });

  it("goes right when ahead and left when behind", () => {
    expect(divergingBar(12, ANY_SCALE, ANY_FOCUS).direction).toBe("ahead");
    expect(divergingBar(-12, ANY_SCALE, ANY_FOCUS).direction).toBe("behind");
  });

  it("starts at the centre going right, and reaches back to it going left", () => {
    // 10 of a scale of 20 is half the track, so the bar is 25 wide (half of the half).
    const ahead = divergingBar(10, 20, ANY_FOCUS);
    expect(ahead.left).toBe(50);
    expect(ahead.width).toBe(25);

    const behind = divergingBar(-10, 20, ANY_FOCUS);
    expect(behind.width).toBe(25);
    // Behind, the bar ends at the centre and its left edge is pulled back by its width.
    expect(behind.left).toBe(25);
  });

  /**
   * **The ruler is the scale it is handed, not a constant.** This is the whole point of the
   * rework: the same gap looks large in a table of small gaps and small in a table of large
   * ones, which is what a reader comparing places wants. A fixed divisor would draw both the
   * same, so the two assertions below must disagree.
   */
  it("measures reach against the scale it is given", () => {
    expect(divergingBar(10, 10, ANY_FOCUS).width).toBe(50);
    expect(divergingBar(10, 100, ANY_FOCUS).width).toBe(5);
  });

  it("never reaches past the middle of its own half", () => {
    expect(divergingBar(30, 30, ANY_FOCUS).width).toBe(50);
    expect(divergingBar(100, 30, ANY_FOCUS).width).toBe(50);
  });

  it("draws at least a stub for a real but tiny gap, and none at all for none", () => {
    // A gap far smaller than the scale still shows something, so a real difference is visible.
    expect(divergingBar(1, 1000, ANY_FOCUS).width).toBe(1.5);
    // With no scale to divide by, a gap is drawn as the same stub rather than vanishing.
    expect(divergingBar(5, 0, ANY_FOCUS).width).toBe(1.5);
    expect(divergingBar(0, 1000, ANY_FOCUS).width).toBe(0);
  });

  it("draws a short reach softer than a long one", () => {
    expect(divergingBar(10, 100, ANY_FOCUS).barOpacity).toBe(0.62);
    expect(divergingBar(30, 100, ANY_FOCUS).barOpacity).toBe(1);
  });

  /**
   * The tint is judged against the focus's own value, not the shared scale: a five-point gap
   * is noise on a figure of a hundred and half the figure on a figure of ten.
   */
  it("does not tint a gap smaller than a twentieth of the focus", () => {
    const noise = divergingBar(4.9, ANY_SCALE, 100);
    expect(noise.alpha).toBe(0);
    expect(noise.faint).toBe(true);
  });

  it("tints from exactly a twentieth of the focus upward", () => {
    // 5% of the focus is the threshold: at it the cell lights, just below it it does not.
    expect(divergingBar(5, ANY_SCALE, 100).faint).toBe(false);
    expect(divergingBar(5, ANY_SCALE, 100).alpha).toBeGreaterThan(0);
    expect(divergingBar(4.99, ANY_SCALE, 100).faint).toBe(true);
  });

  it("tints more strongly the larger the gap is relative to the focus, without steps", () => {
    const gentle = divergingBar(10, ANY_SCALE, 100).alpha;
    const firmer = divergingBar(20, ANY_SCALE, 100).alpha;
    expect(gentle).toBeGreaterThan(0);
    expect(firmer).toBeGreaterThan(gentle);
    expect(divergingBar(13, ANY_SCALE, 100).alpha).not.toBe(firmer);
  });

  it("never tints past the strongest the design goes to", () => {
    // 30% of the focus and beyond is the strongest; 0.09 + 0.33 = 0.42.
    expect(divergingBar(30, ANY_SCALE, 100).alpha).toBeCloseTo(0.42, 5);
    expect(divergingBar(90, ANY_SCALE, 100).alpha).toBeCloseTo(0.42, 5);
  });

  it("adds an edge only where the gap is a large share of the focus", () => {
    // Below 60% of the ramp: no edge. 10% of the focus is a fifth of the way up.
    expect(divergingBar(10, ANY_SCALE, 100).edge).toBe(false);
    // 24% of the focus is past 60% of the ramp.
    expect(divergingBar(24, ANY_SCALE, 100).edge).toBe(true);
  });

  it("cannot tint when there is no focus value to measure against", () => {
    expect(divergingBar(50, ANY_SCALE, null).alpha).toBe(0);
    expect(divergingBar(50, ANY_SCALE, 0).alpha).toBe(0);
  });
});

describe("the largest gap in a set of cells", () => {
  it("is the ruler every bar in the set is drawn against", () => {
    expect(
      maxAbsDelta([{ delta: 3 }, { delta: -11 }, { delta: 7 }]),
    ).toBe(11);
  });

  it("ignores the cells with nothing to compare", () => {
    expect(maxAbsDelta([{ delta: null }, { delta: 4 }])).toBe(4);
  });

  it("is zero when nothing has a gap", () => {
    expect(maxAbsDelta([{ delta: null }, { delta: null }])).toBe(0);
    expect(maxAbsDelta([])).toBe(0);
  });
});
