import { describe, expect, it } from "vitest";
import type { StoredValue } from "../../api/endpoints";
import { drillRows, type DrillRow } from "./drillRows";

/**
 * M6. The drill-down's rows, from two server reads: the stored values in the server's order,
 * and the ranked detail's `attribute_scores`. Descriptive attributes first, then the scored ones
 * by pillar order and name; a "no value in use" row where nothing is active; each attribute's
 * figures together, in the order the server sent them.
 */

let nextId = 1;

function figure(
  attribute: string,
  overrides: Partial<StoredValue> = {},
): StoredValue {
  const id = nextId++;
  return {
    id,
    candidate: "country.portugal",
    attribute,
    value_type: "Count",
    payload: { count: id },
    data_source: "eurostat",
    reference_period: { start: "2025-01-01", end: "2025-12-31" },
    retrieval_date: "2026-09-11T08:00:00Z",
    confidence_level: "high",
    is_active: true,
    is_fresh: true,
    source_is_enabled: true,
    ...overrides,
  };
}

function scored(attribute: string, pillar: string) {
  return {
    attribute,
    pillar,
    normalised_score: 50,
    weight: 10,
    effective_weight: 10,
    contribution: 5,
  };
}

const PILLAR_ORDER = new Map([
  ["economics", 1],
  ["housing", 2],
  ["safety", 4],
]);

const NAMES = new Map([
  ["country.rent", "Average rent"],
  ["country.tax", "Total tax rate"],
  ["country.cost", "Cost of living"],
  ["country.homicide", "Homicide rate"],
  ["country.air", "Air connectivity"],
  ["country.sunshine", "Sunshine"],
]);

/** Each row as one word: the attribute, and whether it is a figure (by id) or a gap. */
function shape(rows: readonly DrillRow[]): string[] {
  return rows.map((row) =>
    row.kind === "missing"
      ? `${row.attribute}: ${row.why}`
      : `${row.attribute} #${String(row.repeated.value.id)}`,
  );
}

function rowsOf(
  values: StoredValue[],
  scores: ReturnType<typeof scored>[] | null,
  chosenPillar: string | null = null,
) {
  return drillRows({
    values,
    scores,
    pillarOrder: PILLAR_ORDER,
    names: NAMES,
    chosenPillar,
  });
}

