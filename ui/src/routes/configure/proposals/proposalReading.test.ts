import { describe, expect, it } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "../../../api/ApiError";
import { describePass, describePeriod, spendIsKnown } from "./proposalReading";

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

/**
 * UI-14. **A failed pass may still have been billed.** A refusal in the contract's shape is the
 * server saying no before asking the model anything; any other failure can come after calls
 * that were paid for, and the response that would have said how many never arrived.
 */
describe("whether a failed research pass is known to have spent nothing", () => {
  it("knows a refusal in the contract's shape spent nothing", () => {
    expect(
      spendIsKnown(
        new ApiError({ code: "spend_cap_not_set", message: "no cap", status: 409 }),
      ),
    ).toBe(true);
    expect(
      spendIsKnown(
        new ApiError({ code: "invalid_request", message: "bad", status: 422 }),
      ),
    ).toBe(true);
  });

  it("does not know what a server failure spent", () => {
    expect(
      spendIsKnown(
        new ApiError({ code: "internal_error", message: "boom", status: 500 }),
      ),
    ).toBe(false);
  });

  it("does not know what a pass the proxy timed out spent", () => {
    expect(
      spendIsKnown(
        new ApiError({
          code: CLIENT_ERROR_CODES.malformedError,
          message: "HTML",
          status: 504,
        }),
      ),
    ).toBe(false);
  });

  it("does not know what a pass spent when the backend could not be reached", () => {
    expect(
      spendIsKnown(
        new ApiError({ code: CLIENT_ERROR_CODES.unreachable, message: "gone" }),
      ),
    ).toBe(false);
  });

  it("does not trust a 4xx whose body is not the contract's shape", () => {
    expect(
      spendIsKnown(
        new ApiError({
          code: CLIENT_ERROR_CODES.malformedError,
          message: "HTML",
          status: 413,
        }),
      ),
    ).toBe(false);
  });

  it("does not know what anything else spent", () => {
    expect(spendIsKnown(new Error("unexpected"))).toBe(false);
  });
});
