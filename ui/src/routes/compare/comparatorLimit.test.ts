import { describe, expect, it } from "vitest";
import { droppedByLimit, withinLimit } from "./comparatorLimit";

const five = ["a", "b", "c", "d", "e"];

describe("keeping a selection inside the limit", () => {
  it("leaves a selection that already fits", () => {
    expect(withinLimit(["a", "b"], 5)).toEqual(["a", "b"]);
    expect(droppedByLimit(["a", "b"], 5)).toBe(0);
  });

  /** The last clicks are the ones somebody is currently thinking about. */
  it("trims to the newest when the limit drops below the selection", () => {
    expect(withinLimit(five, 2)).toEqual(["d", "e"]);
    expect(droppedByLimit(five, 2)).toBe(3);
  });

  it("empties the selection at a limit of zero", () => {
    expect(withinLimit(five, 0)).toEqual([]);
    expect(droppedByLimit(five, 0)).toBe(5);
  });

  /**
   * An unset limit is not a limit of zero. `comparator_limit` is nullable and null is the
   * shipped state; the server still refuses, and its refusal is what should appear rather
   * than a bound this screen invented.
   */
  it("treats an unset limit as no limit of its own", () => {
    expect(withinLimit(five, null)).toEqual(five);
    expect(withinLimit(five, undefined)).toEqual(five);
    expect(droppedByLimit(five, null)).toBe(0);
  });

  it("ignores a nonsense limit rather than acting on it", () => {
    expect(withinLimit(five, Number.NaN)).toEqual(five);
    expect(withinLimit(five, -1)).toEqual(five);
  });

  it("does not mutate the selection it was given", () => {
    const chosen = [...five];
    withinLimit(chosen, 1);
    expect(chosen).toEqual(five);
  });

  it("handles an empty selection", () => {
    expect(withinLimit([], 3)).toEqual([]);
    expect(droppedByLimit([], 3)).toBe(0);
  });
});
