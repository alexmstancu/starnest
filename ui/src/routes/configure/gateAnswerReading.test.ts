import { describe, expect, it } from "vitest";
import {
  dayOf,
  describeAge,
  describePeriod,
  inReadingOrder,
  periodHasEnded,
} from "./gateAnswerReading";

/**
 * UI-13. **An answer can hold for a period**, and confirming a proposal used to drop it: the row
 * never showed it, so nobody could see what was lost.
 */
describe("the period a gate answer holds for", () => {
  it("reads as the two dates it runs between", () => {
    expect(describePeriod({ start: "2026-01-01", end: "2026-12-31" })).toBe(
      "1 Jan 2026 to 31 Dec 2026",
    );
  });

  it("says nobody recorded one, rather than leaving a blank", () => {
    expect(describePeriod(null)).toBe("No period recorded");
    expect(describePeriod(undefined)).toBe("No period recorded");
  });
});

describe("whether an answer's period has ended", () => {
  it("has not when it ends today: a period holds through its last day", () => {
    expect(periodHasEnded({ start: "2026-01-01", end: "2026-10-25" }, "2026-10-25")).toBe(false);
  });

  it("has when it ended yesterday", () => {
    expect(periodHasEnded({ start: "2026-01-01", end: "2026-10-24" }, "2026-10-25")).toBe(true);
  });

  it("never has for an answer with no period", () => {
    expect(periodHasEnded(null, "2026-10-25")).toBe(false);
    expect(periodHasEnded(undefined, "2026-10-25")).toBe(false);
  });
});

describe("the reader's day", () => {
  it("is the calendar day on the reader's clock, written as the contract writes a date", () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("how old an answer is", () => {
  const now = new Date("2026-10-25T12:00:00Z");

  it.each([
    ["2026-10-25T08:00:00Z", "today"],
    ["2026-10-24T08:00:00Z", "yesterday"],
    ["2026-10-20T12:00:00Z", "5 days ago"],
    ["2026-10-04T12:00:00Z", "3 weeks ago"],
    ["2026-07-20T12:00:00Z", "3 months ago"],
    ["2024-09-01T12:00:00Z", "2 years ago"],
  ])("reads %s as %s", (instant, words) => {
    expect(describeAge(instant, now)).toBe(words);
  });

  it("reads a moment ahead of the reader's clock as today, never as the future", () => {
    expect(describeAge("2026-10-26T12:00:00Z", now)).toBe("today");
  });
});

describe("the order answers are reviewed in", () => {
  const ended = { reference_period: { start: "2020-01-01", end: "2020-12-31" }, gate: "B", candidate: "Spain" };
  const open = { reference_period: null, gate: "A", candidate: "Spain" };
  const alsoOpen = { reference_period: null, gate: "A", candidate: "Greece" };

  it("puts an ended period first, then orders by gate and candidate", () => {
    const ordered = inReadingOrder([open, ended, alsoOpen], "2026-10-25", (answer) => [
      answer.gate,
      answer.candidate,
    ]);

    expect(ordered).toEqual([ended, alsoOpen, open]);
  });
});
