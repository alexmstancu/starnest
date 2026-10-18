import { describe, expect, it } from "vitest";
import { diffAcquisitions, runIdFrom, type ProducedValue } from "./acquisitionDiff";

const value = (
  candidate: string,
  attribute: string,
  data_source = "eurostat",
): ProducedValue => ({ candidate, attribute, data_source });

const RENT = "country.rent";
const TAX = "country.tax";
const PT = "country.portugal";
const ES = "country.spain";

describe("what changed between two acquisitions", () => {
  it("calls a pair only the later run produced newly acquired", () => {
    const diff = diffAcquisitions([], [value(PT, RENT)]);

    expect(diff.newlyAcquired).toBe(1);
    expect(diff.rows[0]).toMatchObject({
      candidate: PT,
      attribute: RENT,
      change: "newly acquired",
    });
  });

  it("calls a pair both runs produced refreshed", () => {
    const diff = diffAcquisitions([value(PT, RENT)], [value(PT, RENT)]);

    expect(diff.refreshed).toBe(1);
    expect(diff.rows[0]?.change).toBe("refreshed");
  });

  /**
   * **"Went missing" is about the run, never about the store.** The earlier value is still
   * stored and may still be the active one -- this application never deletes a value.
   */
  it("calls a pair only the earlier run produced went missing", () => {
    const diff = diffAcquisitions([value(PT, RENT)], []);

    expect(diff.wentMissing).toBe(1);
    expect(diff.rows[0]?.change).toBe("went missing");
  });

  it("counts each kind separately", () => {
    const diff = diffAcquisitions(
      [value(PT, RENT), value(PT, TAX)],
      [value(PT, RENT), value(ES, TAX)],
    );

    expect(diff).toMatchObject({
      newlyAcquired: 1,
      refreshed: 1,
      wentMissing: 1,
    });
  });

  it("finds nothing between two runs that produced the same pairs", () => {
    const diff = diffAcquisitions([value(PT, RENT)], [value(PT, RENT)]);

    expect(diff.newlyAcquired).toBe(0);
    expect(diff.wentMissing).toBe(0);
  });

  it("finds nothing at all between two empty runs", () => {
    expect(diffAcquisitions([], [])).toEqual({
      rows: [],
      newlyAcquired: 0,
      refreshed: 0,
      unchanged: 0,
      wentMissing: 0,
    });
  });

  /** A candidate and an attribute together are the unit; neither identifies a pair alone. */
  it("treats the same attribute for two candidates as two pairs", () => {
    const diff = diffAcquisitions([], [value(PT, RENT), value(ES, RENT)]);

    expect(diff.newlyAcquired).toBe(2);
  });

  it("treats two attributes for one candidate as two pairs", () => {
    const diff = diffAcquisitions([], [value(PT, RENT), value(PT, TAX)]);

    expect(diff.newlyAcquired).toBe(2);
  });

  it("reads in a fixed order, so the same two runs always look the same", () => {
    const diff = diffAcquisitions(
      [value(ES, TAX)],
      [value(PT, TAX), value(ES, RENT)],
    );

    expect(diff.rows.map((row) => row.change)).toEqual([
      "newly acquired",
      "newly acquired",
      "went missing",
    ]);
    // Within a kind, by candidate then attribute.
    expect(diff.rows.slice(0, 2).map((row) => row.candidate)).toEqual([PT, ES]
      .sort((a, b) => a.localeCompare(b)));
  });

  it("names the source that answered", () => {
    const diff = diffAcquisitions([], [value(PT, RENT, "oecd")]);

    expect(diff.rows[0]?.data_source).toBe("oecd");
  });

  it("copes with one run producing two figures for one pair", () => {
    const diff = diffAcquisitions(
      [],
      [value(PT, RENT, "eurostat"), value(PT, RENT, "oecd")],
    );

    expect(diff.newlyAcquired).toBe(1);
  });
});

