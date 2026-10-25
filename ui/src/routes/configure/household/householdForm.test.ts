import { describe, expect, it } from "vitest";
import type { Household } from "../../../api/endpoints";
import {
  NOTHING_RECORDED,
  citizenshipsIn,
  draftOf,
  householdFrom,
  invalidHouseholdFields,
  isIncomplete,
  type HouseholdDraft,
} from "./householdForm";

/**
 * The household form's arithmetic, tested without rendering anything.
 *
 * **This is what the split bought.** These cases used to be reachable only by driving the whole
 * screen: eight requests, a render, and a click, to find out whether an empty field becomes
 * null or zero. They are now a function call.
 */

const A_HOUSEHOLD: Household = {
  net_income: 90000,
  number_adults: 2,
  number_children: 1,
  target_monthly_spend: 2800,
  max_rent: 1500,
  home_country_candidate: "country.romania",
  home_city_candidate: null,
  citizenships: ["country.romania", "country.italy"],
};

function draft(overrides: Partial<HouseholdDraft> = {}): HouseholdDraft {
  return { ...draftOf(A_HOUSEHOLD), ...overrides };
}

describe("a record becoming a draft", () => {
  it("holds every number as the text of an input", () => {
    expect(draftOf(A_HOUSEHOLD).net_income).toBe("90000");
    expect(draftOf(A_HOUSEHOLD).number_children).toBe("1");
  });

  it("joins the citizenships into one field", () => {
    expect(draftOf(A_HOUSEHOLD).citizenships).toBe(
      "country.romania, country.italy",
    );
  });

  it("shows an absent optional field as empty rather than as zero", () => {
    const without = {
      ...A_HOUSEHOLD,
      max_rent: undefined,
      target_monthly_spend: undefined,
    };

    expect(draftOf(without).max_rent).toBe("");
    expect(draftOf(without).target_monthly_spend).toBe("");
  });

  it("shows a household nobody has recorded as blank throughout", () => {
    const blank = draftOf(NOTHING_RECORDED);

    expect(Object.values(blank).every((field) => field === "")).toBe(true);
  });

  it("shows no city rather than an empty one when there is none", () => {
    expect(draftOf(A_HOUSEHOLD).home_city_candidate).toBe("");
  });
});

describe("a draft becoming a record", () => {
  it("reads the required numbers", () => {
    const record = householdFrom(
      draft({ net_income: "70000", number_adults: "2" }),
    );

    expect(record.net_income).toBe(70000);
    expect(record.number_adults).toBe(2);
  });

  it("leaves an emptied optional field absent, never zero", () => {
    /** A target spend of 0 would be a decision, and nobody made it. */
    const record = householdFrom(
      draft({ max_rent: "", target_monthly_spend: "" }),
    );

    expect(record.max_rent).toBeUndefined();
    expect(record.target_monthly_spend).toBeUndefined();
  });

  it("sends no city rather than a city called nothing", () => {
    expect(
      householdFrom(draft({ home_city_candidate: "   " })).home_city_candidate,
    ).toBeNull();
  });

  it("splits the citizenships and drops the spaces between them", () => {
    const record = householdFrom(
      draft({ citizenships: " country.romania ,country.italy , " }),
    );

    expect(record.citizenships).toEqual(["country.romania", "country.italy"]);
  });

  it("trims the home country, because a trailing space is not part of an identifier", () => {
    expect(
      householdFrom(draft({ home_country_candidate: " country.spain " }))
        .home_country_candidate,
    ).toBe("country.spain");
  });
});

describe("what the form needs before it will send anything", () => {
  it("is complete when the five required fields are filled in", () => {
    expect(isIncomplete(draft())).toBe(false);
  });

  it.each([
    ["net_income"],
    ["number_adults"],
    ["number_children"],
    ["home_country_candidate"],
    ["citizenships"],
  ] as const)("is incomplete without %s", (field) => {
    expect(isIncomplete(draft({ [field]: "" }))).toBe(true);
  });

  it("is incomplete when a required field holds only spaces", () => {
    expect(isIncomplete(draft({ number_adults: "   " }))).toBe(true);
  });

  it("is complete without the two optional fields", () => {
    expect(
      isIncomplete(draft({ max_rent: "", target_monthly_spend: "" })),
    ).toBe(false);
  });

  it("counts a list of empty entries as no citizenship at all", () => {
    expect(citizenshipsIn(draft({ citizenships: " , , " }))).toEqual([]);
    expect(isIncomplete(draft({ citizenships: " , , " }))).toBe(true);
  });
});

/**
 * PL-024 (UF-026). **What was typed is read, or refused; never filtered.** The filter that
 * stood here kept the digits of "about 2000", read "1250,75" as 1250.75 and "72,000" as 72.
 */
describe("what a money field reads", () => {
  it.each([
    ["about 2000 a month"],
    ["€2000"],
    ["72,000"],
    ["1250,75"],
    ["1.2.3"],
    ["-500"],
    ["72.000"],
    ["1e5"],
  ])("refuses %s rather than reading part of it", (typed) => {
    expect(invalidHouseholdFields(draft({ net_income: typed }))).toEqual(["net_income"]);
    expect(invalidHouseholdFields(draft({ max_rent: typed }))).toEqual(["max_rent"]);
  });

  it("reads euros and cents", () => {
    expect(householdFrom(draft({ net_income: "1250.75" })).net_income).toBe(1250.75);
  });

  it("shows a stored figure with cents only where it has any", () => {
    expect(draftOf({ ...A_HOUSEHOLD, net_income: 72000 }).net_income).toBe("72000");
    expect(draftOf({ ...A_HOUSEHOLD, net_income: 72000.5 }).net_income).toBe("72000.50");
  });

  it("refuses to turn a field it would refuse into a number", () => {
    expect(() => householdFrom(draft({ max_rent: "72,000" }))).toThrow();
    expect(() => householdFrom(draft({ net_income: "" }))).toThrow();
  });
});

/** PL-028. The contract's ranges: money and children from 0, adults from 1, all whole counts. */
describe("a household figure outside its range", () => {
  it.each([
    ["number_adults", "0"],
    ["number_adults", "1.5"],
    ["number_children", "-1"],
    ["target_monthly_spend", "-1"],
  ] as const)("holds %s at %s", (field, typed) => {
    expect(invalidHouseholdFields(draft({ [field]: typed }))).toEqual([field]);
  });

  it("accepts each field at its lower edge", () => {
    expect(
      invalidHouseholdFields(
        draft({ net_income: "0", number_adults: "1", number_children: "0", max_rent: "0" }),
      ),
    ).toEqual([]);
  });

  it("leaves a blank required field to the completeness check, not the invalid list", () => {
    expect(invalidHouseholdFields(draft({ net_income: "" }))).toEqual([]);
  });
});

/** UI-10. A lone point in a money field sent NaN, which JSON writes as null: a cleared rent. */
describe("a household field that holds no number", () => {
  it("calls a maximum rent of a lone point invalid rather than unset", () => {
    expect(invalidHouseholdFields(draft({ max_rent: "." }))).toEqual([
      "max_rent",
    ]);
  });

  it("names a required figure too long to be finite", () => {
    expect(
      invalidHouseholdFields(draft({ net_income: "9".repeat(400) })),
    ).toEqual(["net_income"]);
  });

  it("finds nothing invalid in a household of numbers and blanks", () => {
    expect(
      invalidHouseholdFields(draft({ target_monthly_spend: "" })),
    ).toEqual([]);
  });
});
