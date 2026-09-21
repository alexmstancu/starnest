import { describe, expect, it } from "vitest";
import {
  type Change,
  describeReach,
  reachOf,
  record,
  without,
} from "./changeHistory";

const change = (
  id: number,
  target: string,
  before: number,
  after: number,
): Change<number> => ({ id, target, label: target, before, after });

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