describe("the run a choice names", () => {
  it("reads a chosen run", () => {
    expect(runIdFrom("7")).toBe(7);
  });

  it("reads the empty choice as no run", () => {
    expect(runIdFrom("")).toBeNull();
    expect(runIdFrom("   ")).toBeNull();
  });

  it("refuses anything that is not a whole run id", () => {
    expect(runIdFrom("seven")).toBeNull();
    expect(runIdFrom("7.5")).toBeNull();
  });
});

describe("a figure that moved, and one that did not", () => {
  /**
   * **They were one word until the figures themselves were read.** A run that re-fetched a
   * thousand values and moved none of them cost something and changed nothing, and a single
   * "refreshed" count is exactly where that disappears.
   */
  const pair = { candidate: "country.portugal", attribute: "country.rent" };

  it("calls a pair unchanged when both runs produced the same figure", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { magnitude: 780, unit: "EUR" } }],
      [{ ...pair, payload: { magnitude: 780, unit: "EUR" } }],
    );

    expect(diff.unchanged).toBe(1);
    expect(diff.refreshed).toBe(0);
  });

  it("calls it refreshed when the figure moved", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { magnitude: 780, unit: "EUR" } }],
      [{ ...pair, payload: { magnitude: 812, unit: "EUR" } }],
    );

    expect(diff.refreshed).toBe(1);
    expect(diff.unchanged).toBe(0);
  });

  it("carries both figures, so the verdict can be checked rather than trusted", () => {
    const [row] = diffAcquisitions(
      [{ ...pair, payload: { magnitude: 780, unit: "EUR" } }],
      [{ ...pair, payload: { magnitude: 812, unit: "EUR" } }],
    ).rows;

    expect(row?.earlier).toBe("780 EUR");
    expect(row?.later).toBe("812 EUR");
  });

  it("leaves the later figure empty for a pair that went missing", () => {
    const [row] = diffAcquisitions(
      [{ ...pair, payload: { magnitude: 780, unit: "EUR" } }],
      [],
    ).rows;

    expect(row?.change).toBe("went missing");
    expect(row?.earlier).toBe("780 EUR");
    expect(row?.later).toBeNull();
  });

  it("refuses to call two unreadable figures identical", () => {
    // Inventing agreement out of ignorance is the one thing this application exists not to
    // do. With no payload on either side the weaker, true claim is that the pair was
    // produced again.
    const diff = diffAcquisitions([{ ...pair }], [{ ...pair }]);

    expect(diff.refreshed).toBe(1);
    expect(diff.unchanged).toBe(0);
  });

  it("puts the rows nobody has to act on last", () => {
    const diff = diffAcquisitions(
      [
        { candidate: "a", attribute: "x", payload: { count: 1 } },
        { candidate: "b", attribute: "x", payload: { count: 1 } },
      ],
      [
        { candidate: "a", attribute: "x", payload: { count: 1 } },
        { candidate: "c", attribute: "x", payload: { count: 9 } },
      ],
    );

    expect(diff.rows.map((row) => row.change)).toEqual([
      "newly acquired",
      "went missing",
      "unchanged",
    ]);
  });
});

/**
 * UI-22. **"Unchanged" was decided on rounded text.** The figures are printed to two decimals,
 * so a figure that moved by less than that read the same on both sides and was called unchanged
 * -- a claim about the stored values made from their display.
 */
