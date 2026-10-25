import { describe, expect, it } from "vitest";
import {
  describeSaved,
  detailOf,
  newestFirst,
  requestedSavedRanking,
  summariseSaved,
  type SavedRankingLike,
} from "./savedRanking";

/**
 * A saved ranking as this module sees one: four fields and an id to assert order by.
 *
 * **Not `EvaluationSummary`.** `format/` may not import `api/` (the layering rule), and the
 * test lives beside what it tests, so it declares the same structural shape the module does.
 */
interface Entry extends SavedRankingLike {
  id: number;
}

/** The set list's names, as `useSelection().criteriaSets` carries them. */
const SETS = new Map([["local_employment", "Working locally"]]);

function saved(over: Partial<Entry> = {}): Entry {
  return {
    id: 1,
    criteria_set: "local_employment",
    level: "country",
    computed_at: "2026-09-21T09:00:00Z",
    ...over,
  };
}

describe("the saved rankings list", () => {
  it("puts the newest first", () => {
    const order = newestFirst([
      saved({ id: 1, computed_at: "2026-09-01T09:00:00Z" }),
      saved({ id: 2, computed_at: "2026-09-21T09:00:00Z" }),
      saved({ id: 3, computed_at: "2026-09-10T09:00:00Z" }),
    ]);
    expect(order.map((entry) => entry.id)).toEqual([2, 3, 1]);
  });

  it("does not mutate the list it was given", () => {
    const items = [
      saved({ id: 1, computed_at: "2026-09-01T09:00:00Z" }),
      saved({ id: 2, computed_at: "2026-09-21T09:00:00Z" }),
    ];
    newestFirst(items);
    expect(items.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("sorts an empty list into an empty list", () => {
    expect(newestFirst([])).toEqual([]);
  });

  /** The note is the reason it was kept, so it leads. */
  it("calls a saved ranking by its note", () => {
    expect(describeSaved(saved({ note: "before I raised housing" }), SETS)).toBe(
      "before I raised housing",
    );
  });

  /** PL-070. The set by its name from the list, the level in words: never either id. */
  it("falls back to the criteria set and level, named in words, when there is no note", () => {
    expect(describeSaved(saved(), SETS)).toBe("Working locally, Country");
    expect(describeSaved(saved({ note: null }), SETS)).toBe(
      "Working locally, Country",
    );
  });

  /** A set no longer listed -- deleted, or the list still loading -- reads as its id in words. */
  it("names a set the list does not hold by its id made readable", () => {
    expect(describeSaved(saved({ criteria_set: "remote-only" }), SETS)).toBe(
      "Remote only, Country",
    );
  });

  /** A note of spaces is a note that says nothing while looking like one that does. */
  it("treats a blank note as no note", () => {
    expect(describeSaved(saved({ note: "   " }), SETS)).toBe(
      "Working locally, Country",
    );
  });

  it("states the provenance in words, with no separator character", () => {
    const detail = detailOf(saved(), SETS);
    expect(detail).toContain("Working locally at country level");
    expect(detail).not.toContain("local_employment");
    expect(detail).toMatch(/saved /);
    expect(detail).not.toContain("·");
  });

  /** The sidebar is 262px wide, so the summary drops the time and keeps the day. */
  it("summarises a saved ranking short enough for the sidebar", () => {
    const summary = summariseSaved(saved(), SETS);
    expect(summary).toContain("Working locally");
    expect(summary).not.toContain("local_employment");
    expect(summary).not.toMatch(/\d\d:\d\d/);
  });
});

describe("which saved ranking the address bar is asking for", () => {
  /**
   * **The one function here that parses input a person can type.** Everything else formats
   * what the server sent; this reads a query parameter, and a query parameter is whatever
   * somebody put in the URL -- or whatever an old bookmark still holds.
   */
  it("reads a positive whole number", () => {
    expect(requestedSavedRanking("42")).toBe(42);
  });

  it("asks for nothing when the parameter is absent", () => {
    expect(requestedSavedRanking(null)).toBeNull();
  });

  it("refuses anything that is not a plain number", () => {
    // `Number("")` is 0 and `Number(" 7 ")` is 7, so a bare cast would turn an empty or padded
    // parameter into a request for a ranking -- id 0 does not exist and the screen would show
    // a "not found" for something nobody asked for.
    expect(requestedSavedRanking("")).toBeNull();
    expect(requestedSavedRanking(" 7 ")).toBeNull();
    expect(requestedSavedRanking("7.5")).toBeNull();
    expect(requestedSavedRanking("7e2")).toBeNull();
    expect(requestedSavedRanking("abc")).toBeNull();
  });

  it("refuses zero and negatives, because no evaluation has those ids", () => {
    expect(requestedSavedRanking("0")).toBeNull();
    expect(requestedSavedRanking("-3")).toBeNull();
  });

  it("refuses a leading zero rather than silently reinterpreting it", () => {
    expect(requestedSavedRanking("007")).toBeNull();
  });
});
