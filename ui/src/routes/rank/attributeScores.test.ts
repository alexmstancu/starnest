import { describe, expect, it } from "vitest";
import { figureInUse, scoresByAttribute, weightUsedTone } from "./attributeScores";

describe("what each attribute put into the total", () => {
  it("reads all three figures off one row", () => {
    const readings = scoresByAttribute([
      {
        attribute: "country.rent",
        normalised_score: 73,
        weight: 11.25,
        effective_weight: 12.5,
        contribution: 9.125,
      },
    ]);

    expect(readings.get("country.rent")).toEqual({
      score: "73",
      weight: "11.3%",
      weightUsed: "12.5%",
      weightUsedTone: "moved",
      pointsAdded: "+9.1",
      placed: true,
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
    expect(readings.get("b")?.pointsAdded).toBe("\u22122.3");
  });

  it("says nothing about a figure the row left out", () => {
    const readings = scoresByAttribute([{ attribute: "country.rent" }]);

    expect(readings.get("country.rent")).toEqual({
      score: "—",
      weight: "—",
      weightUsed: "—",
      weightUsedTone: "plain",
      pointsAdded: "—",
      placed: false,
    });
  });

  /**
   * PL-063. **Weight is the server's declared share of the level, never the set's share of the
   * pillar**, so it sits on the basis Weight used sits on, and the two differ only where a
   * missing figure's weight was spread.
   */
  it("reads the weight the server declared, on the basis of the weight used", () => {
    const readings = scoresByAttribute([
      { attribute: "country.rent", weight: 12.5, effective_weight: 12.5 },
    ]);

    expect(readings.get("country.rent")?.weight).toBe("12.5%");
    expect(readings.get("country.rent")?.weightUsed).toBe("12.5%");
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

/**
 * UI-15. **A reading belongs to the figure it was computed from**, and the pass computes from
 * the active one. Keyed by attribute alone, the superseded and rejected figures beside it
 * printed the active figure's score and points as though they had earned them.
 */
describe("what the In use column says about one figure", () => {
  const readings = scoresByAttribute([
    {
      attribute: "country.rent",
      normalised_score: 73,
      weight: 12.5,
      effective_weight: 12.5,
      contribution: 9.125,
    },
  ]);
  const active = { attribute: "country.rent", is_active: true };

  it("gives the pass's reading to the active figure of an attribute the set scores", () => {
    expect(figureInUse(active, true, readings)).toEqual({
      inUse: "scored",
      reading: {
        score: "73",
        weight: "12.5%",
        weightUsed: "12.5%",
        weightUsedTone: "plain",
        pointsAdded: "+9.1",
        placed: true,
      },
    });
  });

  it("gives none to a figure the active one superseded", () => {
    expect(
      figureInUse(
        { attribute: "country.rent", is_active: false, rejection_reason: null },
        true,
        readings,
      ),
    ).toEqual({ inUse: "superseded", reading: null });
  });

  it("gives none to a figure the catalog rejected, and says it was rejected", () => {
    expect(
      figureInUse(
        {
          attribute: "country.rent",
          is_active: false,
          rejection_reason: "outside the attribute's allowed range",
        },
        true,
        readings,
      ),
    ).toEqual({ inUse: "rejected", reading: null });
  });

  /**
   * **Active, and nothing more.** A descriptive attribute has no criterion and an excluded one
   * does not count (`reqs.md` 3.0, 5.3): its figure is the one in use, and calling it scored
   * would claim a part in the total it never had.
   */
  it("calls the active figure of an attribute the set does not score active, with no reading", () => {
    expect(figureInUse(active, false, readings)).toEqual({
      inUse: "active",
      reading: null,
    });
  });

  it("calls a figure scored before the pass has arrived, with its reading still to come", () => {
    expect(figureInUse(active, true, new Map())).toEqual({
      inUse: "scored",
      reading: null,
    });
  });

  /**
   * **Where the set has said nothing, the pass answers.** The set is a separate read that can
   * fail or still be on its way, and the ranking carries a reading for every criterion that
   * counts and for nothing else -- so taking the set's silence for "not scored" hid the pass's
   * numbers from the one figure it had scored.
   */
  it("calls a figure scored, with the pass's reading, when only the pass has said so", () => {
    expect(figureInUse(active, undefined, readings)).toEqual({
      inUse: "scored",
      reading: {
        score: "73",
        weight: "12.5%",
        weightUsed: "12.5%",
        weightUsedTone: "plain",
        pointsAdded: "+9.1",
        placed: true,
      },
    });
  });

  it("calls a figure active when neither the set nor the pass has scored it", () => {
    expect(figureInUse(active, undefined, new Map())).toEqual({
      inUse: "active",
      reading: null,
    });
  });

  /** PL-071. A switched-off source's figure is never chosen; nothing superseded it. */
  it("says a figure from a switched-off source is switched off, not superseded", () => {
    expect(
      figureInUse(
        { attribute: "country.rent", is_active: false, source_is_enabled: false },
        true,
        readings,
      ),
    ).toEqual({ inUse: "switchedOff", reading: null });
  });

  it("calls a rejected figure rejected even when its source is switched off", () => {
    expect(
      figureInUse(
        {
          attribute: "country.rent",
          is_active: false,
          rejection_reason: "outside the allowed range",
          source_is_enabled: false,
        },
        true,
        readings,
      ),
    ).toEqual({ inUse: "rejected", reading: null });
  });

  /** PL-068. In use, and the method could not place it: not "Scored". */
  it("says an active figure the pass could not place is not placed", () => {
    const unplaced = scoresByAttribute([
      { attribute: "country.rent", normalised_score: null, weight: 10, effective_weight: 0 },
    ]);
    expect(figureInUse(active, true, unplaced).inUse).toBe("unplaced");
  });

  it("still gives no reading to a superseded figure when only the pass has spoken", () => {
    expect(
      figureInUse(
        { attribute: "country.rent", is_active: false, rejection_reason: null },
        undefined,
        readings,
      ),
    ).toEqual({ inUse: "superseded", reading: null });
  });
});

/**
 * PL-073. **Teal says a share grew or shrank by redistribution; amber says the attribute had no
 * figure in use and took nothing.** Within 0.6 points the two are the same number rounded.
 */
describe("the tint of the weight used", () => {
  it("is plain where the weight used is the weight, or within 0.6 points of it", () => {
    expect(weightUsedTone({ attribute: "a", normalised_score: 50, weight: 10, effective_weight: 10 })).toBe("plain");
    expect(weightUsedTone({ attribute: "a", normalised_score: 50, weight: 10, effective_weight: 10.6 })).toBe("plain");
    expect(weightUsedTone({ attribute: "a", normalised_score: 50, weight: 10, effective_weight: 9.4 })).toBe("plain");
  });

  it("is teal beyond 0.6 points, either way", () => {
    expect(weightUsedTone({ attribute: "a", normalised_score: 50, weight: 10, effective_weight: 10.61 })).toBe("moved");
    expect(weightUsedTone({ attribute: "a", normalised_score: 50, weight: 10, effective_weight: 9.39 })).toBe("moved");
  });

  it("is amber where nothing was in use and the weight used is nought", () => {
    expect(weightUsedTone({ attribute: "a", normalised_score: null, weight: 10, effective_weight: 0 })).toBe("missing");
  });

  /** A row the server sent without its weights says nothing, rather than a tint on nothing. */
  it("is plain where either weight is absent", () => {
    expect(weightUsedTone({ attribute: "a", normalised_score: 50, effective_weight: 12 })).toBe("plain");
    expect(weightUsedTone({ attribute: "a", weight: 12 })).toBe("plain");
  });
});
