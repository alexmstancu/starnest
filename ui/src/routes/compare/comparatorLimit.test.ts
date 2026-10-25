import { describe, expect, it } from "vitest";
import { knownLimit } from "./comparatorLimit";

describe("the comparator limit Compare acts on", () => {
  it.each([1, 5, 20])("takes %s, a limit Configure can hold", (limit) => {
    expect(knownLimit(limit)).toBe(limit);
  });

  it.each([
    ["unset", null],
    ["missing", undefined],
    ["zero", 0],
    ["above twenty", 21],
    ["negative", -1],
    ["fractional", 2.5],
    ["not a number", Number.NaN],
  ])("treats a limit that is %s as unknown", (_what, limit) => {
    expect(knownLimit(limit)).toBeNull();
  });
});
