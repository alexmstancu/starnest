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

  it("sends a comparator over the limit to Configure (PL-007)", () => {
    expect(remedyFor("comparator_limit_exceeded")).toEqual({
      label: "Change it in Configure",
      path: "/configure",
    });
  });

  /** PL-120. A switched-off source is lifted at Source priority, a fresh scope at the refetch age. */
  it.each([
    ["no_source_switched_on", "Open Source priority in Configure"],
    ["sources_switched_off", "Open Source priority in Configure"],
    ["still_fresh", "Change it in Configure"],
  ])("sends nothing to fetch for %s to Configure", (reason, label) => {
    expect(remedyFor("nothing_to_fetch", { reason })).toEqual({ label, path: "/configure" });
  });

  it.each(["empty_scope", "nothing_answerable", undefined])(
    "offers nothing for nothing to fetch for %s, which no setting lifts",
    (reason) => {
      expect(remedyFor("nothing_to_fetch", reason === undefined ? {} : { reason })).toBeNull();
    },
  );

  it("offers nothing for a comparison refused for any other reason (PL-007)", () => {
    expect(remedyFor("invalid_comparison")).toBeNull();
  });

  it("sends a switched-off Manual entry to Configure, and not a refused attribute (PL-089)", () => {
    expect(remedyFor("manual_entry_switched_off")).toEqual({
      label: "Switch it on in Configure",
      path: "/configure",
    });
    expect(remedyFor("manual_entry_not_permitted")).toBeNull();
  });

  it("sends a set that cannot be ranked to Configure (PL-006)", () => {
    expect(remedyFor("cannot_be_ranked")?.path).toBe("/configure");
  });

  it("sends an anchor above the score range to Configure, and no other invalid rule", () => {
    expect(remedyFor("invalid_criterion", { reason: "anchor_above_scale" })).toEqual({
      label: "Set it in Configure",
      path: "/configure",
    });
    expect(remedyFor("invalid_criterion")).toBeNull();
  });

  /**
   * NEW-26. `comparator_limit` has no default either, so a fresh installation refuses every
   * comparison with `comparator_limit_not_set` until somebody sets it. Only
   * `invalid_comparison` had a way out -- the code the mock used to answer in its place.
   */
  it("sends an unset comparator limit to Configure", () => {
    expect(remedyFor("comparator_limit_not_set")).toEqual({
      label: "Set it in Configure",
      path: "/configure",
    });
  });

  /** A code is an identifier, not prose: something that merely resembles one is not it. */
  it("offers nothing for a code that only resembles the unset limit", () => {
    expect(remedyFor("comparator_limit")).toBeNull();
    expect(remedyFor("COMPARATOR_LIMIT_NOT_SET")).toBeNull();
    expect(remedyFor(" comparator_limit_not_set")).toBeNull();
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
    for (const code of [
      SCORE_SCALE_NOT_SET,
      "comparator_limit_exceeded",
      "comparator_limit_not_set",
      "cannot_be_ranked",
    ]) {
      expect(remedyFor(code)?.path).toBe("/configure");
    }
  });
});
