import { describe, expect, it } from "vitest";
import {
  acquisitionInFlight,
  inFlight,
  outcomeSentence,
  planNote,
  runState,
  sourceBars,
} from "./sourceReach";

describe("source by source", () => {
  /** What the catalog calls the sources these runs report: "OECD", which `oecd` cannot become. */
  const NAMES = new Map([
    ["eurostat", "Eurostat"],
    ["oecd", "OECD"],
  ]);

  /** PL-055. Progress through its own plan, the design's "Eurostat 634 / 634". */
  it("fills each source's bar by what it was asked out of what was planned", () => {
    const bars = sourceBars(
      [
        { data_source: "eurostat", items_stored: 600, items_failed: 4, items_planned: 634, items_asked: 634 },
        { data_source: "oecd", items_stored: 1, items_failed: 1, items_planned: 8, items_asked: 2 },
      ],
      NAMES,
      "running",
    );

    expect(bars.map((bar) => [bar.width, bar.reading, bar.sentence])).toEqual([
      ["100%", "634 of 634", "Eurostat: asked about 634 of 634, 600 stored, 4 failed"],
      ["25%", "2 of 8", "OECD: asked about 2 of 8, 1 stored, 1 failed"],
    ]);
  });

  /** The source a stopped run never got to is listed, not dropped (AQ-10). */
  it("lists a source planned but never asked as not reached once the run stopped early", () => {
    for (const state of ["stopping", "halted_by_user", "halted_on_spend_cap", "failed"]) {
      const bars = sourceBars(
        [
          { data_source: "oecd", items_stored: 0, items_failed: 0, items_planned: 32, items_asked: 0 },
          { data_source: "eurostat", items_stored: 9, items_failed: 0, items_planned: 9, items_asked: 9 },
        ],
        NAMES,
        state,
      );

      expect(bars.map((bar) => bar.source)).toEqual(["eurostat", "oecd"]);
      expect(bars[1]).toMatchObject({
        width: "0%",
        reading: "not reached",
        sentence: "OECD: not reached, 32 planned",
        notReached: true,
        barren: false,
      });
    }
  });

  it("reads a source not yet asked as nothing done while the run is still going", () => {
    const [bar] = sourceBars(
      [{ data_source: "oecd", items_stored: 0, items_failed: 0, items_planned: 32, items_asked: 0 }],
      NAMES,
      "running",
    );

    expect(bar).toMatchObject({ reading: "0 of 32", notReached: false });
  });

  it("never reads more asked than planned", () => {
    const [bar] = sourceBars(
      [{ data_source: "oecd", items_stored: 3, items_failed: 0, items_planned: 2, items_asked: 5 }],
      NAMES,
      "completed",
    );

    expect(bar).toMatchObject({ width: "100%", reading: "2 of 2" });
  });

  it("says when the plan was not recorded, and only then", () => {
    expect(planNote(false)).toMatch(/^Plan not recorded/);
    expect(planNote(true)).toBe("");
    expect(planNote(undefined)).toBe("");
  });

  it("fills a run without a plan by its own success rate, not by its share of the run", () => {
    // Eurostat answered 100 of 100 and OECD 1 of 2. On a shared track Eurostat would dwarf
    // OECD and the reader would conclude OECD did well; on its own track OECD reads as half.
    const bars = sourceBars(
      [
        { data_source: "eurostat", items_stored: 100, items_failed: 0 },
        { data_source: "oecd", items_stored: 1, items_failed: 1 },
      ],
      NAMES,
    );

    expect(bars.map((bar) => bar.width)).toEqual(["100%", "50%"]);
  });

  it("keeps a source that stored nothing, and marks it", () => {
    // The source a reader came here to find is precisely the one that answered nothing.
    const bars = sourceBars(
      [{ data_source: "oecd", items_stored: 0, items_failed: 12 }],
      NAMES,
    );

    expect(bars).toEqual([
      {
        source: "oecd",
        name: "OECD",
        width: "0%",
        reading: "0 of 12",
        sentence: "OECD: 0 stored, 12 failed",
        barren: true,
        notReached: false,
      },
    ]);
  });

  /**
   * RB-4. **No programmatic identifiers in rendered text**, and the label and the sentence are
   * all a bar prints -- the sentence is its accessible name and its tooltip. The id stays on the
   * bar as `source`, which is what tells one bar from another and is never printed.
   */
  it("names each source as the catalog does, in its label and its sentence", () => {
    const [bar] = sourceBars(
      [{ data_source: "world_bank", items_stored: 32, items_failed: 0 }],
      new Map([["world_bank", "World Bank"]]),
    );

    expect(bar).toMatchObject({
      source: "world_bank",
      name: "World Bank",
      sentence: "World Bank: 32 stored",
    });
  });

  it("names a source by its id made readable until the catalog answers", () => {
    const [bar] = sourceBars(
      [{ data_source: "world_bank", items_stored: 30, items_failed: 2 }],
      new Map(),
    );

    expect(bar?.name).toBe("World bank");
    expect(bar?.sentence).toBe("World bank: 30 stored, 2 failed");
  });

  /**
   * **Ordered by id, not by name, on purpose.** The names arrive after the bars do; an order
   * taken from them would move every bar under the reader's eye the moment the catalog
   * answered. `eurostat_estimate` is named "Estimated from Eurostat tax-benefit figures", which
   * sorts above "Eurostat" -- and the bars stay where they were drawn.
   */
  it("keeps its order when the names arrive", () => {
    const reaches = [
      { data_source: "eurostat_estimate", items_stored: 5, items_failed: 0 },
      { data_source: "eurostat", items_stored: 9, items_failed: 0 },
    ];
    const named = new Map([
      ["eurostat", "Eurostat"],
      ["eurostat_estimate", "Estimated from Eurostat tax-benefit figures"],
    ]);

    expect(sourceBars(reaches, new Map()).map((bar) => bar.source)).toEqual([
      "eurostat",
      "eurostat_estimate",
    ]);
    expect(sourceBars(reaches, named).map((bar) => bar.source)).toEqual([
      "eurostat",
      "eurostat_estimate",
    ]);
  });

  it("puts the sources that stored something above the ones that stored nothing", () => {
    const bars = sourceBars(
      [
        { data_source: "oecd", items_stored: 0, items_failed: 4 },
        { data_source: "eurostat", items_stored: 9, items_failed: 0 },
      ],
      NAMES,
    );

    expect(bars.map((bar) => bar.source)).toEqual(["eurostat", "oecd"]);
  });

  it("says only the stored count where nothing failed", () => {
    const bars = sourceBars(
      [{ data_source: "who", items_stored: 32, items_failed: 0 }],
      NAMES,
    );

    expect(bars.map((bar) => bar.reading)).toEqual(["32"]);
  });

  it("drops a row that names no source or touched nothing", () => {
    expect(
      sourceBars(
        [
          { data_source: "", items_stored: 4, items_failed: 0 },
          { data_source: "imf", items_stored: 0, items_failed: 0 },
        ],
        NAMES,
      ),
    ).toEqual([]);
  });

  it("has nothing to draw for a run with no breakdown", () => {
    expect(sourceBars(null, NAMES)).toEqual([]);
    expect(sourceBars(undefined, NAMES)).toEqual([]);
    expect(sourceBars([], NAMES)).toEqual([]);
  });

  it("survives counts that arrive missing or negative", () => {
    const bars = sourceBars(
      [{ data_source: "imf", items_stored: null, items_failed: 3 }],
      NAMES,
    );

    expect(bars.map((bar) => bar.width)).toEqual(["0%"]);
  });
});

