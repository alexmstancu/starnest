import { describe, expect, it } from "vitest";
import { judgementsByAttribute } from "./pillarFilter";

describe("what the active set has decided about an attribute", () => {
  const criteria = [
    { attribute: "country.rent", weight: 40, blocks_if_missing: true },
    { attribute: "country.sun", weight: 60 },
  ];

  it("says which attributes the candidate cannot be scored without", () => {
    const judged = judgementsByAttribute(criteria);
    expect(judged.get("country.rent")?.required).toBe(true);
    expect(judged.get("country.sun")?.required).toBe(false);
  });

  /**
   * **Absent, not zero.** An attribute this set does not score is not judged here at all, and
   * a zero would read as "worth nothing" -- which is a different claim (`reqs.md` 3.0).
   */
  it("says nothing at all about an attribute the set does not score", () => {
    expect(judgementsByAttribute(criteria).get("country.noise")).toBeUndefined();
  });

  it("says the set scores a criterion unless the criterion says otherwise", () => {
    expect(judgementsByAttribute(criteria).get("country.rent")?.scored).toBe(true);
  });

  /** UI-15. **An excluded criterion judges and does not count** (`reqs.md` 5.3). */
  it("says a criterion the set does not score is not scored", () => {
    const judged = judgementsByAttribute([
      { attribute: "country.climate_zone", is_scored: false },
    ]).get("country.climate_zone");

    expect(judged?.scored).toBe(false);
  });

  it("is empty when there is no set yet", () => {
    expect(judgementsByAttribute(null).size).toBe(0);
  });
});
