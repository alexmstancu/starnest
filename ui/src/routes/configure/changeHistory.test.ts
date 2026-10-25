import { describe, expect, it } from "vitest";
import { formatDateTime } from "../../format/display";
import {
  type Change,
  describeReach,
  describeWhen,
  reachOf,
  record,
  undoCanRestore,
  without,
} from "./changeHistory";

const AT = new Date("2026-09-23T14:32:00Z");

const change = (
  id: number,
  target: string,
  before: number,
  after: number,
  at: Date = AT,
): Change<number> => ({
  id,
  target,
  label: target,
  stage: "Pillar weights",
  at,
  before,
  after,
});

describe("recording a change", () => {
  it("puts the newest first", () => {
    const history = record(record([], change(1, "housing", 10, 20)), change(2, "career", 5, 8));
    expect(history.map((each) => each.id)).toEqual([2, 1]);
  });

  /** A slider fires on every movement; a history recording each would bury everything else. */
  it("collapses a repeat of the same target into one step", () => {
    const history = record(
      record([], change(1, "housing", 10, 20)),
      change(2, "housing", 20, 28),
    );
    expect(history).toHaveLength(1);
    // The original `before`, because that is what undoing the whole gesture must put back.
    expect(history[0]).toMatchObject({ id: 2, before: 10, after: 28 });
  });

  /**
   * The collapsed entry is the gesture as it now stands, so it carries the newest time: what
   * a reader checks a line against is when they last touched that weight, not when the drag
   * they have since forgotten began.
   */
  it("keeps the latest time when a repeat collapses", () => {
    const later = new Date("2026-09-23T14:41:00Z");
    const history = record(
      record([], change(1, "housing", 10, 20)),
      change(2, "housing", 20, 28, later),
    );

    expect(history[0]?.at).toBe(later);
  });

  /**
   * Only a repeat of the *most recent* change collapses. Housing, career, housing is three
   * decisions, and folding the two housing edits together would undo a career change nobody
   * asked to undo.
   */
  it("does not collapse across another target", () => {
    let history = record([], change(1, "housing", 10, 20));
    history = record(history, change(2, "career", 5, 8));
    history = record(history, change(3, "housing", 20, 30));

    expect(history.map((each) => each.target)).toEqual([
      "housing",
      "career",
      "housing",
    ]);
    expect(history[0]?.before).toBe(20);
  });

  it("does not mutate the history it was given", () => {
    const before = [change(1, "housing", 10, 20)];
    record(before, change(2, "career", 5, 8));
    expect(before).toHaveLength(1);
  });

  /**
   * A gesture that once emptied the rest of its pillar cannot be undone exactly however it
   * ends, because the proportions it destroyed are not in any later state either.
   */
  it("keeps a step's caveat when a later step of the same gesture collapses into it", () => {
    const history = record(
      record([], { ...change(1, "housing", 10, 100), caveat: "inexact" }),
      change(2, "housing", 100, 60),
    );

    expect(history[0]?.caveat).toBe("inexact");
  });

  /** PL-033. Folded together, resolving the unconfirmed step would take the confirmed one too. */
  it.each([
    ["onto an unconfirmed one", { latest: true, next: false }],
    ["an unconfirmed one onto a confirmed one", { latest: false, next: true }],
  ])("never collapses a repeat %s", (_, { latest, next }) => {
    const unconfirmed = () => Promise.resolve(false);
    const history = record(
      record([], { ...change(1, "housing", 10, 20), ...(latest ? { unconfirmed } : {}) }),
      { ...change(2, "housing", 20, 30), ...(next ? { unconfirmed } : {}) },
    );

    expect(history.map((each) => each.id)).toEqual([2, 1]);
  });

  it("does not carry a caveat across to another target", () => {
    const history = record(
      record([], { ...change(1, "housing", 10, 100), caveat: "inexact" }),
      change(2, "career", 5, 8),
    );

    expect(history[0]?.caveat).toBeUndefined();
  });
});

/**
 * Whether re-sending a weight's old value puts the rest of its pillar back as well.
 *
 * **The server shares a change among the unlocked siblings in proportion to their weights**,
 * so moving a weight back reverses any move that left them something to be in proportion to.
 * The exception is a move that emptied them all: proportions of nothing are undefined, the
 * server shares the way back evenly, and an undo of [50, 20, 30] -> [100, 0, 0] lands on
 * [50, 25, 25].
 */
