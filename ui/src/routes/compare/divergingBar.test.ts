import { describe, expect, it } from "vitest";
import { barStart, divergingBar } from "./divergingBar";

describe("the diverging bar", () => {
  it("is level when there is no difference", () => {
    expect(divergingBar(0)).toEqual({
      direction: "level",
      strength: 0,
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
    expect(small.strength).toBe(0);
    expect(small.reach).toBeGreaterThan(0);
  });

  it("tints more strongly the wider the gap", () => {
    expect(divergingBar(7).strength).toBe(1);
    expect(divergingBar(18).strength).toBe(2);
    expect(divergingBar(28).strength).toBe(3);
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
