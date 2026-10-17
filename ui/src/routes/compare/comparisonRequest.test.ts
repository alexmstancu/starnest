import { describe, expect, it } from "vitest";
import { requestFor } from "./comparisonRequest";

describe("what Compare would ask for", () => {
  it("asks for nothing without a focus", () => {
    expect(requestFor(null, ["country.spain"])).toBeNull();
  });

  /** The focus picker's placeholder is the empty string: a cleared focus, not a candidate. */
  it("asks for nothing when the focus was cleared back to the placeholder", () => {
    expect(requestFor("", ["country.spain"])).toBeNull();
  });

  it("asks for nothing without a comparator", () => {
    expect(requestFor("country.portugal", [])).toBeNull();
  });

  it("asks for the focus against every comparator, in the order they were picked", () => {
    expect(
      requestFor("country.portugal", ["country.spain", "country.netherlands"]),
    ).toEqual({
      focus: "country.portugal",
      comparators: ["country.spain", "country.netherlands"],
    });
  });

  /** The request outlives the render that built it, so it must not share the caller's list. */
  it("sends a list of its own, not the caller's", () => {
    const picked = ["country.spain"];

    const request = requestFor("country.portugal", picked);
    picked.push("country.netherlands");

    expect(request?.comparators).toEqual(["country.spain"]);
  });
});
