import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
