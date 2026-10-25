import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  chooseFocus,
  applyDefaultFocus,
  parseSelection,
  prune,
  reconcile,
  setOpenPillar,
  toggleComparator,
  trimTo,
  type CompareSelection,
} from "./compareSelection";

function withComparators(...comparators: string[]): CompareSelection {
  return { ...EMPTY_SELECTION, focus: "pt", comparators };
}

describe("the Compare selection", () => {
  it("refuses a comparator past the limit, and keeps the selection as it was", () => {
    const full = withComparators("es", "nl");

    const { state, refused } = toggleComparator(full, "ee", 2);

    expect(refused).toBe("limit");
    expect(state).toBe(full);
  });

  it("still takes a comparator off at the limit", () => {
    const { state, refused } = toggleComparator(withComparators("es", "nl"), "es", 2);

    expect(refused).toBeNull();
    expect(state.comparators).toEqual(["nl"]);
  });

  it("neither refuses nor trims while the limit is unknown", () => {
    const { state, refused } = toggleComparator(withComparators("es", "nl"), "ee", null);

    expect(refused).toBeNull();
    expect(state.comparators).toEqual(["es", "nl", "ee"]);
    expect(trimTo(state, null)).toBe(state);
  });

  it("trims to the newest when the limit is lowered, and the trimmed never come back", () => {
    const trimmed = trimTo(withComparators("es", "nl", "ee"), 1);

    expect(trimmed.comparators).toEqual(["ee"]);
    expect(trimmed.trimmed).toEqual(["es", "nl"]);

    const unticked = toggleComparator(trimmed, "ee", 1).state;
    expect(unticked.comparators).toEqual([]);
    expect(unticked.trimmed).toEqual([]);
  });

  it("leaves a selection inside the limit as it is", () => {
    const inside = withComparators("es");

    expect(trimTo(inside, 2)).toBe(inside);
  });

  it("drops the new focus from the comparators, freeing its slot (P81)", () => {
    const state = chooseFocus(withComparators("es", "nl"), "nl");

    expect(state.focus).toBe("nl");
    expect(state.comparators).toEqual(["es"]);
  });

  it("drops every id the roster does not hold", () => {
    const state = prune({ ...withComparators("es", "gone"), openPillar: "economics" }, new Set([
      "es",
    ]));

    expect(state.focus).toBeNull();
    expect(state.comparators).toEqual(["es"]);
    expect(state.openPillar).toBe("economics");
  });

  it("reconciles a restored selection against the roster and the limit at once", () => {
    const restored = withComparators("es", "nl", "ee");

    const state = reconcile(restored, new Set(["pt", "es", "nl", "ee"]), 2);

    expect(state.comparators).toEqual(["nl", "ee"]);
    expect(state.trimmed).toEqual(["es"]);
    expect(reconcile(state, new Set(["pt", "es", "nl", "ee"]), 2)).toBe(state);
  });

  it("tells a pillar the reader closed from one nobody has chosen yet", () => {
    expect(EMPTY_SELECTION.openPillar).toBeUndefined();
    const closed = setOpenPillar(setOpenPillar(EMPTY_SELECTION, "economics"), null);

    expect(closed.openPillar).toBeNull();
    expect(parseSelection(JSON.parse(JSON.stringify(closed)))?.openPillar).toBeNull();
    expect(parseSelection(JSON.parse(JSON.stringify(EMPTY_SELECTION)))?.openPillar).toBeUndefined();
  });

  it("offers the default focus once, and never over a choice the reader made", () => {
    const opened = applyDefaultFocus(EMPTY_SELECTION, "ro");
    expect(opened.focus).toBe("ro");

    const cleared = chooseFocus(opened, null);
    expect(applyDefaultFocus(cleared, "ro").focus).toBeNull();

    const chosen = chooseFocus(EMPTY_SELECTION, "pt");
    expect(applyDefaultFocus(chosen, "ro")).toBe(chosen);
  });

  it("reads a stored selection it recognises, and nothing else", () => {
    expect(parseSelection({ ...withComparators("es"), shownAs: "raw" })).toMatchObject({
      comparators: ["es"],
      shownAs: "raw",
    });
    expect(parseSelection({ comparators: [3] })).toBeUndefined();
    expect(parseSelection("nonsense")).toBeUndefined();
  });
});
