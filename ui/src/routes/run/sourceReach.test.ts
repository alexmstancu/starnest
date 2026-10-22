import { describe, expect, it } from "vitest";
import { inFlight, outcomeSentence, runState, sourceBars } from "./sourceReach";

describe("source by source", () => {
  /** What the catalog calls the sources these runs report: "OECD", which `oecd` cannot become. */
  const NAMES = new Map([
    ["eurostat", "Eurostat"],
    ["oecd", "OECD"],
  ]);

  it("fills each source's bar by its own success rate, not by its share of the run", () => {
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
