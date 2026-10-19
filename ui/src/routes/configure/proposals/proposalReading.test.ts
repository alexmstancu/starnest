import { describe, expect, it } from "vitest";
import { describePeriod } from "./proposalReading";

/**
 * UI-13. **A proposal can hold for a period**, and confirming one used to drop it: the row never
 * showed it, so nobody could see what was lost.
 */
describe("the period a proposed answer holds for", () => {
  it("reads as the two dates it runs between", () => {
    expect(describePeriod({ start: "2026-01-01", end: "2026-12-31" })).toBe(
      "1 Jan 2026 to 31 Dec 2026",
    );
  });

  it("says nobody recorded one, rather than leaving a blank", () => {
    expect(describePeriod(null)).toBe("No period recorded");
    expect(describePeriod(undefined)).toBe("No period recorded");
  });
});
