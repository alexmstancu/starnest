import { describe, expect, it } from "vitest";
import {
  describeGaps,
  describeScope,
  holdingsFigures,
  lastFilledBy,
  newestRun,
  runningNow,
  scoredFigure,
  startOfLocalMonth,
  type HoldingsFigures,
  type RunSummary,
} from "./databaseHolds";
import { formatMoney } from "../../format/display";

function run(over: Partial<RunSummary> & { id: number }): RunSummary {
  return {
    run_status: "completed",
    started_at: "2026-09-10T09:00:00Z",
    cost_eur: 0,
    ...over,
  };
}

describe("the most recent acquisition", () => {
  it("is the one that started last, whatever order the list arrived in", () => {
    const newest = newestRun([
      run({ id: 1, started_at: "2026-09-01T09:00:00Z" }),
      run({ id: 2, started_at: "2026-09-21T09:00:00Z" }),
      run({ id: 3, started_at: "2026-09-10T09:00:00Z" }),
    ]);
    expect(newest?.id).toBe(2);
  });

  it("is nothing when nothing has been run", () => {
    expect(newestRun([])).toBeUndefined();
  });

  it("does not reorder the list it was given", () => {
    const runs = [
      run({ id: 1, started_at: "2026-09-01T09:00:00Z" }),
      run({ id: 2, started_at: "2026-09-21T09:00:00Z" }),
    ];
    newestRun(runs);
    expect(runs.map((each) => each.id)).toEqual([1, 2]);
  });
});

describe("what is running", () => {
  it("finds the one still going", () => {
    expect(
      runningNow([run({ id: 1 }), run({ id: 2, run_status: "running" })])?.id,
    ).toBe(2);
  });

  it("is nothing when every acquisition has finished", () => {
    expect(runningNow([run({ id: 1 })])).toBeUndefined();
  });
});

describe("the acquisition that last filled the database", () => {
  it("is the newest one that stored something", () => {
    expect(
      lastFilledBy([
        { ...run({ id: 1, started_at: "2026-09-01T09:00:00Z" }), items_completed: 40 },
        { ...run({ id: 2, started_at: "2026-09-21T09:00:00Z" }), items_completed: 0 },
        { ...run({ id: 3, started_at: "2026-09-10T09:00:00Z" }), items_completed: 2 },
      ])?.id,
    ).toBe(3);
  });

  it("is nothing when no acquisition stored anything", () => {
    expect(lastFilledBy([run({ id: 1 })])).toBeUndefined();
    expect(lastFilledBy([])).toBeUndefined();
  });
});

/**
 * C04-N10. **The reader's month, with the reader's zone written out**: the server sums spend
 * from this moment and refuses a time with no zone, so a boundary at UTC midnight -- an
 * evening of the last day for half the world -- can never be what was meant.
 */
describe("the start of the reader's month", () => {
  it("is midnight on the first, local time, whatever day it is now", () => {
    const now = new Date(2026, 9, 25, 10, 25);
    const since = startOfLocalMonth(now);

    expect(since).toMatch(/^2026-10-01T00:00:00[+-]\d{2}:\d{2}$/);
    expect(new Date(since).getTime()).toBe(new Date(2026, 9, 1).getTime());
  });

  it("is the same moment on the first itself, a minute after midnight", () => {
    expect(startOfLocalMonth(new Date(2026, 0, 1, 0, 1))).toMatch(/^2026-01-01T00:00:00/);
  });
});

function holdings(over: Partial<HoldingsFigures> = {}): HoldingsFigures {
  return {
    level: "country",
    pairs_total: 1312,
    values_stored: 1247,
    values_past_allowed_age: 37,
    spent: { total_eur: 0.61 },
    ...over,
  };
}

