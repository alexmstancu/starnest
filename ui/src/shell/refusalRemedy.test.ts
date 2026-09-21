import { describe, expect, it } from "vitest";
import { SCORE_SCALE_NOT_SET, remedyFor } from "./refusalRemedy";

describe("the way out of a refusal", () => {
  /**
   * `reqs.md`: `score_scale_max` is provisional by design and has no default, so the shipped
   * state is unset and a ranking refuses until somebody sets it. Retrying cannot help; the
   * only thing that can is going to Configure.
   */
  it("sends an unset score scale to Configure", () => {
    expect(remedyFor(SCORE_SCALE_NOT_SET)).toEqual({
      label: "Set it in Configure",
      path: "/configure",
    });
  });

  it("sends a comparator over the limit to Configure", () => {
    expect(remedyFor("invalid_comparison")).toEqual({
      label: "Change it in Configure",
      path: "/configure",
    });
  });

  it("offers nothing for a refusal no setting fixes", () => {
    expect(remedyFor("not_found")).toBeNull();
    expect(remedyFor("weights_all_locked")).toBeNull();
  });

  it("offers nothing when there is no code at all", () => {
    expect(remedyFor("")).toBeNull();
  });

  /** Every remedy must point at a route the shell actually has. */
  it("only ever points at a real route", () => {
    for (const code of [SCORE_SCALE_NOT_SET, "invalid_comparison"]) {
      expect(remedyFor(code)?.path).toBe("/configure");
    }
  });
});
