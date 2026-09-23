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
