import { describe, expect, it } from "vitest";
import {
  accountedFor,
  askedOfSources,
  describeLeftOut,
  describeNotReached,
  describeRecord,
  diffAcquisitions,
  levelHeading,
  producedBy,
  progressOf,
  readsBackwards,
  runIdFrom,
  type ProducedValue,
} from "./acquisitionDiff";

const value = (
  candidate: string,
  attribute: string,
  data_source = "eurostat",
): ProducedValue => ({ candidate, attribute, data_source });

/** Every pair either side holds counts as asked: the cases below are about classification. */
function compareAll(
  earlier: readonly ProducedValue[],
  later: readonly ProducedValue[],
) {
  return diffAcquisitions(earlier, later, [...earlier, ...later]);
}

const RENT = "country.rent";
const TAX = "country.tax";
const PT = "country.portugal";
const ES = "country.spain";

describe("what changed between two acquisitions", () => {
  it("calls a pair only the later run produced newly acquired", () => {
    const diff = compareAll([], [value(PT, RENT)]);

    expect(diff.newlyAcquired).toBe(1);
    expect(diff.rows[0]).toMatchObject({
      candidate: PT,
      attribute: RENT,
      change: "newly acquired",
    });
  });

  it("calls a pair both runs produced refreshed", () => {
    const diff = compareAll([value(PT, RENT)], [value(PT, RENT)]);

    expect(diff.refreshed).toBe(1);
    expect(diff.rows[0]?.change).toBe("refreshed");
  });

  /**
   * **"Went missing" is about the run, never about the store.** The earlier value is still
   * stored and may still be the active one -- this application never deletes a value.
   */
  it("calls a pair only the earlier run produced went missing", () => {
    const diff = compareAll([value(PT, RENT)], []);

    expect(diff.wentMissing).toBe(1);
    expect(diff.rows[0]?.change).toBe("went missing");
  });

  it("counts each kind separately", () => {
    const diff = compareAll(
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
    const diff = compareAll([value(PT, RENT)], [value(PT, RENT)]);

    expect(diff.newlyAcquired).toBe(0);
    expect(diff.wentMissing).toBe(0);
  });

  it("finds nothing at all between two empty runs", () => {
    expect(compareAll([], [])).toEqual({
      rows: [],
      newlyAcquired: 0,
      refreshed: 0,
      unchanged: 0,
      wentMissing: 0,
      leftOut: 0,
    });
  });

  /** A candidate and an attribute together are the unit; neither identifies a pair alone. */
  it("treats the same attribute for two candidates as two pairs", () => {
    const diff = compareAll([], [value(PT, RENT), value(ES, RENT)]);

    expect(diff.newlyAcquired).toBe(2);
  });

  it("treats two attributes for one candidate as two pairs", () => {
    const diff = compareAll([], [value(PT, RENT), value(PT, TAX)]);

    expect(diff.newlyAcquired).toBe(2);
  });

  it("reads in a fixed order, so the same two runs always look the same", () => {
    const diff = compareAll(
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
    const diff = compareAll([], [value(PT, RENT, "oecd")]);

    expect(diff.rows[0]?.data_source).toBe("oecd");
  });

  /**
   * C04-N8. **The unit is the pair and its source.** Keyed without the source, the last of two
   * figures for one pair won, so OECD's tax rate and the estimate's read as one row with
   * whichever arrived last.
   */
  it("compares a pair two sources answered source by source", () => {
    const diff = compareAll(
      [{ ...value(PT, TAX, "oecd"), payload: { count: 40 } }],
      [
        { ...value(PT, TAX, "oecd"), payload: { count: 40 } },
        { ...value(PT, TAX, "eurostat_estimate"), payload: { count: 42 } },
      ],
    );

    expect(
      diff.rows.map((row) => [row.data_source, row.change]),
    ).toEqual([
      ["eurostat_estimate", "newly acquired"],
      ["oecd", "unchanged"],
    ]);
  });
});

/**
 * PL-060. **Only what the later acquisition asked about is compared.** Built from value rows
 * alone, a two-item retry against a sweep listed every other pair of the sweep as "went
 * missing" -- 624 rows about pairs the retry never asked.
 */
describe("what the later acquisition asked about", () => {
  const sweep = [value(PT, RENT), value(PT, TAX), value(ES, RENT)];

  it("compares no pair the later acquisition never asked about", () => {
    const diff = diffAcquisitions(sweep, [value(PT, RENT)], [value(PT, RENT)]);

    expect(diff.rows.map((row) => [row.candidate, row.attribute])).toEqual([
      [PT, RENT],
    ]);
    expect(diff.wentMissing).toBe(0);
    expect(diff.leftOut).toBe(2);
  });

  it("says a pair it asked about and produced nothing for went missing", () => {
    const diff = diffAcquisitions(sweep, [], [value(PT, TAX)]);

    expect(diff.rows).toMatchObject([
      { candidate: PT, attribute: TAX, change: "went missing" },
    ]);
  });

  it("asks each source only what it produced or failed on", () => {
    const asked = askedOfSources([value(PT, RENT), value(PT, RENT, "oecd")], [
      { ...value(PT, TAX, "oecd") },
    ]);

    expect(asked.map((each) => `${each.candidate}|${each.attribute}|${each.data_source}`)).toEqual([
      `${PT}|${RENT}|eurostat`,
      `${PT}|${RENT}|oecd`,
      `${PT}|${TAX}|oecd`,
    ]);
  });

  /**
   * Review of PL-060. **The unit is the pair and its source, and so is what was asked.** OECD's
   * earlier figure for a pair the estimate answered read "went missing" although nobody asked
   * OECD about it.
   */
  it("does not call missing a source the later run did not ask about a pair another answered", () => {
    const earlier = [{ ...value(PT, TAX, "oecd"), payload: { count: 40 } }];
    const later = [{ ...value(PT, TAX, "eurostat_estimate"), payload: { count: 42 } }];

    const diff = diffAcquisitions(earlier, later, askedOfSources(later, []));

    expect(diff.rows.map((row) => [row.data_source, row.change])).toEqual([
      ["eurostat_estimate", "newly acquired"],
    ]);
    expect(diff.leftOut).toBe(1);
  });

  it("does not call missing a source a selective retry left out", () => {
    const earlier = [
      { ...value(PT, TAX, "oecd"), payload: { count: 40 } },
      { ...value(PT, TAX, "eurostat_estimate"), payload: { count: 42 } },
    ];
    // The retry asked OECD alone, and OECD failed again.
    const failures = [value(PT, TAX, "oecd")];

    const diff = diffAcquisitions(earlier, [], askedOfSources([], failures));

    expect(diff.rows.map((row) => [row.data_source, row.change])).toEqual([
      ["oecd", "went missing"],
    ]);
    expect(diff.leftOut).toBe(1);
  });

  it("does not call missing an unanswered pair's earlier figure, whose source no record names", () => {
    const diff = diffAcquisitions([value(PT, RENT)], [], askedOfSources([], []));

    expect(diff.rows).toEqual([]);
    expect(diff.leftOut).toBe(1);
  });

  it("accounts for every item a run produced, failed on, left unanswered or never reached", () => {
    expect(
      accountedFor([value(PT, RENT), value(PT, RENT, "oecd")], {
        failures: [value(PT, TAX, "oecd")],
        unanswered: [{ candidate: ES, attribute: RENT }],
        not_reached: [{ candidate: ES, attribute: TAX }],
      }),
    ).toBe(4);
  });

  it("says how many earlier figures were left out", () => {
    expect(describeLeftOut(0)).toBeNull();
    expect(describeLeftOut(1)).toBe(
      "1 figure from the earlier acquisition is from a source the later one is not recorded as asking for that value, so it is not compared.",
    );
    expect(describeLeftOut(624)).toBe(
      "624 figures from the earlier acquisition are from sources the later one is not recorded as asking for those values, so they are not compared.",
    );
  });
});

/**
 * PL-049. **A re-read that restates a stored figure writes no value**, so a diff built from
 * value rows alone called every re-confirmed figure "went missing" -- run 132 against itself
 * read "Neither acquisition produced a figure" over a run that said "1 figure stored".
 */
describe("a figure the later acquisition re-confirmed", () => {
  const stored = {
    id: 41,
    candidate: PT,
    attribute: RENT,
    data_source: "rsf",
    payload: { count: 7 },
  };
  const reconfirmation = {
    candidate: PT,
    attribute: RENT,
    data_source: "rsf",
    value: 41,
  };

  it("reads as unchanged, with the same figure on both sides", () => {
    const later = producedBy({
      stored: [],
      reconfirmed: [reconfirmation],
      reconfirmedValues: [stored],
    });

    const diff = diffAcquisitions([stored], later, askedOfSources(later, []));

    expect(diff.rows).toMatchObject([
      { change: "unchanged", earlier: "7", later: "7" },
    ]);
  });

  it("reads a re-confirmation of a newer transcription as refreshed", () => {
    const newer = { ...stored, id: 42, payload: { count: 9 } };
    const later = producedBy({
      stored: [],
      reconfirmed: [{ ...reconfirmation, value: 42 }],
      reconfirmedValues: [newer],
    });

    const diff = diffAcquisitions([stored], later, askedOfSources(later, []));

    expect(diff.rows).toMatchObject([
      { change: "refreshed", earlier: "7", later: "9" },
    ]);
  });

  it("never calls a re-confirmation whose figure is unknown unchanged", () => {
    const later = producedBy({
      stored: [],
      reconfirmed: [{ ...reconfirmation, value: null }],
      reconfirmedValues: [],
    });

    const diff = diffAcquisitions([stored], later, askedOfSources(later, []));

    expect(diff.rows).toMatchObject([
      { change: "refreshed", earlier: "7", later: "not recorded" },
    ]);
  });

  it("takes each re-confirmed figure from the row its id names, whatever order they arrive in", () => {
    const spain = { ...stored, id: 43, candidate: ES, payload: { count: 3 } };
    const later = producedBy({
      stored: [],
      reconfirmed: [reconfirmation, { ...reconfirmation, candidate: ES, value: 43 }],
      reconfirmedValues: [spain, stored],
    });

    expect(later.map((each) => [each.candidate, each.payload])).toEqual([
      [PT, { count: 7 }],
      [ES, { count: 3 }],
    ]);
  });

  it("never takes a figure the id does not name", () => {
    const later = producedBy({
      stored: [],
      reconfirmed: [{ ...reconfirmation, value: 99 }],
      reconfirmedValues: [stored],
    });

    expect(later[0]?.payload).toBeUndefined();
  });

  it("keeps what the run stored beside what it re-confirmed", () => {
    const fresh = { ...value(ES, TAX), id: 50, payload: { count: 3 } };
    const produced = producedBy({
      stored: [fresh],
      reconfirmed: [reconfirmation],
      reconfirmedValues: [stored],
    });

    expect(produced).toMatchObject([fresh, stored]);
  });
});

/**
 * C04-N8. **A rejected figure is no usable figure.** It has nothing a reader could rely on, so
 * a later rejection over a stored figure went missing -- and its cell says why, rather than
 * leaving an empty one that reads as "not asked".
 */
describe("a rejected figure", () => {
  const usable = { ...value(PT, RENT), payload: { count: 5 } };
  const rejected = {
    ...value(PT, RENT),
    payload: { count: 500 },
    rejection_reason: "outside the credible range",
  };

  it("went missing when the later acquisition rejected it, and its cell reads rejected", () => {
    const diff = compareAll([usable], [rejected]);

    expect(diff.rows).toMatchObject([
      { change: "went missing", earlier: "5", later: "rejected" },
    ]);
  });

  it("is newly acquired once a later acquisition produced a usable one", () => {
    const diff = compareAll([rejected], [usable]);

    expect(diff.rows).toMatchObject([
      { change: "newly acquired", earlier: "rejected", later: "5" },
    ]);
  });

  it("is not compared when neither side has a usable figure", () => {
    expect(compareAll([rejected], [rejected]).rows).toEqual([]);
  });

  it("does not hide a usable figure the same run produced beside it", () => {
    const diff = compareAll([usable], [usable, rejected]);

    expect(diff.rows).toMatchObject([{ change: "unchanged" }]);
  });
});

describe("what is said about the later acquisition's record", () => {
  it("says nothing when its asked values account for every item", () => {
    expect(
      describeRecord(3, { id: 7, run_status: "completed", progress: { items_total: 3 } }),
    ).toBeNull();
  });

  it("says the comparison may be incomplete when they do not", () => {
    expect(
      describeRecord(6, { id: 7, run_status: "completed", progress: { items_total: 96 } }),
    ).toBe(
      "Acquisition 7's record accounts for 6 of the 96 values it asked for, so this comparison may be incomplete.",
    );
  });

  it("does not call a halted run's record incomplete for the values it never reached", () => {
    expect(
      describeRecord(96, {
        id: 7,
        run_status: "halted_by_user",
        progress: { items_total: 96 },
      }),
    ).toBeNull();
  });

  it("says a run still going is compared on what it has settled", () => {
    expect(
      describeRecord(1, { id: 7, run_status: "running", progress: { items_total: 96 } }),
    ).toBe(
      "Acquisition 7 is still running, so this compares what it has settled so far.",
    );
  });
});

/** Review of PL-060. Values the later run never reached are not asked, and that is said. */
describe("what the later acquisition never reached", () => {
  const notReached = [
    { candidate: PT, attribute: RENT },
    { candidate: PT, attribute: TAX },
  ];

  it("says nothing when it reached everything", () => {
    expect(describeNotReached({ id: 7, not_reached: [], plan_recorded: true })).toBeNull();
  });

  it("says how many values its plan named and it never reached", () => {
    expect(
      describeNotReached({ id: 7, not_reached: notReached, plan_recorded: true }),
    ).toBe("2 values acquisition 7 planned were never reached, so they are not compared.");
  });

  it("does not claim a plan for a run that recorded none", () => {
    expect(
      describeNotReached({ id: 7, not_reached: notReached.slice(0, 1), plan_recorded: false }),
    ).toBe(
      "1 value acquisition 7 was to ask about has neither a figure nor a failure. It started before acquisitions recorded their plan, so whether it was asked is not known, and it is not compared.",
    );
  });
});

describe("two acquisitions picked out of order", () => {
  const runs = [
    { id: 5, started_at: "2025-09-11T08:00:00Z" },
    { id: 7, started_at: "2026-08-29T18:02:00Z" },
  ];

  it("reads backwards when the earlier pick started after the later one", () => {
    expect(readsBackwards(runs, 7, 5)).toBe(true);
  });

  it("reads forwards otherwise, and for a run the history does not list", () => {
    expect(readsBackwards(runs, 5, 7)).toBe(false);
    expect(readsBackwards(runs, 9, 5)).toBe(false);
  });
});

describe("the heading over the candidates", () => {
  it("names the level the later acquisition covered", () => {
    expect(levelHeading("country")).toBe("Country");
    expect(levelHeading("city")).toBe("City");
  });

  it("falls back to a candidate where the level is not known", () => {
    expect(levelHeading(undefined)).toBe("Candidate");
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
    const diff = compareAll(
      [{ ...pair, payload: { magnitude: 780, unit: "EUR" } }],
      [{ ...pair, payload: { magnitude: 780, unit: "EUR" } }],
    );

    expect(diff.unchanged).toBe(1);
    expect(diff.refreshed).toBe(0);
  });

  it("calls it refreshed when the figure moved", () => {
    const diff = compareAll(
      [{ ...pair, payload: { magnitude: 780, unit: "EUR" } }],
      [{ ...pair, payload: { magnitude: 812, unit: "EUR" } }],
    );

    expect(diff.refreshed).toBe(1);
    expect(diff.unchanged).toBe(0);
  });

  it("carries both figures, so the verdict can be checked rather than trusted", () => {
    const [row] = compareAll(
      [{ ...pair, payload: { magnitude: 780, unit: "EUR" } }],
      [{ ...pair, payload: { magnitude: 812, unit: "EUR" } }],
    ).rows;

    expect(row?.earlier).toBe("780 EUR");
    expect(row?.later).toBe("812 EUR");
  });

  it("leaves the later figure empty for a pair that went missing", () => {
    const [row] = compareAll(
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
    const diff = compareAll([{ ...pair }], [{ ...pair }]);

    expect(diff.refreshed).toBe(1);
    expect(diff.unchanged).toBe(0);
  });

  it("puts the rows nobody has to act on last", () => {
    const diff = compareAll(
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
    const diff = compareAll(
      [{ ...pair, payload: { magnitude: 1.071, unit: "ladder_points" } }],
      [{ ...pair, payload: { magnitude: 1.074, unit: "ladder_points" } }],
    );

    expect(diff.refreshed).toBe(1);
    expect(diff.unchanged).toBe(0);
  });

  it("shows the exact figures when the rounded ones would read the same", () => {
    const [row] = compareAll(
      [{ ...pair, payload: { magnitude: 1.071, unit: "ladder_points" } }],
      [{ ...pair, payload: { magnitude: 1.074, unit: "ladder_points" } }],
    ).rows;

    expect(row?.earlier).toBe("1.071 ladder points");
    expect(row?.later).toBe("1.074 ladder points");
  });

  it("keeps the rounded figures where they already tell the two apart", () => {
    const [row] = compareAll(
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
    const diff = compareAll(
      [{ ...rent, payload: { amount: 1000, currency: "CHF", amount_eur: 1061.2 } }],
      [{ ...rent, payload: { amount: 1000, currency: "CHF", amount_eur: 1063.5 } }],
    );
    const [row] = diff.rows;

    expect(diff.refreshed).toBe(1);
    expect(row?.earlier).toBe("1000 CHF (1061.2 EUR)");
    expect(row?.later).toBe("1000 CHF (1063.5 EUR)");
  });

  it("calls the same converted amount unchanged, and shows both its amounts", () => {
    const rent = { ...pair, attribute: "country.rent_one_bedroom_centre" };
    const payload = { amount: 1000, currency: "CHF", amount_eur: 1061.2 };
    const diff = compareAll([{ ...rent, payload }], [{ ...rent, payload }]);
    const [row] = diff.rows;

    expect(diff.unchanged).toBe(1);
    expect(row?.earlier).toBe("1000 CHF (1061.2 EUR)");
    expect(row?.later).toBe("1000 CHF (1061.2 EUR)");
  });

  it("stays at readable precision where the amounts already tell the two apart", () => {
    const rent = { ...pair, attribute: "country.rent_one_bedroom_centre" };
    const [row] = compareAll(
      [{ ...rent, payload: { amount: 1000, currency: "CHF", amount_eur: 1061.2 } }],
      [{ ...rent, payload: { amount: 1100, currency: "CHF", amount_eur: 1167.324 } }],
    ).rows;

    expect(row?.earlier).toBe("1000 CHF (1061.2 EUR)");
    expect(row?.later).toBe("1100 CHF (1167.32 EUR)");
  });

  it("shows every digit where two converted amounts read the same at readable precision", () => {
    const rent = { ...pair, attribute: "country.rent_one_bedroom_centre" };
    const [row] = compareAll(
      [{ ...rent, payload: { amount: 1000, currency: "CHF", amount_eur: 1061.2341 } }],
      [{ ...rent, payload: { amount: 1000, currency: "CHF", amount_eur: 1061.2349 } }],
    ).rows;

    expect(row?.earlier).toBe("1000 CHF (1061.2341 EUR)");
    expect(row?.later).toBe("1000 CHF (1061.2349 EUR)");
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
      const diff = compareAll(
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
      const [row] = compareAll(
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
      const diff = compareAll(
        [score("Permits take six weeks")],
        [score("Permits take six weeks")],
      );
      const [row] = diff.rows;

      expect(diff.unchanged).toBe(1);
      expect(row?.earlier).toBe("7 on 0–10 (assigned by human)");
      expect(row?.later).toBe("7 on 0–10 (assigned by human)");
    });

    it("keeps the scores alone where their numbers already tell the two apart", () => {
      const [row] = compareAll(
        [score("Permits take three months", 6)],
        [score("Permits take six weeks", 7)],
      ).rows;

      expect(row?.earlier).toBe("6 on 0–10 (assigned by human)");
      expect(row?.later).toBe("7 on 0–10 (assigned by human)");
    });
  });

  it("calls the same payload unchanged whatever the order of its keys", () => {
    const diff = compareAll(
      [{ ...pair, payload: { magnitude: 7.1, unit: "ladder_points" } }],
      [{ ...pair, payload: { unit: "ladder_points", magnitude: 7.1 } }],
    );

    expect(diff.unchanged).toBe(1);
  });

  it("calls a changed unit with the same magnitude a move", () => {
    const diff = compareAll(
      [{ ...pair, payload: { magnitude: 7.1, unit: "ladder_points" } }],
      [{ ...pair, payload: { magnitude: 7.1, unit: "pisa_points" } }],
    );

    expect(diff.refreshed).toBe(1);
  });

  it("calls a field the later payload gained a move", () => {
    const diff = compareAll(
      [{ ...pair, payload: { count: 412 } }],
      [{ ...pair, payload: { count: 412, basis: "per_capita" } }],
    );

    expect(diff.refreshed).toBe(1);
  });

  it("never calls a payload missing on one side unchanged", () => {
    const diff = compareAll(
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
    const diff = compareAll(
      [{ ...pair, payload: { labels: ["Siemens", "OutSystems"] } }],
      [{ ...pair, payload: { labels: ["OutSystems", "Siemens"] } }],
    );

    expect(diff.refreshed).toBe(1);
  });

  it("calls the same label set unchanged", () => {
    const diff = compareAll(
      [{ ...pair, payload: { labels: ["Siemens", "OutSystems"] } }],
      [{ ...pair, payload: { labels: ["Siemens", "OutSystems"] } }],
    );

    expect(diff.unchanged).toBe(1);
  });

  it("calls a label set that lost a label a move", () => {
    const diff = compareAll(
      [{ ...pair, payload: { labels: ["Siemens", "OutSystems"] } }],
      [{ ...pair, payload: { labels: ["Siemens"] } }],
    );

    expect(diff.refreshed).toBe(1);
  });

  it("does not mistake a list for a record with the same entries", () => {
    const diff = compareAll(
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
    const diff = compareAll(
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

/** UIR-A1: the key the diff reads its runs again on. */
describe("where the compared runs stand", () => {
  const going = { id: 7, run_status: "running", items_completed: 1, items_failed: 0 };
  const done = { id: 5, run_status: "completed", items_completed: 9, items_failed: 1 };

  it("changes when a compared run completes another item", () => {
    expect(progressOf([going, done], [5, 7])).not.toBe(
      progressOf([{ ...going, items_completed: 2 }, done], [5, 7]),
    );
  });

  it("changes when a compared run finishes", () => {
    expect(progressOf([going, done], [5, 7])).not.toBe(
      progressOf([{ ...going, run_status: "completed" }, done], [5, 7]),
    );
  });

  it("does not change for a run that is not being compared", () => {
    const other = { id: 9, run_status: "running", items_completed: 1 };
    expect(progressOf([going, done, other], [5, 7])).toBe(
      progressOf([going, done, { ...other, items_completed: 5 }], [5, 7]),
    );
  });

  /**
   * RB-3. **A run still going is read again on every read of the history.** Its counts cover
   * distinct pairs, reused ones included, so another source's figure for a pair already counted
   * moves no counter; only a finished run is known to have stopped storing figures.
   */
  it("changes with every read of the history while a compared run is still going", () => {
    expect(progressOf([going, done], [5, 7], 1)).not.toBe(progressOf([going, done], [5, 7], 2));
  });

  it("does not change with a read of the history when both runs have finished", () => {
    const finished = { ...going, run_status: "completed" };
    expect(progressOf([finished, done], [5, 7], 1)).toBe(progressOf([finished, done], [5, 7], 2));
  });

  it("stays put for a run the history no longer lists, and for no choice at all", () => {
    expect(progressOf([done], [5, 7])).toBe(progressOf([done], [5, 7]));
    expect(progressOf([], [null, null])).toBe("null:?|null:?");
  });
});