describe("what decides that a figure did not move", () => {
  const pair = { candidate: "country.portugal", attribute: "country.life_satisfaction" };

  it("calls a pair refreshed when the figure moved by less than the displayed precision", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { magnitude: 1.071, unit: "ladder_points" } }],
      [{ ...pair, payload: { magnitude: 1.074, unit: "ladder_points" } }],
    );

    expect(diff.refreshed).toBe(1);
    expect(diff.unchanged).toBe(0);
  });

  it("shows the exact figures when the rounded ones would read the same", () => {
    const [row] = diffAcquisitions(
      [{ ...pair, payload: { magnitude: 1.071, unit: "ladder_points" } }],
      [{ ...pair, payload: { magnitude: 1.074, unit: "ladder_points" } }],
    ).rows;

    expect(row?.earlier).toBe("1.071 ladder points");
    expect(row?.later).toBe("1.074 ladder points");
  });

  it("keeps the rounded figures where they already tell the two apart", () => {
    const [row] = diffAcquisitions(
      [{ ...pair, payload: { magnitude: 30.80604044947752, unit: "ladder_points" } }],
      [{ ...pair, payload: { magnitude: 31.2, unit: "ladder_points" } }],
    ).rows;

    expect(row?.earlier).toBe("30.81 ladder points");
    expect(row?.later).toBe("31.2 ladder points");
  });

  /**
   * **A converted amount can move in euros alone**, at a fresher exchange rate, and its amount
   * and currency then read the same on both sides of a row that says it moved.
   */
  it("shows the euro equivalents when a converted amount moved only in euros", () => {
    const rent = { ...pair, attribute: "country.rent_one_bedroom_centre" };
    const diff = diffAcquisitions(
      [{ ...rent, payload: { amount: 1000, currency: "CHF", amount_eur: 1061.2 } }],
      [{ ...rent, payload: { amount: 1000, currency: "CHF", amount_eur: 1063.5 } }],
    );
    const [row] = diff.rows;

    expect(diff.refreshed).toBe(1);
    expect(row?.earlier).toBe("1000 CHF (1061.2 EUR)");
    expect(row?.later).toBe("1000 CHF (1063.5 EUR)");
  });

  it("calls the same converted amount unchanged, and shows it as it always has", () => {
    const rent = { ...pair, attribute: "country.rent_one_bedroom_centre" };
    const payload = { amount: 1000, currency: "CHF", amount_eur: 1061.2 };
    const diff = diffAcquisitions([{ ...rent, payload }], [{ ...rent, payload }]);
    const [row] = diff.rows;

    expect(diff.unchanged).toBe(1);
    expect(row?.earlier).toBe("1000 CHF");
    expect(row?.later).toBe("1000 CHF");
  });

  it("keeps the amounts alone where they already tell the two apart", () => {
    const rent = { ...pair, attribute: "country.rent_one_bedroom_centre" };
    const [row] = diffAcquisitions(
      [{ ...rent, payload: { amount: 1000, currency: "CHF", amount_eur: 1061.2 } }],
      [{ ...rent, payload: { amount: 1100, currency: "CHF", amount_eur: 1167.32 } }],
    ).rows;

    expect(row?.earlier).toBe("1000 CHF");
    expect(row?.later).toBe("1100 CHF");
  });

  /**
   * NEW-39. **An assigned score can change in its rationale alone**, and its number, range and
   * assigner then read the same on both sides of a row that says it moved.
   */
  describe("an assigned score", () => {
    const ease = { ...pair, attribute: "country.residency_admin_ease" };
    const score = (rationale?: string, value = 7) => ({
      ...ease,
      payload: {
        value,
        range_min: 0,
        range_max: 10,
        assigned_by: "human",
        ...(rationale === undefined ? {} : { rationale }),
      },
    });

    it("shows the rationales when two scores differ in nothing else", () => {
      const diff = diffAcquisitions(
        [score("Permits take three months")],
        [score("Permits take six weeks")],
      );
      const [row] = diff.rows;

      expect(diff.refreshed).toBe(1);
      expect(row?.earlier).toBe(
        "7 on 0–10 (assigned by human) — “Permits take three months”",
      );
      expect(row?.later).toBe(
        "7 on 0–10 (assigned by human) — “Permits take six weeks”",
      );
    });

    it("shows a rationale given to a score that had none", () => {
      const [row] = diffAcquisitions(
        [score()],
        [score("Permits take six weeks")],
      ).rows;

      expect(row?.change).toBe("refreshed");
      expect(row?.earlier).toBe("7 on 0–10 (assigned by human)");
      expect(row?.later).toBe(
        "7 on 0–10 (assigned by human) — “Permits take six weeks”",
      );
    });

    it("calls the same score unchanged, and shows it as it always has", () => {
      const diff = diffAcquisitions(
        [score("Permits take six weeks")],
        [score("Permits take six weeks")],
      );
      const [row] = diff.rows;

      expect(diff.unchanged).toBe(1);
      expect(row?.earlier).toBe("7 on 0–10 (assigned by human)");
      expect(row?.later).toBe("7 on 0–10 (assigned by human)");
    });

    it("keeps the scores alone where their numbers already tell the two apart", () => {
      const [row] = diffAcquisitions(
        [score("Permits take three months", 6)],
        [score("Permits take six weeks", 7)],
      ).rows;

      expect(row?.earlier).toBe("6 on 0–10 (assigned by human)");
      expect(row?.later).toBe("7 on 0–10 (assigned by human)");
    });
  });

  it("calls the same payload unchanged whatever the order of its keys", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { magnitude: 7.1, unit: "ladder_points" } }],
      [{ ...pair, payload: { unit: "ladder_points", magnitude: 7.1 } }],
    );

    expect(diff.unchanged).toBe(1);
  });

  it("calls a changed unit with the same magnitude a move", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { magnitude: 7.1, unit: "ladder_points" } }],
      [{ ...pair, payload: { magnitude: 7.1, unit: "pisa_points" } }],
    );

    expect(diff.refreshed).toBe(1);
  });

  it("calls a field the later payload gained a move", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { count: 412 } }],
      [{ ...pair, payload: { count: 412, basis: "per_capita" } }],
    );

    expect(diff.refreshed).toBe(1);
  });

  it("never calls a payload missing on one side unchanged", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: null }, { ...pair, candidate: "country.spain" }],
      [
        { ...pair, payload: { count: 412 } },
        { ...pair, candidate: "country.spain", payload: { count: 412 } },
      ],
    );

    expect(diff.refreshed).toBe(2);
    expect(diff.unchanged).toBe(0);
  });

  /** A label set's order is what the source served, so a reordering is a move -- on purpose. */
  it("counts a label set served in a different order as moved", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { labels: ["Siemens", "OutSystems"] } }],
      [{ ...pair, payload: { labels: ["OutSystems", "Siemens"] } }],
    );

    expect(diff.refreshed).toBe(1);
  });

  it("calls the same label set unchanged", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { labels: ["Siemens", "OutSystems"] } }],
      [{ ...pair, payload: { labels: ["Siemens", "OutSystems"] } }],
    );

    expect(diff.unchanged).toBe(1);
  });

  it("calls a label set that lost a label a move", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { labels: ["Siemens", "OutSystems"] } }],
      [{ ...pair, payload: { labels: ["Siemens"] } }],
    );

    expect(diff.refreshed).toBe(1);
  });

  it("does not mistake a list for a record with the same entries", () => {
    const diff = diffAcquisitions(
      [{ ...pair, payload: { count: 412, basis: ["per_capita"] } }],
      [{ ...pair, payload: { count: 412, basis: { 0: "per_capita" } } }],
    );

    expect(diff.refreshed).toBe(1);
  });

  it("compares the shares of a composition one by one", () => {
    const shares = (renewable: number) => ({
      shares: [
        { label: "renewable", share: renewable },
        { label: "fossil", share: 100 - renewable },
      ],
    });
    const diff = diffAcquisitions(
      [
        { ...pair, payload: shares(61) },
        { ...pair, candidate: "country.spain", payload: shares(61) },
      ],
      [
        { ...pair, payload: shares(61) },
        { ...pair, candidate: "country.spain", payload: shares(62) },
      ],
    );

    expect(diff.unchanged).toBe(1);
    expect(diff.refreshed).toBe(1);
  });
});
