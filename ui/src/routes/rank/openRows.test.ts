import { describe, expect, it } from "vitest";
import {
  type OpenCandidate,
  type OpenRow,
  choosePillar,
  chosenPillarOf,
  isOpen,
  toggleRow,
} from "./openRows";

const PORTUGAL: OpenRow = { candidate: "country.portugal" };
const FINLAND: OpenRow = { candidate: "country.finland" };

/**
 * What a ranking row actually hands these functions: the identity, plus the name and the
 * rollup it is drawing itself from. Only the identity and the choice may survive the call.
 */
const PORTUGAL_AS_RENDERED: OpenCandidate = {
  candidate: "country.portugal",
  name: "Portugal",
  pillars: [{ pillar: "economics", score: 81, weight: 25, contribution: 20.25 }],
};

describe("the rows a reader has opened", () => {
  it("opens a row that was closed", () => {
    expect(toggleRow([], PORTUGAL)).toEqual([PORTUGAL]);
  });

  /**
   * The whole point of the change. Opening a second candidate used to close the first, so
   * comparing two countries' evidence meant remembering one of them.
   */
  it("keeps the rows already open when another is opened", () => {
    expect(toggleRow([PORTUGAL], FINLAND)).toEqual([PORTUGAL, FINLAND]);
  });

  it("closes a row that was open, leaving the others alone", () => {
    expect(toggleRow([PORTUGAL, FINLAND], PORTUGAL)).toEqual([FINLAND]);
  });

  it("opens a row at the end, so the order is the order they were opened in", () => {
    const opened = toggleRow(toggleRow([], FINLAND), PORTUGAL);
    expect(opened.map((row) => row.candidate)).toEqual([
      "country.finland",
      "country.portugal",
    ]);
  });

  /** A candidate appearing twice would render its detail panel twice. */
  it("never holds the same candidate twice", () => {
    const again = { ...PORTUGAL_AS_RENDERED, name: "Portugal (again)" };
    expect(toggleRow([PORTUGAL], again)).toEqual([]);
  });

  /**
   * **The state keeps no copy of what the row was showing.**
   *
   * It used to: `OpenRow` carried the candidate's name and its pillar rollup, and both
   * functions stored the whole object the row handed them. Nothing read either one back --
   * `CandidateRow` rebuilds that object from the live `CandidateResult` on every render, and
   * that is what reaches the panel -- so the copy was a snapshot of figures that the next
   * refetch would make stale while leaving it there to be picked up by mistake.
   *
   * **`toEqual` is the assertion that can say this**, because it fails on a property the
   * expectation does not name. Restoring the spread in either function makes this red, and
   * nothing else in the suite moves -- which is exactly why the field survived so long.
   */
  it("stores the identity and the choice, and no copy of the row's figures", () => {
    expect(toggleRow([], PORTUGAL_AS_RENDERED)).toEqual([
      { candidate: "country.portugal" },
    ]);
    expect(choosePillar([], PORTUGAL_AS_RENDERED, "safety")).toEqual([
      { candidate: "country.portugal", chosenPillar: "safety" },
    ]);
  });

  it("does not mutate the list it was given", () => {
    const before: OpenRow[] = [PORTUGAL];
    toggleRow(before, FINLAND);
    expect(before).toEqual([PORTUGAL]);
  });

  it("says which candidates are open, and which are not", () => {
    expect(isOpen([PORTUGAL], "country.portugal")).toBe(true);
    expect(isOpen([PORTUGAL], "country.finland")).toBe(false);
    expect(isOpen([], "country.portugal")).toBe(false);
  });
});

describe("the pillar a reader is reading, within an open row", () => {
  it("chooses a pillar on a row already open", () => {
    const open = choosePillar([PORTUGAL], PORTUGAL, "safety");

    expect(chosenPillarOf(open, "country.portugal")).toBe("safety");
  });

  /** The chart is in the row and the values it filters are in the panel, so filtering
      something the reader cannot see would look like nothing happening. */
  it("opens a closed row rather than filtering something unseen", () => {
    const open = choosePillar([], PORTUGAL, "safety");

    expect(isOpen(open, "country.portugal")).toBe(true);
    expect(chosenPillarOf(open, "country.portugal")).toBe("safety");
  });

  it("clears the choice when the same pillar is chosen again", () => {
    const chosen = choosePillar([PORTUGAL], PORTUGAL, "safety");

    expect(chosenPillarOf(choosePillar(chosen, PORTUGAL, "safety"), "country.portugal"))
      .toBeNull();
  });

  it("replaces the choice when a different pillar is chosen", () => {
    const chosen = choosePillar([PORTUGAL], PORTUGAL, "safety");

    expect(chosenPillarOf(choosePillar(chosen, PORTUGAL, "health"), "country.portugal"))
      .toBe("health");
  });

  /** Each open row is read on its own; choosing safety for one country says nothing about
      what the reader wants to see for another. */
  it("leaves every other open row's choice alone", () => {
    const both = choosePillar([PORTUGAL, FINLAND], FINLAND, "climate");
    const andPortugal = choosePillar(both, PORTUGAL, "safety");

    expect(chosenPillarOf(andPortugal, "country.finland")).toBe("climate");
    expect(chosenPillarOf(andPortugal, "country.portugal")).toBe("safety");
  });

  it("reads null for a candidate that is not open at all", () => {
    expect(chosenPillarOf([], "country.portugal")).toBeNull();
    expect(chosenPillarOf([PORTUGAL], "country.finland")).toBeNull();
  });

  it("reads null for an open row where nothing has been chosen", () => {
    expect(chosenPillarOf([PORTUGAL], "country.portugal")).toBeNull();
  });

  /** Closing a row drops what was chosen in it, so reopening starts unfiltered rather than
      restoring a filter the reader set a minute ago and has forgotten. */
  it("forgets the choice when the row is closed", () => {
    const chosen = choosePillar([PORTUGAL], PORTUGAL, "safety");
    const closed = toggleRow(chosen, PORTUGAL);

    expect(chosenPillarOf(toggleRow(closed, PORTUGAL), "country.portugal")).toBeNull();
  });

  it("does not mutate the rows it was given", () => {
    const before: OpenRow[] = [{ ...PORTUGAL }];

    choosePillar(before, PORTUGAL, "safety");

    expect(chosenPillarOf(before, "country.portugal")).toBeNull();
  });
});