describe("what the run came to", () => {
  it("says nothing while the run is still going", () => {
    // A sentence about what a run "came to" while it runs claims an outcome that has not
    // happened. The bar above it is already saying where it is.
    expect(
      outcomeSentence("running", { items_completed: 4, items_failed: 0 }),
    ).toBe("");
  });

  it("names the three counts a finished run left behind", () => {
    expect(
      outcomeSentence("completed", {
        items_completed: 1254,
        items_failed: 3,
        items_unanswered: 62,
      }),
    ).toBe("Finished. 1254 figures stored, 3 failed, 62 nobody answered.");
  });

  it("leaves out a count of zero rather than reporting it", () => {
    expect(
      outcomeSentence("completed", {
        items_completed: 32,
        items_failed: 0,
        items_unanswered: 0,
      }),
    ).toBe("Finished. 32 figures stored.");
  });

  it("says what the spend cap did, because halting is not failing", () => {
    expect(
      outcomeSentence("halted_on_spend_cap", { items_completed: 8 }),
    ).toBe(
      "Stopped at the spend cap, keeping everything it had written. 8 figures stored.",
    );
  });

  it("does not finish rather than fails, for a run whose process died", () => {
    expect(outcomeSentence("failed", { items_completed: 0 })).toBe(
      "Did not finish. 0 figures stored.",
    );
  });

  /** PL-050. Nobody was asked about these, so they are never "nobody answered". */
  it("names what a stopped run never reached apart from what nobody answered", () => {
    expect(
      outcomeSentence("halted_by_user", {
        items_completed: 30,
        items_failed: 0,
        items_unanswered: 2,
        items_not_reached: 68,
      }),
    ).toBe(
      "Stopped when you asked, keeping everything it had written. 30 figures stored, 2 nobody answered, 68 not reached.",
    );
  });

  it("agrees with itself about one figure", () => {
    expect(outcomeSentence("completed", { items_completed: 1 })).toBe(
      "Finished. 1 figure stored.",
    );
  });

  it("has nothing to say about a status it was never given", () => {
    expect(outcomeSentence(null, { items_completed: 3 })).toBe("");
    expect(outcomeSentence(undefined, null)).toBe("");
  });
});


