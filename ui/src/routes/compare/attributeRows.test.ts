import { describe, expect, it } from "vitest";
import { ABSENT } from "../../format/display";
import {
  attributeGroups,
  payloadMagnitude,
  rawGapText,
  rawGapUnit,
  type AttributeCell,
  type AttributeSource,
} from "./attributeRows";
import { divergingBar } from "./divergingBar";

describe("a figure's bare magnitude", () => {
  it("reads whichever key the value type buried the number under", () => {
    expect(payloadMagnitude({ payload: { magnitude: 92.1 } })).toBe(92.1);
    expect(payloadMagnitude({ payload: { amount: 1800, currency: "EUR", amount_eur: 1800 } })).toBe(
      1800,
    );
    expect(payloadMagnitude({ payload: { value: 1.07 } })).toBe(1.07);
    expect(payloadMagnitude({ payload: { count: 412 } })).toBe(412);
  });

  it("has nothing to read where the figure has no numeric magnitude", () => {
    // A boolean value and a label set have no magnitude to divide a gap by.
    expect(payloadMagnitude({ payload: { value: true } })).toBeNull();
    expect(payloadMagnitude({ payload: { labels: ["mild"] } })).toBeNull();
    expect(payloadMagnitude({ payload: null })).toBeNull();
    expect(payloadMagnitude(null)).toBeNull();
    expect(payloadMagnitude(undefined)).toBeNull();
  });
});

/**
 * UIR-A2. **A monetary gap is the server's euro gap, so it is judged and labelled in euros.**
 * The comparison subtracts `amount_eur` from `amount_eur`; a magnitude read from `amount` sized
 * that gap against the figure in its own currency, so 130 EUR on a rent of 150,000 HUF (380 EUR)
 * read as 0.09% and was drawn as noise.
 */
const order = ["country.spain", "country.netherlands"];

describe("a monetary gap", () => {
  const forint = { payload: { amount: 150000, currency: "HUF", amount_eur: 380 } };

  it("is sized against the figure's euro amount", () => {
    expect(payloadMagnitude(forint)).toBe(380);
  });

  it("is drawn as a real gap when it is a large share of the euro amount", () => {
    expect(divergingBar(-130, 130, payloadMagnitude(forint)).faint).toBe(false);
  });

  it("is left untinted, not sized in its own currency, when the figure has no euro amount", () => {
    expect(payloadMagnitude({ payload: { amount: 1800, currency: "SEK" } })).toBeNull();
  });

  it("is labelled in euros, and no other type's gap is given a unit", () => {
    expect(rawGapUnit(forint)).toBe("EUR");
    expect(rawGapUnit({ payload: { magnitude: 92.1, unit: "index_eu27_100" } })).toBeNull();
    expect(rawGapUnit({ payload: { amount: 1800, currency: "SEK" } })).toBeNull();
    expect(rawGapUnit(null)).toBeNull();
  });

  it("prints its unit beside the number, and nothing beside an absent gap", () => {
    expect(rawGapText(-130, "EUR")).toBe("-130.0 EUR");
    expect(rawGapText(null, "EUR")).toBe(ABSENT);
    expect(rawGapText(-13.4, null)).toBe("-13.4");
  });

  it("travels with its row", () => {
    const rent: AttributeSource = {
      attribute: "country.median_rent",
      pillar: "housing",
      focusScore: 70,
      focusRaw: 380,
      focusFigure: "150,000 HUF (380 EUR)",
      gapUnit: "EUR",
      comparators: [{ candidate: "country.spain", score: 40, rawDelta: -130, figure: "510 EUR" }],
    };

    expect(attributeGroups([rent], order).get("housing")?.[0]?.gapUnit).toBe("EUR");
  });
});

const economicsA: AttributeSource = {
  attribute: "country.cost_of_living_index",
  pillar: "economics",
  focusScore: 82,
  focusRaw: 92.1,
  focusFigure: "92.1 EU27 = 100",
  gapUnit: null,
  comparators: [
    { candidate: "country.spain", score: 41, rawDelta: -13.4, figure: "105.5 EU27 = 100" },
    { candidate: "country.netherlands", score: 70, rawDelta: -4, figure: "96.1 EU27 = 100" },
  ],
};

const economicsB: AttributeSource = {
  attribute: "country.income_tax",
  pillar: "economics",
  focusScore: 50,
  focusRaw: 35,
  focusFigure: "35%",
  gapUnit: null,
  comparators: [
    { candidate: "country.spain", score: 60, rawDelta: -2, figure: "37%" },
    { candidate: "country.netherlands", score: 55, rawDelta: -1, figure: "36%" },
  ],
};

const nature: AttributeSource = {
  attribute: "country.coastline_access",
  pillar: "nature",
  focusScore: 70,
  focusRaw: 1793,
  focusFigure: "1793 km",
  gapUnit: null,
  comparators: [
    { candidate: "country.spain", score: 64, rawDelta: 1341, figure: "452 km" },
    // Netherlands has no figure for this attribute at all.
  ],
};


