import { describe, expect, it } from "vitest";
import {
  attributeGroups,
  payloadMagnitude,
  type AttributeSource,
} from "./attributeRows";

describe("a figure's bare magnitude", () => {
  it("reads whichever key the value type buried the number under", () => {
    expect(payloadMagnitude({ payload: { magnitude: 92.1 } })).toBe(92.1);
    expect(payloadMagnitude({ payload: { amount: 1800 } })).toBe(1800);
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

const economicsA: AttributeSource = {
  attribute: "country.cost_of_living_index",
  pillar: "economics",
  focusScore: 82,
  focusRaw: 92.1,
  focusFigure: "92.1 EU27 = 100",
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
  comparators: [
    { candidate: "country.spain", score: 64, rawDelta: 1341, figure: "452 km" },
    // Netherlands has no figure for this attribute at all.
  ],
};

const order = ["country.spain", "country.netherlands"];

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
