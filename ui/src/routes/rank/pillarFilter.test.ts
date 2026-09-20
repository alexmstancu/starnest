import { describe, expect, it } from "vitest";
import { pillarsByAttribute, valuesInPillar } from "./pillarFilter";

const CRITERIA = [
  { attribute: "country.cost_of_living_index", pillar: "economics" },
  { attribute: "country.overcrowding_rate", pillar: "housing" },
];

const VALUES = [
  { attribute: "country.cost_of_living_index" },
  { attribute: "country.overcrowding_rate" },
  { attribute: "country.climate_zone" }, // descriptive: no criterion, no pillar
];

describe("the attribute-to-pillar map", () => {
  it("is built from the set's own criteria", () => {
    expect(pillarsByAttribute(CRITERIA).get("country.overcrowding_rate")).toBe("housing");
  });

  it("is empty rather than undefined when the set has not loaded", () => {
    expect(pillarsByAttribute(null).size).toBe(0);
    expect(pillarsByAttribute(undefined).size).toBe(0);
  });
});

describe("filtering the stored values", () => {
  const map = pillarsByAttribute(CRITERIA);

  it("returns everything when no pillar is chosen", () => {
    expect(valuesInPillar(VALUES, map, null)).toHaveLength(3);
  });

  it("returns only the values that pillar scores", () => {
    expect(valuesInPillar(VALUES, map, "housing").map((v) => v.attribute)).toEqual([
      "country.overcrowding_rate",
    ]);
  });

  it("leaves a descriptive attribute out of every pillar", () => {
    /** It has no criterion by definition, so it contributes to no pillar's score. Showing it
        under one would imply it counted. */
    const everywhere = ["economics", "housing"].flatMap((p) => valuesInPillar(VALUES, map, p));
    expect(everywhere.map((v) => v.attribute)).not.toContain("country.climate_zone");
  });

  it("returns nothing for a pillar with no scored values, rather than everything", () => {
    expect(valuesInPillar(VALUES, map, "family")).toEqual([]);
  });

  it("does not mutate what it was given", () => {
    const copy = [...VALUES];
    valuesInPillar(VALUES, map, "economics");
    expect(VALUES).toEqual(copy);
  });
});
