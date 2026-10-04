/**
 * The drag itself, apart from any markup.
 *
 * The two panels prove this through gestures (`PillarWeightsPanel.test.tsx`,
 * `CriteriaPanel.test.tsx`); what is here is the pair of decisions a rendered row cannot be
 * made to express. **Which weights a frame is computed from** -- the snapshot, which only
 * differs from the alternative when the caller hands over two different lists -- and **that the
 * weight under the pointer is given no preview**, which a panel cannot distinguish because the
 * two answers are the same number.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWeightDrag } from "./useWeightDrag";
import type { WeightedItem } from "./weights";

const weighted = (
  identifier: string,
  weight: number,
  locked = false,
): WeightedItem => ({ identifier, weight, locked });

const STORED = [weighted("a", 40), weighted("b", 35), weighted("c", 25)];

describe("a weight drag", () => {
  it("previews nothing before anything has moved", () => {
    const { result } = renderHook(() => useWeightDrag());

    expect([...result.current.preview]).toEqual([]);
    expect(result.current.previewFor("a")).toBeUndefined();
  });

  it("previews the rebalance once the pointer has moved a weight", () => {
    const { result } = renderHook(() => useWeightDrag());

    act(() => result.current.moveTo(STORED, "a", "50"));

    // 50 left to share in the ratio 35:25, which is the same arithmetic the server does.
    expect(result.current.previewFor("b")).toBeCloseTo(50 * (35 / 60), 10);
    expect(result.current.previewFor("c")).toBeCloseTo(50 * (25 / 60), 10);
  });

  it("gives the weight under the pointer no preview, although it knows what it would be", () => {
    /**
     * That row renders the pointer's own position: a slider re-rendered from a value worked out
     * elsewhere has its thumb fighting the cursor. The total still counts the moved weight,
     * which is why `preview` holds it and `previewFor` does not hand it over.
     */
    const { result } = renderHook(() => useWeightDrag());

    act(() => result.current.moveTo(STORED, "a", "50"));

    expect(result.current.previewFor("a")).toBeUndefined();
    expect(result.current.preview.get("a")).toBe(50);
  });

  it("rebalances a later frame from the snapshot, not from the list it was handed", () => {
    /**
     * **What this holds**: the second `moveTo` of one gesture shares out the list the gesture
     * began with, and ignores the already-absorbed list handed over with it.
     *
     * **It does not catch a hook that compounds**, although the snapshot is what prevents one,
     * and the title used to claim otherwise. Proportional sharing preserves the absorbers'
     * ratios -- 29.17:20.83 *is* 35:25 -- so both share 76 to the same two numbers and one
     * compounding step through ordinary values is arithmetically invisible. The sequence that
     * sees it runs to the top of the track, where every absorber reaches zero and the way back
     * down is an even split: "keeps the shape of the set when the drag goes up to 100 and back"
     * in `pillars/PillarWeightsPanel.test.tsx`, and its twin in `criteria/CriteriaPanel.test.tsx`.
     * Mutation-proved 2026-10-04: a hook feeding each frame into the next fails exactly those
     * two, and all eight tests in this file pass.
     */
    const { result } = renderHook(() => useWeightDrag());

    act(() => result.current.moveTo(STORED, "a", "50"));
    act(() =>
      result.current.moveTo(
        [weighted("a", 50), weighted("b", 29.17), weighted("c", 20.83)],
        "a",
        "24",
      ),
    );

    // 76 shared in the stored 35:25, not in the 29:21 the first frame produced.
    expect(result.current.previewFor("b")).toBeCloseTo(76 * (35 / 60), 10);
  });

  it("takes a new snapshot when a different weight is taken hold of", () => {
    const { result } = renderHook(() => useWeightDrag());

    act(() => result.current.moveTo(STORED, "a", "50"));
    act(() => result.current.moveTo(STORED, "b", "50"));

    expect(result.current.previewFor("b")).toBeUndefined();
    expect(result.current.preview.get("b")).toBe(50);
    expect(result.current.previewFor("a")).toBeCloseTo(50 * (40 / 65), 10);
  });

  it("previews only the weight under the pointer when nothing can absorb the move", () => {
    /**
     * The locks leave no room, so the release will be refused and no sibling will move. The one
     * weight that *has* moved still says so, or the running total would read a reassuring 100
     * beside rows that plainly do not come to it.
     */
    const { result } = renderHook(() => useWeightDrag());

    act(() =>
      result.current.moveTo(
        [weighted("a", 40), weighted("b", 35, true), weighted("c", 25, true)],
        "a",
        "10",
      ),
    );

    expect([...result.current.preview]).toEqual([["a", 10]]);
    expect(result.current.previewFor("b")).toBeUndefined();
    expect(result.current.previewFor("c")).toBeUndefined();
  });

  it("ignores a position that is not a number, rather than previewing nonsense", () => {
    /**
     * A range input cannot hold one, so this is unreachable through the screen -- but
     * `weightFrom` is honest about text that might not be a number, and `NaN` spread across
     * every sibling would be worse than no preview at all.
     */
    const { result } = renderHook(() => useWeightDrag());

    act(() => result.current.moveTo(STORED, "a", "ten"));

    expect([...result.current.preview]).toEqual([]);
  });

  it("previews nothing again once the gesture has ended", () => {
    const { result } = renderHook(() => useWeightDrag());
    act(() => result.current.moveTo(STORED, "a", "50"));

    act(() => result.current.ended());

    expect([...result.current.preview]).toEqual([]);
    expect(result.current.previewFor("b")).toBeUndefined();
  });
});
