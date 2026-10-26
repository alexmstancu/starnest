/**
 * The way back, apart from the rail that offers it.
 *
 * `ConfigureScreen.test.tsx` drives undo through the buttons. What is here is the one case a
 * rendered button cannot be made to show: **two undos asked for before the first has
 * re-rendered** -- the buttons are held rather than disabled while one runs (NEW-34), so they
 * still take a press, and only the history itself can refuse the second.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnconfirmedUndo } from "./unknownOutcome";
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
        describe: () => "Weight for A: 50 to 40, in Default",
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
    describe: () => "Weight for A: 50 to 40, in Default",
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
        describe: () => "Renamed Default to Two",
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

/** PL-033 round 10. A request may settle before its entry is rendered; it is resolved all the same. */
describe("a change whose request settles before it is rendered", () => {
  it("is checked once it is, rather than left unconfirmed", async () => {
    const readBack = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useChangeHistory());

    await act(async () => {
      result.current.note({
        target: "lock:default:economics",
        stage: "Pillar weights",
        describe: () => "Locked the Economy pillar, in Default",
        before: false,
        after: true,
        reverse: () => undefined,
        undoes: { criteriaSetId: "default", by: "write" },
        unconfirmed: readBack,
        settles: Promise.resolve(),
      });
      // The settlement is heard before React renders the note.
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(readBack).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(result.current.changes[0]?.unconfirmed).toBeUndefined());
    expect(result.current.waitsFor("default")).toBe(false);
  });
});

/**
 * P105. **An undo whose answer never came is not a failure**: it may land yet, so the change stays
 * listed, unconfirmed, holding its set -- and leaves the list only once its undo is known to have
 * landed.
 */
describe("an undo whose answer never came", () => {
  const entry = (id: string, reverse: () => Promise<void> | void) => ({
    target: `criterion:default:${id}`,
    stage: "Pillar weights",
    describe: () => `Weight for ${id}`,
    before: 50,
    after: 40,
    reverse,
    undoes: { criteriaSetId: "default", by: "write" as const },
  });
  const unknown = (stillInForce: () => Promise<boolean>, settles?: Promise<unknown>) => () =>
    Promise.reject(
      new UnconfirmedUndo(
        settles === undefined ? { unconfirmed: stillInForce } : { unconfirmed: stillInForce, settles },
      ),
    );

  it("keeps the change listed, unconfirmed and holding its set, and reports no failure", async () => {
    const { result } = renderHook(() => useChangeHistory());
    act(() => result.current.note(entry("a", unknown(() => Promise.resolve(false)))));

    await act(async () => result.current.undoOnly(result.current.changes[0]!.id));

    const [kept] = result.current.changes;
    expect(kept?.unconfirmed).toBeDefined();
    expect(kept?.undoUnconfirmed).toBe(true);
    expect(result.current.failure).toBeNull();
    expect(result.current.waitsFor("default")).toBe(true);
  });

  it("lets the change go once a check finds the undo landed", async () => {
    const { result } = renderHook(() => useChangeHistory());
    act(() => result.current.note(entry("a", unknown(() => Promise.resolve(false)))));
    await act(async () => result.current.undoOnly(result.current.changes[0]!.id));

    await act(async () => result.current.confirm(result.current.changes[0]!.id));

    await vi.waitFor(() => expect(result.current.changes).toEqual([]));
  });

  it("keeps the change, confirmed, once a check finds the undo did not land", async () => {
    const { result } = renderHook(() => useChangeHistory());
    act(() => result.current.note(entry("a", unknown(() => Promise.resolve(true)))));
    await act(async () => result.current.undoOnly(result.current.changes[0]!.id));

    await act(async () => result.current.confirm(result.current.changes[0]!.id));

    await vi.waitFor(() => expect(result.current.changes[0]?.unconfirmed).toBeUndefined());
    expect(result.current.changes[0]?.undoUnconfirmed).toBeUndefined();
    expect(result.current.waitsFor("default")).toBe(false);
  });

  it("is resolved by itself once its request settles", async () => {
    let settle = (): void => undefined;
    const settles = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const stillInForce = vi.fn(() => Promise.resolve(false));
    const { result } = renderHook(() => useChangeHistory());
    act(() => result.current.note(entry("a", unknown(stillInForce, settles))));
    await act(async () => result.current.undoOnly(result.current.changes[0]!.id));
    expect(stillInForce).not.toHaveBeenCalled();

    await act(async () => settle());

    await vi.waitFor(() => expect(result.current.changes).toEqual([]));
    expect(stillInForce).toHaveBeenCalledTimes(1);
  });

  /** Settled before the change renders as unconfirmed, it is resolved once it does (P105). */
  it("is resolved when its request settled before the change rendered unconfirmed", async () => {
    const stillInForce = vi.fn(() => Promise.resolve(false));
    const { result } = renderHook(() => useChangeHistory());
    act(() => result.current.note(entry("a", unknown(stillInForce, Promise.resolve()))));

    await act(async () => result.current.undoOnly(result.current.changes[0]!.id));

    await vi.waitFor(() => expect(result.current.changes).toEqual([]));
    expect(stillInForce).toHaveBeenCalledTimes(1);
  });

  it("stops a run of undos there, the newer ones undone and the older ones kept", async () => {
    const { result } = renderHook(() => useChangeHistory());
    act(() => result.current.note(entry("older", () => undefined)));
    act(() => result.current.note(entry("middle", unknown(() => Promise.resolve(false)))));
    act(() => result.current.note(entry("newer", () => undefined)));
    const older = result.current.changes[2]!.id;

    await act(async () => result.current.undoThrough(older));

    expect(result.current.changes.map((each) => each.describe({ before: 50, after: 40, inSet: undefined }))).toEqual([
      "Weight for middle",
      "Weight for older",
    ]);
    expect(result.current.changes[0]?.undoUnconfirmed).toBe(true);
    expect(result.current.changes[1]?.unconfirmed).toBeUndefined();
  });
});
