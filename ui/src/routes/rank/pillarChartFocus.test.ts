import { describe, expect, it } from "vitest";
import { barReachedBy, tabStopOf } from "./pillarChartFocus";

describe("the bar a key moves the keyboard to", () => {
  it.each([
    ["ArrowRight", 5],
    ["ArrowLeft", 3],
    ["Home", 0],
    ["End", 10],
  ])("%s from the fifth of eleven bars reaches bar %i", (key, reached) => {
    expect(barReachedBy(key, 4, 11)).toBe(reached);
  });

  /** The chart is an axis, so its ends are ends: Home and End are one key away. */
  it("stops at either end rather than wrapping round", () => {
    expect(barReachedBy("ArrowRight", 10, 11)).toBe(10);
    expect(barReachedBy("ArrowLeft", 0, 11)).toBe(0);
  });

  it("stays put in a chart of one bar", () => {
    expect(barReachedBy("ArrowRight", 0, 1)).toBe(0);
    expect(barReachedBy("End", 0, 1)).toBe(0);
  });

  /** Up and Down still scroll, and Tab still leaves: the chart claims only what it uses. */
  it.each(["ArrowUp", "ArrowDown", "Tab", "Enter", " ", "a"])(
    "leaves %j to the browser",
    (key) => {
      expect(barReachedBy(key, 4, 11)).toBeNull();
    },
  );
});

describe("the one bar Tab reaches", () => {
  const bars = ["economics", "safety", "family"];

  it("is the bar the keyboard is on", () => {
    expect(tabStopOf(bars, "family", "safety")).toBe("family");
  });

  it("is the chosen bar when the keyboard is elsewhere", () => {
    expect(tabStopOf(bars, null, "safety")).toBe("safety");
  });

  it("is the first bar when nothing is chosen", () => {
    expect(tabStopOf(bars, null, null)).toBe("economics");
  });

  /** A re-read can drop a pillar; the chart must still have a stop rather than none. */
  it("passes over a pillar the chart no longer draws", () => {
    expect(tabStopOf(bars, "housing", "climate")).toBe("economics");
    expect(tabStopOf(bars, "housing", "safety")).toBe("safety");
  });

  it("is nothing in a chart with no bars", () => {
    expect(tabStopOf([], "safety", "safety")).toBeUndefined();
  });
});
