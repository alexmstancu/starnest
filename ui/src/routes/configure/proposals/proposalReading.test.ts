import { describe, expect, it } from "vitest";
import { describePass, describePeriod } from "./proposalReading";

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

/**
 * UI-14. **A research pass spends money**, and the response says how much and whether it
 * stopped at the cap -- which the screen threw away, so a pass halted half way looked finished.
 */
describe("what the last research pass did", () => {
  it("says what it spent and how many calls it made", () => {
    expect(
      describePass({ cost_eur: 0.04, calls: 2, halted_on_spend_cap: false }),
    ).toBe("The last pass made 2 calls and spent €0.04.");
  });

  it("counts one call as one call", () => {
    expect(
      describePass({ cost_eur: 0.02, calls: 1, halted_on_spend_cap: false }),
    ).toBe("The last pass made 1 call and spent €0.02.");
  });

  it("says plainly when it stopped at the spend cap", () => {
    expect(
      describePass({ cost_eur: 9.98, calls: 240, halted_on_spend_cap: true }),
    ).toBe(
      "The last pass stopped at the spend cap: it made 240 calls and spent €9.98, and the gates after that were not asked.",
    );
  });

  it("says a pass that asked nothing charged nothing", () => {
    expect(
      describePass({ cost_eur: 0, calls: 0, halted_on_spend_cap: false }),
    ).toBe("The last pass made no calls and spent nothing.");
  });
});