describe("grouping the attributes under their pillar", () => {
  it("keeps each pillar's attributes together", () => {
    const groups = attributeGroups([economicsA, economicsB, nature], order);
    expect(groups.get("economics")?.map((row) => row.attribute)).toEqual([
      "country.cost_of_living_index",
      "country.income_tax",
    ]);
    expect(groups.get("nature")?.map((row) => row.attribute)).toEqual([
      "country.coastline_access",
    ]);
  });

  it("emits the cells in the column order the matrix header sets", () => {
    const [row] = attributeGroups([economicsA], order).get("economics")!;
    expect(row?.cells.map((cell) => cell.candidate)).toEqual(order);
  });

  it("subtracts the focus score from each comparator's, in points", () => {
    const [row] = attributeGroups([economicsA], order).get("economics")!;
    // Spain 41 against the focus's 82.
    expect(row?.cells[0]?.scoreDelta).toBe(-41);
    expect(row?.cells[1]?.scoreDelta).toBe(-12);
  });

  it("says nothing rather than zero where a side has no figure", () => {
    const [row] = attributeGroups([nature], order).get("nature")!;
    // Netherlands is not among this attribute's comparators at all.
    const absent = row?.cells[1];
    expect(absent?.score).toBeNull();
    expect(absent?.scoreDelta).toBeNull();
    expect(absent?.rawDelta).toBeNull();
    expect(absent?.figure).toBe("");
  });

  it("draws every row in a pillar against one score ruler, the pillar's largest gap", () => {
    const rows = attributeGroups([economicsA, economicsB], order).get("economics")!;
    // The largest score gap in the pillar is 41 (cost of living, Spain), so both rows use it.
    expect(rows.every((row) => row.scoreScale === 41)).toBe(true);
  });

  it("gives each row its own raw ruler, since the units differ", () => {
    const rows = attributeGroups([economicsA, nature], order);
    // Cost of living's largest raw gap is 13.4; coastline's is 1341.
    expect(rows.get("economics")?.[0]?.rawScale).toBe(13.4);
    expect(rows.get("nature")?.[0]?.rawScale).toBe(1341);
  });

  it("carries the focus figure and magnitude through for the drill-down to read", () => {
    const [row] = attributeGroups([economicsA], order).get("economics")!;
    expect(row?.focusFigure).toBe("92.1 EU27 = 100");
    expect(row?.focusRaw).toBe(92.1);
    expect(row?.focusScore).toBe(82);
  });
});

/**
 * UI-19. **A raw gap's sign says which figure is higher, not which is better** -- and the
 * server's raw delta is focus minus comparator, while the score delta is comparator minus focus.
 * One bar was fed from both sides, so a coastline Portugal wins on drew Spain as ahead of it.
 * The bar takes its direction from the scores, which know every goal, and its size from the gap.
 */
describe("which way a raw gap is drawn", () => {
  /** The one comparator cell of a row with Spain as its only comparator. */
  function spainIn(
    focusScore: number | null,
    spainScore: number | null,
    rawDelta: number | null,
  ): AttributeCell {
    const [row] = attributeGroups(
      [
        {
          attribute: "country.anything",
          pillar: "nature",
          focusScore,
          focusRaw: 100,
          focusFigure: "100",
          gapUnit: null,
          comparators: [
            { candidate: "country.spain", score: spainScore, rawDelta, figure: "" },
          ],
        },
      ],
      ["country.spain"],
    ).get("nature")!;
    return row!.cells[0]!;
  }

  it("draws a comparator that scored lower as behind, whichever way its figure moved", () => {
    // Coastline is maximised: Portugal's 1,793 km against Spain's 452 is a raw gap of +1,341
    // (focus minus comparator), and Spain, scoring 64 to Portugal's 70, is behind.
    const [row] = attributeGroups([nature], order).get("nature")!;
    const spain = row!.cells[0]!;

    expect(spain.rawBar).toBe(-1341);
    expect(divergingBar(spain.rawBar, row!.rawScale, row!.focusRaw).direction).toBe(
      "behind",
    );
  });

  it("draws a comparator that scored higher as ahead, whichever way its figure moved", () => {
    // The same coastline the other way round: the focus has less of it and scores lower.
    const spain = spainIn(64, 70, -1341);

    expect(spain.rawBar).toBe(1341);
    expect(divergingBar(spain.rawBar, 1341, 452).direction).toBe("ahead");
  });

  it("reads a minimised figure by its scores, so a dearer comparator is behind", () => {
    // Cost of living is minimised: Spain's 105.5 against Portugal's 92.1 is a raw gap of -13.4,
    // and Spain, scoring 41 to Portugal's 82, is behind.
    const [row] = attributeGroups([economicsA], order).get("economics")!;

    expect(row!.cells[0]!.rawBar).toBe(-13.4);
  });

  it("reads a target band by its scores, from either side of the band", () => {
    // Above the band and below it: the figure's sign flips, and only the scores say who is
    // nearer the band.
    expect(spainIn(60, 40, 10).rawBar).toBe(-10);
    expect(spainIn(60, 40, -10).rawBar).toBe(-10);
    expect(spainIn(40, 60, 10).rawBar).toBe(10);
    expect(spainIn(40, 60, -10).rawBar).toBe(10);
  });

  it("draws no direction where either side has no score", () => {
    expect(spainIn(70, null, 1341).rawBar).toBeNull();
    expect(spainIn(null, 64, 1341).rawBar).toBeNull();
  });

  it("draws no direction where the scores tie, however far apart the figures", () => {
    // Two places inside a target band both score full marks: neither is ahead.
    expect(spainIn(100, 100, 2).rawBar).toBeNull();
  });

  it("draws nothing where a side has no figure", () => {
    expect(spainIn(70, 64, null).rawBar).toBeNull();
  });

  it("keeps the server's raw number as the server sent it", () => {
    const [row] = attributeGroups([nature], order).get("nature")!;

    expect(row!.cells[0]!.rawDelta).toBe(1341);
  });
});
