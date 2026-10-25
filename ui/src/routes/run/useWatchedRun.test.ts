import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STARTED_RUN_DETAIL } from "../../mocks/fixtures";
import { UNCLAIMED, useWatchedRun } from "./useWatchedRun";

/**
 * UI-04. **Whether the reader is still waiting on an act** -- whether its ticket is the newest.
 * A read whose ticket is not reports nothing, neither its answer nor its failure: the reader
 * has moved on to something else.
 */
describe("whether the reader is still waiting on an act", () => {
  it("waits on the opening view until the reader acts", () => {
    const { result } = renderHook(() => useWatchedRun());

    expect(result.current.isCurrent(UNCLAIMED)).toBe(true);
    const ticket = result.current.claim();

    expect(result.current.isCurrent(UNCLAIMED)).toBe(false);
    expect(result.current.isCurrent(ticket)).toBe(true);
  });

  it("waits on the newest act alone", () => {
    const { result } = renderHook(() => useWatchedRun());

    const first = result.current.claim();
    const second = result.current.claim();

    expect(result.current.isCurrent(first)).toBe(false);
    expect(result.current.isCurrent(second)).toBe(true);
  });

  it("waits on nothing once the card is put away", () => {
    const { result } = renderHook(() => useWatchedRun());
    const ticket = result.current.claim();

    act(() => result.current.clear());

    expect(result.current.isCurrent(ticket)).toBe(false);
    expect(result.current.isCurrent(UNCLAIMED)).toBe(false);
  });
});

/**
 * NEW-49. **Claiming again once an act's own request has been answered.** A read of a run sent
 * while a stop was on its way may predate the stop, so the stop's read -- sent after it was
 * written -- outranks it while the reader is still on that run, and only then: anything about
 * another run, a start or a card put away still outranks the stop (UI-04).
 */
describe("claiming again once an act's request has been answered", () => {
  it("outranks a read of the same run claimed meanwhile", () => {
    const { result } = renderHook(() => useWatchedRun());
    const stop = result.current.claim(7);
    const refresh = result.current.claim(7);

    const again = result.current.reclaim(stop, 7);

    expect(result.current.isCurrent(again)).toBe(true);
    expect(result.current.isCurrent(refresh)).toBe(false);
  });

  it("stays current when nothing was claimed meanwhile", () => {
    const { result } = renderHook(() => useWatchedRun());
    const stop = result.current.claim(7);

    expect(result.current.isCurrent(result.current.reclaim(stop, 7))).toBe(true);
  });

  it("gives way to another run claimed meanwhile", () => {
    const { result } = renderHook(() => useWatchedRun());
    const stop = result.current.claim(7);
    const open = result.current.claim(6);

    const again = result.current.reclaim(stop, 7);

    expect(again).toBe(stop);
    expect(result.current.isCurrent(again)).toBe(false);
    expect(result.current.isCurrent(open)).toBe(true);
  });

  it("gives way to a start, whose run has no number yet", () => {
    const { result } = renderHook(() => useWatchedRun());
    const stop = result.current.claim(7);
    const start = result.current.claim();

    const again = result.current.reclaim(stop, 7);

    expect(result.current.isCurrent(again)).toBe(false);
    expect(result.current.isCurrent(start)).toBe(true);
  });

  it("gives way to a card put away, though it showed the same run", () => {
    const { result } = renderHook(() => useWatchedRun());
    const stop = result.current.claim(7);

    act(() => result.current.clear());
    const again = result.current.reclaim(stop, 7);

    expect(result.current.isCurrent(again)).toBe(false);
  });
});

/** PL-117: what a look the card took on its own may change, which is far less than an act may. */
describe("a look's answer", () => {
  const running = { ...STARTED_RUN_DETAIL, id: 7, run_status: "running" as const, finished_at: null };
  const ended = { ...running, run_status: "completed" as const };

  it("takes no ticket, so the reader's act still outranks it", () => {
    const { result } = renderHook(() => useWatchedRun());
    const before = result.current.ticketNow();

    expect(result.current.ticketNow()).toBe(before);
    expect(result.current.isCurrent(before)).toBe(true);
  });

  it("is shown only while the card still shows that run", () => {
    const { result } = renderHook(() => useWatchedRun());
    act(() => result.current.show(result.current.claim(7), running));

    let shown = false;
    act(() => {
      shown = result.current.showIfStillShown(result.current.ticketNow(), { ...running, id: 6 });
    });

    expect(shown).toBe(false);
    expect(result.current.current?.id).toBe(7);
  });

  it("never takes a run that has ended back to running", () => {
    const { result } = renderHook(() => useWatchedRun());
    act(() => result.current.show(result.current.claim(7), ended));

    act(() => void result.current.showIfStillShown(result.current.ticketNow(), running));

    expect(result.current.current?.run_status).toBe("completed");
  });

  it("is not shown once the reader has acted since it was sent", () => {
    const { result } = renderHook(() => useWatchedRun());
    act(() => result.current.show(result.current.claim(7), running));
    const sentWith = result.current.ticketNow();
    result.current.claim(7);

    let shown = true;
    act(() => {
      shown = result.current.showIfStillShown(sentWith, ended);
    });

    expect(shown).toBe(false);
    expect(result.current.current?.run_status).toBe("running");
  });
});