describe("whether an undo can put the whole pillar back", () => {
  const share = (attribute: string, weight: number, weight_locked = false) => ({
    attribute,
    weight,
    weight_locked,
  });

  it("says when an undo cannot put the others back", () => {
    expect(
      undoCanRestore(
        [share("a", 50), share("b", 20), share("c", 30)],
        [share("a", 100), share("b", 0), share("c", 0)],
        "a",
      ),
    ).toBe(false);
  });

  it("can put the others back after an ordinary move, which kept their proportions", () => {
    expect(
      undoCanRestore(
        [share("a", 50), share("b", 20), share("c", 30)],
        [share("a", 70), share("b", 12), share("c", 18)],
        "a",
      ),
    ).toBe(true);
  });

  it("leaves a locked sibling out, because a rebalance never moves it", () => {
    expect(
      undoCanRestore(
        [share("a", 40), share("b", 30), share("c", 20, true), share("d", 10)],
        [share("a", 80), share("b", 0), share("c", 20, true), share("d", 0)],
        "a",
      ),
    ).toBe(false);
  });

  /** One sibling takes whatever is left, so the way back gives it exactly what it had. */
  it("can put a single absorbing sibling back, however empty it was left", () => {
    expect(
      undoCanRestore(
        [share("a", 50), share("b", 30), share("c", 20, true)],
        [share("a", 80), share("b", 0), share("c", 20, true)],
        "a",
      ),
    ).toBe(true);
  });

  /** An even share is exactly right when the siblings were even to begin with. */
  it("can put siblings back that held equal weights before they were emptied", () => {
    expect(
      undoCanRestore(
        [share("a", 40), share("b", 30), share("c", 30)],
        [share("a", 100), share("b", 0), share("c", 0)],
        "a",
      ),
    ).toBe(true);
  });

  it("can put siblings back that were already at zero", () => {
    expect(
      undoCanRestore(
        [share("a", 100), share("b", 0), share("c", 0)],
        [share("a", 60), share("b", 20), share("c", 20)],
        "a",
      ),
    ).toBe(true);
  });

  it("finds nothing it cannot restore in an answer that names no criteria", () => {
    expect(undoCanRestore([share("a", 50), share("b", 50)], [], "a")).toBe(true);
  });
});

describe("what undoing a change would take with it", () => {
  /** A configuration is a state: putting one weight back alone yields a set that never was. */
  it("takes everything made after it", () => {
    let history = record([], change(1, "a", 1, 2));
    history = record(history, change(2, "b", 1, 2));
    history = record(history, change(3, "c", 1, 2));

    expect(reachOf(history, 1).map((each) => each.id)).toEqual([3, 2, 1]);
    expect(reachOf(history, 3).map((each) => each.id)).toEqual([3]);
  });

  it("reaches nothing for a change that is not there", () => {
    expect(reachOf([change(1, "a", 1, 2)], 99)).toEqual([]);
  });

  it("states the reach before it is taken", () => {
    expect(describeReach(0)).toBe("Nothing to undo");
    expect(describeReach(1)).toBe("Undo this");
    expect(describeReach(4)).toBe("Undo this and the 3 after it");
  });

  it("leaves the rest of the history behind", () => {
    let history = record([], change(1, "a", 1, 2));
    history = record(history, change(2, "b", 1, 2));
    history = record(history, change(3, "c", 1, 2));

    expect(without(history, reachOf(history, 2)).map((each) => each.id)).toEqual([1]);
  });

  it("removes everything when the oldest is undone", () => {
    let history = record([], change(1, "a", 1, 2));
    history = record(history, change(2, "b", 1, 2));

    expect(without(history, reachOf(history, 1))).toEqual([]);
  });
});

/**
 * **The clock, not the date.** Every entry was made in this session, so a date would read the
 * same on all of them; the minute is what separates two edits to the same weight.
 */
describe("when a change was made", () => {
  it("reads as a time of day, to the minute", () => {
    expect(describeWhen(AT)).toMatch(/^\d{2}:\d{2}$/);
  });

  /**
   * Asserted as a difference rather than as a literal: the string depends on the machine's
   * timezone, and a test that pinned one would fail everywhere but here without saying
   * anything true about the formatting.
   */
  it("separates two changes made minutes apart", () => {
    expect(describeWhen(new Date("2026-09-23T14:32:00Z"))).not.toBe(
      describeWhen(new Date("2026-09-23T14:41:00Z")),
    );
  });
});

/**
 * PL-020: one screen never shows two clocks. Rank's "Computed" and a Recent changes entry made
 * at the same instant name the same minute, in a zone that is not UTC (`vite.config.ts`).
 */
describe("the clock Recent changes reads", () => {
  it("is the one every other time on screen is shown in", () => {
    const instant = "2026-08-29T18:02:00Z";
    expect(formatDateTime(instant)).toContain(describeWhen(new Date(instant)));
  });
});
