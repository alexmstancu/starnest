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

  /** The design draws a tie on its track, muted, and draws no track where a figure is missing. */
  it("gauges a tie, and not a missing figure", () => {
    const tie = divergingBar(0, ANY_SCALE, ANY_FOCUS);
    expect(tie.gauged).toBe(true);
    expect(tie.faint).toBe(true);

    const missing = divergingBar(null, ANY_SCALE, ANY_FOCUS);
    expect(missing.gauged).toBe(false);
    // Whether a missing figure is muted depends on whose is missing, which only the cell knows.
    expect(missing.faint).toBe(false);
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
   * **A longer bar is also a darker one** -- the design's ramp, pale to mid to deep along
   * `reach ** 0.7` -- so two long gaps of different lengths do not read as the same colour.
   */
  it("deepens the bar's colour with its reach", () => {
    // A tenth of the scale is 0.2 of the ramp: two fifths of the way from pale to mid.
    const short = divergingBar(-10, 100, ANY_FOCUS).shade;
    expect(short).toMatchObject({ base: "pale", over: "mid" });
    expect(short.amount).toBeCloseTo(0.399, 3);

    // Half the scale is 0.62 of the ramp: past mid, on the way to deep.
    const half = divergingBar(50, 100, ANY_FOCUS).shade;
    expect(half).toMatchObject({ base: "mid", over: "deep" });
    expect(half.amount).toBeCloseTo(0.231, 3);

    // The whole scale stops a hair short of the deepest stop, as the design's ramp does.
    const full = divergingBar(-100, 100, ANY_FOCUS).shade;
    expect(full).toMatchObject({ base: "mid", over: "deep" });
    expect(full.amount).toBeCloseTo(0.998, 3);
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

  /**
   * **The tint follows the bar**: the same ruler, the largest gap on screen, so a longer bar is
   * always a stronger tint whatever share of the focus each gap is.
   */
  it("tints more strongly the longer the bar, without steps", () => {
    const shorter = divergingBar(20, 80, 100).alpha;
    const longer = divergingBar(40, 80, 100).alpha;
    expect(longer).toBeGreaterThan(shorter);
    expect(divergingBar(30, 80, 100).alpha).not.toBe(longer);
    // The same gap is a weaker tint among larger gaps, where its bar is shorter.
    expect(divergingBar(20, 160, 100).alpha).toBeLessThan(shorter);
  });

  /**
   * The case that set the range: large gaps behind the focus, -46 to -65 on a ruler of 80, all
   * drew one red under the design's cap at 30% of the focus, and reds the eye could not tell
   * apart across a span of 0.33.
   */
  it("tells two long gaps apart when their bars differ", () => {
    const shorter = divergingBar(-46, 80, 83).alpha;
    const longer = divergingBar(-65, 80, 97).alpha;
    expect(longer - shorter).toBeGreaterThan(0.1);
  });

  it("tints the longest bar on screen the strongest, and nothing past it", () => {
    // 0.09 + 0.45 at the full reach; a gap beyond the scale reaches no further.
    expect(divergingBar(80, 80, 100).alpha).toBeCloseTo(0.54, 5);
    expect(divergingBar(120, 80, 100).alpha).toBeCloseTo(0.54, 5);
  });

  it("adds an edge only on the longest bars", () => {
    // Under 60% of the largest gap there is no edge, however large a share of the focus.
    expect(divergingBar(40, 80, 50).edge).toBe(false);
    expect(divergingBar(50, 80, 100).edge).toBe(true);
    // Noise takes none, however far its bar reaches.
    expect(divergingBar(40, 40, 1000).edge).toBe(false);
  });

  it("draws the edge deeper the longer the bar, and not at all below the top band", () => {
    expect(divergingBar(40, 80, 100).borderAlpha).toBe(0);
    // 0.76 of the largest gap: 0.45 + 0.35 * 0.76.
    expect(divergingBar(-60.8, 80, 100).borderAlpha).toBeCloseTo(0.716, 5);
    expect(divergingBar(80, 80, 100).borderAlpha).toBeCloseTo(0.8, 5);
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
