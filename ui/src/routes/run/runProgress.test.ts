import { describe, expect, it } from "vitest";
import { progressBar } from "./runProgress";

describe("how far a run has got", () => {
  it("draws one segment per outcome the run actually had", () => {
    const bar = progressBar({
      items_total: 100,
      items_completed: 50,
      items_failed: 30,
      items_unanswered: 20,
    });
    expect(bar.segments.map((segment) => segment.kind)).toEqual([
      "completed",
      "failed",
      "unanswered",
    ]);
    expect(bar.segments[0]).toMatchObject({ x: "0%", width: "50%" });
    expect(bar.segments[1]).toMatchObject({ x: "50%", width: "30%" });
    expect(bar.segments[2]).toMatchObject({ x: "80%", width: "20%" });
  });

  /** A zero-width segment is invisible anyway, and claims a part the run does not have. */
  it("leaves out an outcome that did not happen", () => {
    const bar = progressBar({
      items_total: 10,
      items_completed: 10,
      items_failed: 0,
      items_unanswered: 0,
    });
    expect(bar.segments).toHaveLength(1);
    expect(bar.settled).toBe(100);
  });

  /** `reqs.md` Q217: the three counts close, so a part-done run leaves track unfilled. */
  it("leaves the rest of the track empty while a run is still going", () => {
    const bar = progressBar({
      items_total: 100,
      items_completed: 20,
      items_failed: 0,
      items_unanswered: 0,
    });
    expect(bar.settled).toBe(20);
  });

  it("reads out all three counts, never a bare percentage", () => {
    expect(
      progressBar({
        items_total: 160,
        items_completed: 37,
        items_failed: 123,
        items_unanswered: 0,
      }).reading,
    ).toBe("37 of 160 answered, 123 failed, 0 unanswered");
  });

  /**
   * PL-050. A halted run's items no source was asked about are neither answered nor absent, so
   * they are the empty part of the track and are named in the reading -- never drawn as
   * unanswered.
   */
  it("leaves what a halted run never reached undrawn, and names it", () => {
    const bar = progressBar({
      items_total: 100,
      items_completed: 30,
      items_failed: 5,
      items_unanswered: 5,
      items_not_reached: 60,
    });
    expect(bar.segments.map((segment) => segment.kind)).toEqual([
      "completed",
      "failed",
      "unanswered",
    ]);
    expect(bar.segments[2]).toMatchObject({ x: "35%", width: "5%" });
    expect(bar.settled).toBe(40);
    expect(bar.reading).toBe(
      "30 of 100 answered, 5 failed, 5 unanswered, 60 not reached",
    );
  });

  it("says nothing about not reached when everything was reached", () => {
    expect(
      progressBar({
        items_total: 2,
        items_completed: 2,
        items_not_reached: 0,
      }).reading,
    ).toBe("2 of 2 answered, 0 failed, 0 unanswered");
  });

  it("says there is nothing to do rather than dividing by zero", () => {
    expect(progressBar({ items_total: 0 })).toEqual({
      segments: [],
      reading: "Nothing to do",
      settled: 0,
    });
  });

  it("says the same for no progress at all", () => {
    expect(progressBar(null).reading).toBe("Nothing to do");
    expect(progressBar(undefined).segments).toEqual([]);
  });

  it("treats a missing or negative count as nothing", () => {
    const bar = progressBar({ items_total: 10, items_completed: -5 });
    expect(bar.segments).toEqual([]);
    expect(bar.reading).toBe("0 of 10 answered, 0 failed, 0 unanswered");
  });
});
