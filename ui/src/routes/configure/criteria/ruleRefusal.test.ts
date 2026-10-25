import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api/ApiError";
import { anEmptyAnchor, type RuleDraft } from "./criterionForm";
import { refusalOf } from "./ruleRefusal";

/**
 * PL-026. A refused rule as its form reports it: the fields the server names marked, and why,
 * said once each -- in words a reader can act on, with the attribute named as the row names it.
 */

const DRAFT: RuleDraft = {
  goal: "minimise",
  normalisation_method: "fixed",
  blocks_if_missing: false,
  target_range_min: "",
  target_range_max: "",
  zero_score_below: "",
  zero_score_above: "",
  anchors: [anEmptyAnchor()],
  threshold_min: "",
  threshold_max: "",
  threshold_this_form_cannot_edit: null,
};
const NAMES = { attribute: "country.rent", title: "Rent" };

function refused(code: string, message: string, ...errors: unknown[]): ApiError {
  return new ApiError({ code, message, status: 422, details: { errors } });
}

describe("a refused rule, for its form", () => {
  it("lists a field the form does not edit, marking nothing for it", () => {
    const sentence = "country.rent takes no breakdown option without a reducer";
    const refusal = refusalOf(
      refused(
        "invalid_criterion",
        sentence,
        { location: ["body", "reducer_mode"], problem: sentence, kind: "invalid_criterion" },
        { location: ["body", "breakdown_option"], problem: sentence, kind: "invalid_criterion" },
      ),
      DRAFT,
      NAMES,
    );

    expect(refusal.sentences).toEqual(["Rent takes no breakdown option without a reducer"]);
    expect(refusal.marks).toEqual({});
  });

  it("says which field a bare bound is about when it lists it", () => {
    const refusal = refusalOf(
      refused(
        "invalid_request",
        "The request does not match what this operation accepts.",
        { location: ["body", "scale_anchors", "0", "score"], problem: "x", kind: "int_from_float" },
        { location: ["body", "reducer_mode"], problem: "y", kind: "enum" },
      ),
      DRAFT,
      NAMES,
    );

    expect(refusal.sentences).toEqual([
      "Scale anchors: A whole number.",
      "A figure: Not accepted as typed.",
    ]);
    expect(refusal.marks).toEqual({ anchors: "A whole number." });
  });

  it("says a refusal naming no field in the interface's words", () => {
    const refusal = refusalOf(new ApiError({ code: "client.unreachable", message: "x" }), DRAFT, NAMES);

    expect(refusal.sentences).toEqual([
      "The backend did not answer. Check that it is running, then try again.",
    ]);
    expect(refusal.draft).toBe(DRAFT);
  });
});
