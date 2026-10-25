import { describe, expect, it } from "vitest";
import { optionsFor, pairsPicked, pickedLabel } from "./scopePicker";

describe("what a picker acquires (PL-125)", () => {
  const CATALOG = {
    candidates: [
      { id: "country.spain", name: "Spain" },
      { id: "country.malta", name: "Malta" },
    ],
    attributes: [
      { id: "country.rent", name: "Rent", pillar: "housing" },
      { id: "country.tax", name: "Tax", pillar: "economics" },
      { id: "country.unfiled", name: "Unfiled", pillar: null },
    ],
  };
  const PILLARS = {
    names: new Map([["economics", "Economy"]]),
    order: new Map([
      ["economics", 1],
      ["housing", 2],
    ]),
  };

  it("offers the pillars the level's attributes hold, in the catalog's order", () => {
    expect(optionsFor("pillar", CATALOG, PILLARS)).toEqual([
      { value: "economics", label: "Economy" },
      { value: "housing", label: "Housing" },
    ]);
  });

  it("asks one pillar's attributes of every candidate", () => {
    expect(pairsPicked("pillar", "housing", CATALOG)).toEqual([
      { candidate: "country.spain", attribute: "country.rent" },
      { candidate: "country.malta", attribute: "country.rent" },
    ]);
  });

  it("asks one candidate about every attribute", () => {
    expect(pairsPicked("candidate", "country.malta", CATALOG)).toHaveLength(3);
  });

  it("asks nothing, never the whole level, while nothing is picked", () => {
    expect(pairsPicked("attribute", "", CATALOG)).toEqual([]);
    expect(pickedLabel(0)).toBe("Estimate");
    expect(pickedLabel(1)).toBe("Estimate 1 item");
  });
});
