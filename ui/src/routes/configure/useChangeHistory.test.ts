/**
 * The way back, apart from the rail that offers it.
 *
 * `ConfigureScreen.test.tsx` drives undo through the buttons. What is here is the one case a
 * rendered button cannot be made to show: **two undos asked for before the first has
 * re-rendered** -- the buttons are held rather than disabled while one runs (NEW-34), so they
 * still take a press, and only the history itself can refuse the second.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChangeHistory } from "./useChangeHistory";

describe("an undo while another is on its way", () => {
  it("is refused, so nothing is reversed twice", async () => {
    let answer = (): void => undefined;
    const reversed: unknown[] = [];
    const { result } = renderHook(() => useChangeHistory());
    act(() =>
      result.current.note({
        target: "criterion:default:a",
        stage: "Pillar weights",
        label: "Weight for A: 50 to 40, in Default",
        before: 50,
        after: 40,
        reverse: (before) => {
          reversed.push(before);
          return new Promise<void>((resolve) => {
            answer = resolve;
          });
        },
      }),
    );
    const id = result.current.changes[0]!.id;

    act(() => {
      result.current.undoThrough(id);
      result.current.reset();
    });
    await act(async () => answer());

    expect(reversed).toEqual([50]);
    expect(result.current.changes).toEqual([]);
    expect(result.current.undoing).toBe(false);
  });
});

/** PL-033. **One write in flight at a time across Configure**, an undo included. */
describe("a write and an undo", () => {
  const entry = (reversed: unknown[]) => ({
    target: "criterion:default:a",
    stage: "Pillar weights",
    label: "Weight for A: 50 to 40, in Default",
    before: 50,
    after: 40,
    reverse: (before: unknown) => {
      reversed.push(before);
    },
  });

  it("refuses a second write and any undo while one write is in flight, until it is given back", async () => {
    const reversed: unknown[] = [];
    const { result } = renderHook(() => useChangeHistory());
    act(() => result.current.note(entry(reversed)));
    let done: (() => void) | null = null;
    act(() => {
      done = result.current.begin();
    });

    expect(result.current.begin()).toBeNull();
    await act(async () => result.current.undoThrough(result.current.changes[0]!.id));
    expect(reversed).toEqual([]);
    expect(result.current.busy).toBe(true);

    act(() => done!());
    await act(async () => result.current.undoThrough(result.current.changes[0]!.id));
    expect(reversed).toEqual([50]);
    expect(result.current.busy).toBe(false);
  });
});

/** PL-033 round 9. A set with an unconfirmed change takes no other write until it is checked. */
describe("a set with an unconfirmed change", () => {
  it("refuses a write to that set, and only that set", () => {
    const { result } = renderHook(() => useChangeHistory());
    act(() =>
      result.current.note({
        target: "criteria-set:default:renamed",
        stage: "Criteria set",
        label: "Renamed Default to Two",
        before: { name: "Default" },
        after: { name: "Two" },
        reverse: () => undefined,
        undoes: { criteriaSetId: "default", by: "write" },
        unconfirmed: () => Promise.resolve(true),
      }),
    );

    expect(result.current.begin("default")).toBeNull();
    let other: (() => void) | null = null;
    act(() => {
      other = result.current.begin("remote_only");
    });
    expect(other).not.toBeNull();
  });
});