describe("the drill-down's rows", () => {
  it("lists unscored attributes first, then by pillar order and name, each attribute's figures together", () => {
    const tax2025 = figure("country.tax");
    const sunshine = figure("country.sunshine");
    const homicide = figure("country.homicide");
    const tax2024 = figure("country.tax", { is_active: false });
    const cost = figure("country.cost");
    const air = figure("country.air");
    const rent = figure("country.rent");

    const rows = rowsOf(
      [tax2025, sunshine, homicide, tax2024, cost, air, rent],
      [
        scored("country.homicide", "safety"),
        scored("country.tax", "economics"),
        scored("country.rent", "housing"),
        scored("country.cost", "economics"),
      ],
    );

    expect(shape(rows)).toEqual([
      // Descriptive, by name.
      `country.air #${String(air.id)}`,
      `country.sunshine #${String(sunshine.id)}`,
      // Economy (1): Cost of living before Total tax rate.
      `country.cost #${String(cost.id)}`,
      // The server's order inside the attribute, never re-sorted.
      `country.tax #${String(tax2025.id)}`,
      `country.tax #${String(tax2024.id)}`,
      // Housing (2), then Safety (4).
      `country.rent #${String(rent.id)}`,
      `country.homicide #${String(homicide.id)}`,
    ]);
    expect(rows.map((row) => row.scored)).toEqual([
      false, false, true, true, true, true, true,
    ]);
  });

  it("puts a pillar the catalog has not ordered after every pillar it has", () => {
    const rows = rowsOf(
      [figure("country.air"), figure("country.rent")],
      [scored("country.air", "unknown"), scored("country.rent", "housing")],
    );

    expect(rows.map((row) => row.attribute)).toEqual([
      "country.rent",
      "country.air",
    ]);
  });

  it("folds byte-identical repeats inside an attribute", () => {
    const first = figure("country.rent", { retrieval_date: "2025-01-01T00:00:00Z" });
    const again = { ...first, id: 999, retrieval_date: "2026-01-01T00:00:00Z" };

    const rows = rowsOf([first, again], [scored("country.rent", "housing")]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "figure", repeated: { copies: 2 } });
  });

  describe("a scored attribute with no value in use", () => {
    it("is named, with nothing stored, where it has no figure at all", () => {
      const rows = rowsOf([], [scored("country.rent", "housing")]);

      expect(rows).toEqual([
        { kind: "missing", attribute: "country.rent", scored: true, why: "nothing_stored" },
      ]);
    });

    it("sits above its figures when every one was rejected", () => {
      const rejected = figure("country.rent", {
        is_active: false,
        rejection_reason: "outside the allowed range",
      });

      expect(shape(rowsOf([rejected], [scored("country.rent", "housing")]))).toEqual([
        "country.rent: rejected",
        `country.rent #${String(rejected.id)}`,
      ]);
    });

    it("says so where every figure is from a switched-off source", () => {
      const off = figure("country.rent", { is_active: false, source_is_enabled: false });

      expect(shape(rowsOf([off], [scored("country.rent", "housing")]))).toEqual([
        "country.rent: switched_off",
        `country.rent #${String(off.id)}`,
      ]);
    });

    it("names both causes where its figures were rejected or switched off", () => {
      const rows = rowsOf(
        [
          figure("country.rent", { is_active: false, rejection_reason: "too big" }),
          figure("country.rent", { is_active: false, source_is_enabled: false }),
        ],
        [scored("country.rent", "housing")],
      );

      expect(rows[0]).toMatchObject({ kind: "missing", why: "rejected_or_switched_off" });
    });

    it("says only that none is in use where nothing explains why", () => {
      const rows = rowsOf(
        [figure("country.rent", { is_active: false })],
        [scored("country.rent", "housing")],
      );

      expect(rows[0]).toMatchObject({ kind: "missing", why: "not_in_use" });
    });

    it("has no gap row where one of its figures is in use", () => {
      const rows = rowsOf(
        [
          figure("country.rent", { is_active: false, source_is_enabled: false }),
          figure("country.rent"),
        ],
        [scored("country.rent", "housing")],
      );

      expect(rows.every((row) => row.kind === "figure")).toBe(true);
    });

    it("is never guessed for an unscored attribute", () => {
      const rows = rowsOf(
        [figure("country.air", { is_active: false, rejection_reason: "bad" })],
        [],
      );

      expect(rows.map((row) => row.kind)).toEqual(["figure"]);
    });
  });

  describe("a chosen pillar", () => {
    it("keeps that pillar's figures and its missing rows, and nothing unscored", () => {
      const cost = figure("country.cost");
      const rows = rowsOf(
        [figure("country.air"), cost, figure("country.rent")],
        [
          scored("country.cost", "economics"),
          scored("country.tax", "economics"),
          scored("country.rent", "housing"),
        ],
        "economics",
      );

      expect(shape(rows)).toEqual([
        `country.cost #${String(cost.id)}`,
        "country.tax: nothing_stored",
      ]);
    });

    it("leaves nothing for a pillar the pass scored nothing in", () => {
      expect(rowsOf([figure("country.rent")], [scored("country.rent", "housing")], "safety")).toEqual([]);
    });
  });

  describe("while the scoring is pending or has failed", () => {
    it("guesses no missing row and groups the stored figures by name", () => {
      const tax = figure("country.tax");
      const air = figure("country.air");

      const rows = rowsOf([tax, air], null);

      expect(shape(rows)).toEqual([
        `country.air #${String(air.id)}`,
        `country.tax #${String(tax.id)}`,
      ]);
      expect(rows.every((row) => !row.scored)).toBe(true);
    });

    it("cannot filter by a pillar it has not been told, so it filters nothing", () => {
      const rows = rowsOf([figure("country.tax")], null, "economics");

      expect(rows).toHaveLength(1);
    });
  });

  it("is empty for a candidate with nothing stored and nothing scored", () => {
    expect(rowsOf([], [])).toEqual([]);
  });
});
