import { describe, expect, it } from "vitest";
import { combine, map, type Read, type Refresh } from "./read";

/**
 * Two reads drawn as one, and a read seen through a function.
 *
 * **A combined read is only as settled, and only as fresh, as its worst part.** A screen that
 * draws a ranking beside the roster it ranks must not call the pair ready while one of them is
 * still on its way, or call it read at the time of the newer half.
 */

const EARLIER = new Date("2026-10-24T09:00:00Z");
const LATER = new Date("2026-10-24T10:00:00Z");
const BOOM = new Error("the server is down");

const pending: Read<never> = { state: "pending" };
const waitingForAWrite: Read<never> = { state: "pending", waitingFor: "a-write" };
const failed: Read<never> = { state: "failed", error: BOOM };

function ready<T>(data: T, readAt = LATER, refresh: Refresh = "idle"): Read<T> {
  return { state: "ready", data, readAt, refresh };
}

describe("combining two reads", () => {
  it.each([
    ["the first", failed, ready(2)],
    ["the second", ready(1), failed],
    ["either, over a pending one", pending, failed],
  ])("fails when %s failed", (_case, a, b) => {
    expect(combine<number, number>(a, b)).toEqual(failed);
  });

  it.each([
    ["the first", pending, ready(2)],
    ["the second", ready(1), pending],
  ])("is pending while %s is", (_case, a, b) => {
    expect(combine<number, number>(a, b).state).toBe("pending");
  });

  it("is waiting for a write when either part is", () => {
    expect(combine(pending, waitingForAWrite)).toEqual(waitingForAWrite);
    expect(combine(waitingForAWrite, pending)).toEqual(waitingForAWrite);
  });

  it("pairs the data when both are ready, read at the older of the two times", () => {
    expect(combine(ready("ranking", LATER), ready("roster", EARLIER))).toEqual(
      ready(["ranking", "roster"], EARLIER),
    );
    expect(combine(ready("ranking", EARLIER), ready("roster", LATER))).toEqual(
      ready(["ranking", "roster"], EARLIER),
    );
  });

  it("is refreshing while either part is", () => {
    expect(combine(ready(1, LATER, "running"), ready(2))).toMatchObject({ refresh: "running" });
    expect(combine(ready(1), ready(2, LATER, "running"))).toMatchObject({ refresh: "running" });
  });

  it("says a refresh failed when either part's did, over one still running", () => {
    const refusal = { failed: BOOM };

    expect(combine(ready(1, LATER, refusal), ready(2, LATER, "running"))).toMatchObject({
      refresh: refusal,
    });
    expect(combine(ready(1, LATER, "running"), ready(2, LATER, refusal))).toMatchObject({
      refresh: refusal,
    });
  });
});

describe("mapping a read", () => {
  it("applies the function to ready data and keeps when and how it was read", () => {
    const refusal = { failed: BOOM };

    expect(map(ready(21, EARLIER, refusal), (value) => value * 2)).toEqual(
      ready(42, EARLIER, refusal),
    );
  });

  it.each([
    ["pending", waitingForAWrite],
    ["failed", failed],
  ])("passes a %s read through untouched, calling nothing", (_case, read) => {
    let called = false;

    expect(
      map(read, () => {
        called = true;
      }),
    ).toBe(read);
    expect(called).toBe(false);
  });
});