describe("what to call a run's state", () => {
  it("says stopping for a run somebody asked to stop", () => {
    // Still `running` on the server, and will be until the source in flight finishes. Telling
    // a reader "running" there is true and useless: they have just clicked Stop.
    expect(runState("running", "2026-09-24T09:00:00Z")).toBe("stopping");
  });

  it("leaves every other status alone", () => {
    expect(runState("running", null)).toBe("running");
    expect(runState("completed", null)).toBe("completed");
    // A finished run that was stopped reports what it ended as, not that it is stopping.
    expect(runState("halted_by_user", "2026-09-24T09:00:00Z")).toBe("halted_by_user");
    expect(runState("halted_on_spend_cap", null)).toBe("halted_on_spend_cap");
  });

  it("has nothing to say about a status it was never given", () => {
    expect(runState(null, null)).toBe("");
    expect(runState(undefined, "2026-09-24T09:00:00Z")).toBe("");
  });
});


describe("whether a run is still going", () => {
  /**
   * What leads the Acquire screen turns on this. A reader arriving mid-run came for the run;
   * a reader arriving afterwards came for the figures and the remedies.
   */
  it("counts a run that is running, and one that has not started asking yet", () => {
    expect(inFlight("running")).toBe(true);
    expect(inFlight("planned")).toBe(true);
  });

  it("counts no run that has stopped, however it stopped", () => {
    expect(inFlight("completed")).toBe(false);
    expect(inFlight("failed")).toBe(false);
    expect(inFlight("halted_on_spend_cap")).toBe(false);
    expect(inFlight("halted_by_user")).toBe(false);
  });

  /**
   * It ends when the source in flight finishes, which is the one moment its progress is worth
   * watching. **Asked with either of the two**, because `runState` hands back a state and the
   * run hands back a status, and a predicate that disagreed with itself across them would be a
   * trap for whoever next passed the other one.
   */
  it("counts a run somebody has asked to stop, because it has not stopped", () => {
    expect(inFlight("running")).toBe(true);
    expect(inFlight(runState("running", "2026-09-24T09:00:00Z"))).toBe(true);
  });

  it("counts nothing where there is no run", () => {
    expect(inFlight(null)).toBe(false);
    expect(inFlight(undefined)).toBe(false);
    expect(inFlight("")).toBe(false);
  });
});


describe("which acquisition is still going", () => {
  it("is the run on the card when that one is in flight", () => {
    expect(acquisitionInFlight({ id: 9, run_status: "running" }, [])).toBe(9);
  });

  it("is the newest running one in the history when the card shows another", () => {
    expect(
      acquisitionInFlight({ id: 5, run_status: "completed" }, [
        { id: 7, run_status: "running" },
        { id: 5, run_status: "completed" },
      ]),
    ).toBe(7);
    expect(acquisitionInFlight(null, [{ id: 7, run_status: "running" }])).toBe(7);
  });

  /** The card is re-read on its own, so a stale history row does not hold the remedies. */
  it("believes the card over a stale history row for the same run", () => {
    expect(
      acquisitionInFlight({ id: 7, run_status: "completed" }, [{ id: 7, run_status: "running" }]),
    ).toBeNull();
  });

  it("is none when nothing is going", () => {
    expect(acquisitionInFlight(null, [])).toBeNull();
    expect(acquisitionInFlight(null, [{ id: 7, run_status: "halted_by_user" }])).toBeNull();
  });
});
