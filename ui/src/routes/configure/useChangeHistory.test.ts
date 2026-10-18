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
