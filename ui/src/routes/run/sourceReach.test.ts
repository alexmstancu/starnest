import { describe, expect, it } from "vitest";
import { outcomeSentence, runState, sourceBars } from "./sourceReach";

describe("source by source", () => {
  it("fills each source's bar by its own success rate, not by its share of the run", () => {
    // Eurostat answered 100 of 100 and OECD 1 of 2. On a shared track Eurostat would dwarf
    // OECD and the reader would conclude OECD did well; on its own track OECD reads as half.
    const bars = sourceBars([
      { data_source: "eurostat", items_stored: 100, items_failed: 0 },
      { data_source: "oecd", items_stored: 1, items_failed: 1 },
    ]);

    expect(bars.map((bar) => bar.width)).toEqual(["100%", "50%"]);
  });

  it("keeps a source that stored nothing, and marks it", () => {
    // The source a reader came here to find is precisely the one that answered nothing.
    const bars = sourceBars([
      { data_source: "oecd", items_stored: 0, items_failed: 12 },
    ]);

    expect(bars).toEqual([
      {
        source: "oecd",
        width: "0%",
        reading: "0 of 12",
        sentence: "oecd: 0 stored, 12 failed",
        barren: true,
      },
    ]);
  });

  it("puts the sources that stored something above the ones that stored nothing", () => {
    const bars = sourceBars([
      { data_source: "oecd", items_stored: 0, items_failed: 4 },
      { data_source: "eurostat", items_stored: 9, items_failed: 0 },
    ]);

    expect(bars.map((bar) => bar.source)).toEqual(["eurostat", "oecd"]);
  });

  it("says only the stored count where nothing failed", () => {
    const bars = sourceBars([
      { data_source: "who", items_stored: 32, items_failed: 0 },
    ]);

    expect(bars.map((bar) => bar.reading)).toEqual(["32"]);
  });

  it("drops a row that names no source or touched nothing", () => {
    expect(
      sourceBars([
        { data_source: "", items_stored: 4, items_failed: 0 },
        { data_source: "imf", items_stored: 0, items_failed: 0 },
      ]),
    ).toEqual([]);
  });

  it("has nothing to draw for a run with no breakdown", () => {
    expect(sourceBars(null)).toEqual([]);
    expect(sourceBars(undefined)).toEqual([]);
    expect(sourceBars([])).toEqual([]);
  });

  it("survives counts that arrive missing or negative", () => {
    const bars = sourceBars([
      { data_source: "imf", items_stored: null, items_failed: 3 },
    ]);

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