describe("the database's figures", () => {
  it("counts the values stored out of the pairs the level has", () => {
    const { stored } = holdingsFigures(holdings(), 5);

    expect(stored.value).toBe("1,247");
    expect(stored.note).toMatch(/^of 1,312 at country level/);
  });

  it("marks values past their allowed age, and only when there are some", () => {
    expect(holdingsFigures(holdings(), 5).aged).toMatchObject({ value: "37", tone: "warning" });
    expect(holdingsFigures(holdings({ values_past_allowed_age: 0 }), 5).aged.tone).toBeUndefined();
  });

  it("says the month's spend is the server's total, and the cap a per-run and per-pass one", () => {
    const { spent } = holdingsFigures(holdings(), 5);

    expect(spent.value).toBe(formatMoney(0.61, "EUR"));
    expect(spent.note).toBe(
      `the cap is ${formatMoney(5, "EUR")} per acquisition and per research pass`,
    );
  });

  /** PL-057. The strip offers to go uncapped, so nothing here may say such a run refuses. */
  it("says an uncapped acquisition asks to go uncapped, never that it refuses", () => {
    for (const cap of [null, undefined]) {
      const { note } = holdingsFigures(holdings(), cap).spent;
      expect(note).toMatch(/no cap is set: an acquisition that would spend asks you to accept/);
      expect(note).not.toMatch(/refuses/);
    }
  });
});

describe("how many candidates are scored", () => {
  it("counts matching and not matching as scored, under the set's name", () => {
    expect(
      scoredFigure({ matching: 20, notMatching: 8, insufficientData: 2 }, "Local employment"),
    ).toMatchObject({
      value: "28",
      note: "under Local employment; 2 could not be scored",
      tone: "warning",
    });
  });

  it("says so when every candidate could be scored", () => {
    const figure = scoredFigure({ matching: 3, notMatching: 0, insufficientData: 0 }, "Remote");

    expect(figure.note).toBe("under Remote, every candidate");
    expect(figure.tone).toBeUndefined();
  });
});

describe("how big a pass was", () => {
  it("counts the candidates and the attributes it covered", () => {
    expect(
      describeScope({ scope_candidates: 32, scope_attributes: 41 }),
    ).toBe("32 candidates over 41 attributes");
  });

  it("says candidate and attribute in the singular when there is one of each", () => {
    expect(describeScope({ scope_candidates: 1, scope_attributes: 1 })).toBe(
      "1 candidate over 1 attribute",
    );
  });

  /**
   * C04-N14. **A pass over exact pairs is not their cross product.** A two-item retry over two
   * candidates and two attributes asked for two values, not four, and "2 candidates over 2
   * attributes" claimed the other two.
   */
  it("counts the values a pass over exact pairs asked for", () => {
    expect(
      describeScope({ scope_candidates: 2, scope_attributes: 2, items_total: 2 }),
    ).toBe("2 values over 2 candidates");
    expect(
      describeScope({ scope_candidates: 1, scope_attributes: 3, items_total: 1 }),
    ).toBe("1 value over 1 candidate");
  });

  it("keeps the cross product where the pass asked for all of it", () => {
    expect(
      describeScope({ scope_candidates: 32, scope_attributes: 41, items_total: 1312 }),
    ).toBe("32 candidates over 41 attributes");
  });

  /** A scope of nothing is not a scope, so it reads as absent rather than as zero by zero. */
  it("says nothing rather than zero where there is no scope", () => {
    expect(describeScope({})).toBe("—");
    expect(describeScope({ scope_candidates: 5, scope_attributes: 0 })).toBe("—");
  });
});

describe("the line over the remedies", () => {
  it("says the counts are of every value at the level, by its latest outcome", () => {
    // The cards are the database's gaps (PL-054), not one acquisition's accounting.
    expect(describeGaps({ level: "country", pairs_total: 1312 })).toMatch(
      /^All 1,312 values at country level, by their latest outcome\./,
    );
  });

  it("falls back to the standing sentence while the holdings are not read", () => {
    expect(describeGaps(null)).toBe(
      "Each of these starts a new acquisition. Nothing is fetched or charged until you agree to an estimate.",
    );
  });

  it("does not claim a level with no pairs holds values", () => {
    expect(describeGaps({ level: "city", pairs_total: 0 })).toBe(describeGaps(null));
  });
});
