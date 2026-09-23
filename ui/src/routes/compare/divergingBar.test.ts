import { describe, expect, it } from "vitest";
import { barStart, divergingBar } from "./divergingBar";

describe("the diverging bar", () => {
  it("is level when there is no difference", () => {
    expect(divergingBar(0)).toEqual({
      direction: "level",
      alpha: 0,
      edge: false,
      reach: 0,
    });
  });

  it("is level when there is no figure to compare", () => {
    expect(divergingBar(null).direction).toBe("level");
    expect(divergingBar(undefined).direction).toBe("level");
    expect(divergingBar(Number.NaN).direction).toBe("level");
  });

  it("goes right when ahead and left when behind", () => {
    expect(divergingBar(12).direction).toBe("ahead");
    expect(divergingBar(-12).direction).toBe("behind");
  });

  /**
   * The bar is drawn for any difference; only the tint waits. A cell tinted for a two-point
   * gap claims a difference the arithmetic does not support.
   */
  it("draws a small difference without tinting it", () => {
    const small = divergingBar(3);
    expect(small.alpha).toBe(0);
    expect(small.reach).toBeGreaterThan(0);
  });

  /** Continuous, so 11 and 13 are not drawn as the same claim. */
  it("tints more strongly the wider the gap, without steps", () => {
    const gentle = divergingBar(7).alpha;
    const firmer = divergingBar(11).alpha;
    const firmest = divergingBar(28).alpha;
    expect(gentle).toBeGreaterThan(0);
    expect(firmer).toBeGreaterThan(gentle);
    expect(firmest).toBeGreaterThan(firmer);
    expect(divergingBar(13).alpha).not.toBe(firmer);
  });

  it("never tints past the strongest the design goes to", () => {
    expect(divergingBar(200).alpha).toBeCloseTo(0.42, 5);
  });

  /** A border only where the cell is making a real claim, not on every tinted one. */
  it("adds an edge only at the top of the range", () => {
    expect(divergingBar(9).edge).toBe(false);
    expect(divergingBar(28).edge).toBe(true);
  });

  /** Past the full reach the bar stops rather than running out of its half of the track. */
  it("never reaches past the middle of its own half", () => {
    expect(divergingBar(30).reach).toBe(50);
    expect(divergingBar(100).reach).toBe(50);
    expect(divergingBar(-100).reach).toBe(50);
  });

  it("starts at the centre going right, and back from it going left", () => {
    expect(barStart(divergingBar(30))).toBe(50);
    expect(barStart(divergingBar(-30))).toBe(0);
    expect(barStart(divergingBar(0))).toBe(50);
  });
});
