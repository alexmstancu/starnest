import { describe, expect, it } from "vitest";
import { ApiError } from "./ApiError";
import { fieldProblems } from "./fieldProblems";

/**
 * T28-3's arithmetic (PL-028). A refusal about a field is said on that field, in words worded
 * from the validator's `kind` and `limit` -- never its own sentence, and never a code.
 */

function refused(...errors: unknown[]): ApiError {
  return new ApiError({
    code: "invalid_request",
    message: "The request does not match what this operation accepts.",
    status: 422,
    details: { errors },
  });
}

describe("a refusal's field problems", () => {
  it("words each bound from its kind and limit, keyed by the body field", () => {
    const problems = fieldProblems(
      refused(
        {
          location: ["body", "min_coverage"],
          problem: "Input should be less than or equal to 100",
          kind: "less_than_equal",
          limit: 100,
        },
        {
          location: ["body", "comparator_limit"],
          problem: "Input should be greater than or equal to 1",
          kind: "greater_than_equal",
          limit: 1,
        },
      ),
    );

    expect(Object.fromEntries(problems)).toEqual({
      min_coverage: "At most 100.",
      comparator_limit: "At least 1.",
    });
  });

  it.each([
    ["greater_than", 0, "More than 0."],
    ["less_than", 5, "Less than 5."],
    ["int_from_float", undefined, "A whole number."],
    ["int_parsing", undefined, "A whole number."],
    ["float_parsing", undefined, "A number."],
    ["finite_number", undefined, "A finite number."],
    ["missing", undefined, "Required."],
    ["too_short", undefined, "At least one is required."],
  ])("says %s as a sentence", (kind, limit, sentence) => {
    const problems = fieldProblems(
      refused({ location: ["body", "net_income"], problem: "x", kind, limit }),
    );

    expect(problems.get("net_income")).toBe(sentence);
  });

  it("falls back to the field's own range for a kind it does not know, never the validator's words", () => {
    const problems = fieldProblems(
      refused({
        location: ["body", "comparator_limit"],
        problem: "Something Pydantic renamed",
        kind: "brand_new_kind",
      }),
      { comparator_limit: "From 1 to 20." },
    );

    expect(problems.get("comparator_limit")).toBe("From 1 to 20.");
  });

  it("says the field was refused when it knows neither the kind nor the field's range", () => {
    const problems = fieldProblems(
      refused({ location: ["body", "max_rent"], problem: "secret words", kind: "odd" }),
    );

    expect(problems.get("max_rent")).toBe("Not accepted as typed.");
  });

  it("keeps the first problem for a field the server names twice", () => {
    const problems = fieldProblems(
      refused(
        { location: ["body", "citizenships", "0"], problem: "x", kind: "missing" },
        { location: ["body", "citizenships", "1"], problem: "y", kind: "too_short" },
      ),
    );

    expect(Object.fromEntries(problems)).toEqual({ citizenships: "Required." });
  });

  it.each<[string, unknown]>([
    ["not an ApiError", new Error("boom")],
    ["nothing", null],
    ["no details", new ApiError({ code: "invalid_request", message: "m", status: 422 })],
    [
      "errors that are not a list",
      new ApiError({ code: "invalid_request", message: "m", details: { errors: "x" } }),
    ],
    [
      "a malformed entry",
      refused(
        { location: "body.max_rent", kind: "missing" },
        { location: ["body"], kind: "missing" },
        { location: ["body", 3], kind: "missing" },
        { location: ["body", "max_rent"] },
        "missing",
      ),
    ],
    ["a problem outside the body", refused({ location: ["query", "level"], kind: "missing" })],
  ])("finds no field problem in %s", (_, error) => {
    expect(fieldProblems(error).size).toBe(0);
  });
});
