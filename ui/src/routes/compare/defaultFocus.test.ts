import { describe, expect, it } from "vitest";
import { homeIn, topOfRanking } from "./defaultFocus";

const roster = new Set(["country.romania", "country.portugal", "country.spain"]);

describe("where Compare opens (PL-102)", () => {
  it("is home, at whichever level home is a candidate", () => {
    expect(
      homeIn(roster, { home_country_candidate: "country.romania", home_city_candidate: "city.cluj" }),
    ).toBe("country.romania");
    expect(
      homeIn(new Set(["city.cluj"]), {
        home_country_candidate: "country.romania",
        home_city_candidate: "city.cluj",
      }),
    ).toBe("city.cluj");
  });

  it("has no home where the household is unknown or lives elsewhere", () => {
    expect(homeIn(roster, null)).toBeNull();
    expect(homeIn(roster, { home_country_candidate: "country.malta", home_city_candidate: null })).toBeNull();
  });

  it("is otherwise the first ranked candidate the roster holds", () => {
    const ranking = {
      candidates: [{ candidate: "country.gone" }, { candidate: "country.spain" }],
    };

    expect(topOfRanking(roster, ranking)).toBe("country.spain");
    expect(topOfRanking(roster, { candidates: [] })).toBeNull();
    expect(topOfRanking(roster, null)).toBeNull();
  });
});
