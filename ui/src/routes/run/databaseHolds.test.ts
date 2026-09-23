import { describe, expect, it } from "vitest";
import {
  describeScope,
  filledOf,
  newestRun,
  runningNow,
  spentThisMonth,
  type RunSummary,
} from "./databaseHolds";

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

describe("what has been spent this month", () => {
  const now = new Date("2026-09-21T12:00:00Z");

  it("adds up what the acquisitions since the first of the month cost", () => {
    expect(
      spentThisMonth(
        [
          run({ id: 1, started_at: "2026-09-03T09:00:00Z", cost_eur: 0.4 }),
          run({ id: 2, started_at: "2026-09-19T09:00:00Z", cost_eur: 0.21 }),
        ],
        now,
      ),
    ).toBeCloseTo(0.61, 5);
  });

  /**
   * The calendar month: a budget is held against a month, not a rolling thirty days.
   *
   * **The boundary is the reader's midnight, not UTC's.** A run stamped 31 August 23:00 UTC
   * happened on 1 September in most of Europe, and telling somebody it belongs to last month
   * because a server was on a different clock is the kind of accuracy nobody asked for.
   */
  it("leaves out last month, however recent it was", () => {
    expect(
      spentThisMonth(
        [run({ id: 1, started_at: "2026-08-20T09:00:00Z", cost_eur: 9 })],
        now,
      ),
    ).toBe(0);
  });

  it("treats a run with no recorded cost as free rather than as unknown", () => {
    expect(
      spentThisMonth([{ id: 1, run_status: "completed", started_at: "2026-09-04T09:00:00Z" }], now),
    ).toBe(0);
  });

  it("ignores a date it cannot read rather than counting it as now", () => {
    expect(
      spentThisMonth(
        [run({ id: 1, started_at: "not a date", cost_eur: 5 })],
        now,
      ),
    ).toBe(0);
  });

  it("is nothing when nothing has been run", () => {
    expect(spentThisMonth([], now)).toBe(0);
  });
});

describe("what an acquisition filled", () => {
  it("reports what it reached of what it asked about", () => {
    expect(filledOf({ items_total: 1312, items_completed: 1238 })).toEqual({
      filled: 1238,
      asked: 1312,
    });
  });

  /** A run with no progress yet reads as nothing of nothing, never as undefined. */
  it("reads an absent progress as nothing rather than as a blank", () => {
    expect(filledOf(null)).toEqual({ filled: 0, asked: 0 });
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

  /** A scope of nothing is not a scope, so it reads as absent rather than as zero by zero. */
  it("says nothing rather than zero where there is no scope", () => {
    expect(describeScope({})).toBe("—");
    expect(describeScope({ scope_candidates: 5, scope_attributes: 0 })).toBe("—");
  });
});
