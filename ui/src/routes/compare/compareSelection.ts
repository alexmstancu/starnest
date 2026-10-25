import { isRecord } from "../../shell/sessionState";
import type { Measure } from "./pillarMatrix";

/**
 * What the reader has chosen on Compare, and the rules that keep it a selection the server
 * accepts (M3; X1, PL-092).
 *
 * **Pure.** `useCompareSelection` keeps one of these in the session store, so it survives a tab
 * change, a set switch and a reload, and is reset by a level change.
 *
 * Invariants: the focus is never a comparator; no comparator twice; with a known limit, never
 * more comparators than it; once the roster is known, no id outside it.
 */
export interface CompareSelection {
  focus: string | null;
  /** In the order chosen: the trim keeps the newest, so the order is part of the state. */
  comparators: string[];
  /** How the attribute rows read: the normalised score, or the figure in its own unit. */
  shownAs: ShownAs;
  measure: Measure;
  openPillar: string | null;
  /** Who the last lowered limit took out, said once and cleared by the next choice. */
  trimmed: string[];
}

export type ShownAs = "score" | "raw";

export const EMPTY_SELECTION: CompareSelection = {
  focus: null,
  comparators: [],
  shownAs: "score",
  measure: "points",
  openPillar: null,
  trimmed: [],
};

/** Why a tick changed nothing. */
export type Refusal = "limit" | null;

/**
 * Whether one more comparator fits. **A limit not known is no bound here**: guessing one would be
 * this screen inventing policy, and the server's refusal is the backstop.
 */
export function canAdd(state: CompareSelection, limit: number | null): boolean {
  return limit === null || state.comparators.length < limit;
}

/**
 * Tick or untick one comparator. **At the limit a tick is refused where it was made** and the
 * selection is returned unchanged: it used to be appended and the oldest silently dropped.
 */
export function toggleComparator(
  state: CompareSelection,
  candidate: string,
  limit: number | null,
): { state: CompareSelection; refused: Refusal } {
  if (state.comparators.includes(candidate)) {
    return {
      state: {
        ...state,
        comparators: state.comparators.filter((each) => each !== candidate),
        trimmed: [],
      },
      refused: null,
    };
  }
  if (candidate === state.focus || !canAdd(state, limit)) {
    return { state, refused: candidate === state.focus ? null : "limit" };
  }
  return {
    state: { ...state, comparators: [...state.comparators, candidate], trimmed: [] },
    refused: null,
  };
}

/**
 * **Choosing a focus drops it from the comparators** (P81): a candidate ticked first and then
 * made the focus vanished from the chips while staying in the request, and the server refuses
 * comparing a candidate with itself.
 */
export function chooseFocus(state: CompareSelection, focus: string | null): CompareSelection {
  return {
    ...state,
    focus,
    comparators: state.comparators.filter((each) => each !== focus),
    trimmed: [],
  };
}

/**
 * Keep the newest `limit` comparators, recording who was taken out. **Only a lowered limit
 * removes anyone**, and from the stored selection, so unticking another never brings them back.
 * The newest, because the last clicks are the ones being thought about.
 */
export function trimTo(state: CompareSelection, limit: number | null): CompareSelection {
  if (limit === null || state.comparators.length <= limit) return state;
  const cut = state.comparators.length - limit;
  return {
    ...state,
    comparators: state.comparators.slice(cut),
    trimmed: state.comparators.slice(0, cut),
  };
}

/** Drop every candidate the level's roster does not hold. */
export function prune(state: CompareSelection, roster: ReadonlySet<string>): CompareSelection {
  const focus = state.focus !== null && roster.has(state.focus) ? state.focus : null;
  const comparators = state.comparators.filter((each) => roster.has(each));
  if (focus === state.focus && comparators.length === state.comparators.length) return state;
  return { ...state, focus, comparators };
}

/**
 * A stored selection made true to what is known now: pruned to the roster, then trimmed to the
 * limit. **The same object when nothing changes**, so a caller can tell whether to write.
 */
export function reconcile(
  state: CompareSelection,
  roster: ReadonlySet<string> | null,
  limit: number | null,
): CompareSelection {
  return trimTo(roster === null ? state : prune(state, roster), limit);
}

/** Open one pillar to its attributes, or close it by choosing it again. */
export function openPillar(state: CompareSelection, pillar: string): CompareSelection {
  return { ...state, openPillar: state.openPillar === pillar ? null : pillar };
}

export function setShownAs(state: CompareSelection, shownAs: ShownAs): CompareSelection {
  return { ...state, shownAs };
}

export function setMeasure(state: CompareSelection, measure: Measure): CompareSelection {
  return { ...state, measure };
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === "string");
}

/** A stored selection, if it has the shape this build writes; undefined otherwise. */
export function parseSelection(stored: unknown): CompareSelection | undefined {
  if (!isRecord(stored) || !isIdList(stored["comparators"])) return undefined;
  const focus = stored["focus"];
  const shownAs = stored["shownAs"];
  const measure = stored["measure"];
  const pillar = stored["openPillar"];
  const trimmed = stored["trimmed"];
  return {
    focus: typeof focus === "string" ? focus : null,
    comparators: [...new Set(stored["comparators"])].filter((each) => each !== focus),
    shownAs: shownAs === "raw" ? "raw" : "score",
    measure: measure === "impact" ? "impact" : "points",
    openPillar: typeof pillar === "string" ? pillar : null,
    trimmed: isIdList(trimmed) ? trimmed : [],
  };
}
