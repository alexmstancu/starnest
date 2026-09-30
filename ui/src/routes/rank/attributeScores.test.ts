import { describe, expect, it } from "vitest";
import { scoresByAttribute } from "./attributeScores";

describe("what each attribute put into the total", () => {
  it("reads all three figures off one row", () => {
    const readings = scoresByAttribute([
      {
        attribute: "country.rent",
        normalised_score: 73,
        effective_weight: 12.5,
        contribution: 9.125,
      },
    ]);

    expect(readings.get("country.rent")).toEqual({
      score: "73",
      weightUsed: "12.5%",
      pointsAdded: "+9.1",
    });
  });

  it("marks a score absent rather than zero when nothing scored", () => {
    // A figure the pass could not score did not score badly -- it dropped out, and its share
    // spread over the attributes that had one. A nought there would read as a judgement.
    const readings = scoresByAttribute([
      { attribute: "country.rent", normalised_score: null, effective_weight: 0, contribution: 0 },
    ]);

    expect(readings.get("country.rent")?.score).toBe("—");
    // Zero weight and zero points are real figures, and they are printed.
    expect(readings.get("country.rent")?.weightUsed).toBe("0.0%");
    expect(readings.get("country.rent")?.pointsAdded).toBe("0.0");
  });

  it("signs a contribution, because a positive one is a claim", () => {
    const readings = scoresByAttribute([
      { attribute: "a", contribution: 4.9 },
      { attribute: "b", contribution: -2.25 },
    ]);

    expect(readings.get("a")?.pointsAdded).toBe("+4.9");
    expect(readings.get("b")?.pointsAdded).toBe("-2.3");
  });

  it("says nothing about a figure the row left out", () => {
    const readings = scoresByAttribute([{ attribute: "country.rent" }]);

    expect(readings.get("country.rent")).toEqual({
      score: "—",
      weightUsed: "—",
      pointsAdded: "—",
    });
  });

  it("has nothing for a candidate whose detail has not arrived", () => {
    expect(scoresByAttribute(null).size).toBe(0);
    expect(scoresByAttribute(undefined).size).toBe(0);
    expect(scoresByAttribute([]).size).toBe(0);
  });

  it("keeps the last row when an attribute appears twice", () => {
    // Never reached against the server, which reports one row per attribute. Pinned so that a
    // map built from a list cannot silently keep whichever came first.
    const readings = scoresByAttribute([
      { attribute: "a", normalised_score: 1 },
      { attribute: "a", normalised_score: 2 },
    ]);

    expect(readings.get("a")?.score).toBe("2");
  });
});
