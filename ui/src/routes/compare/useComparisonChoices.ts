import { useCallback, useMemo } from "react";
import type { Candidate } from "../../api/endpoints";
import { isRecord } from "../../shell/sessionState";
import { useSessionState } from "../../shell/SessionProvider";
import type { ComparisonRequest } from "./comparisonRequest";
import type { Measure } from "./pillarMatrix";

/**
 * Compare's choices -- the focus, the comparators, how the rows read and the comparison asked
 * for -- kept above the routes (PL-016).
 *
 * They survive a visit to another tab, a reload and a criteria-set switch, where the drawn
 * comparison is asked for again under the new set; a level change resets them, because a
 * candidate id means nothing at another level (P54). **A remembered candidate the roster no
 * longer holds is dropped** once the roster is read, so nothing is asked for that the server
 * would refuse.
 */
export function useComparisonChoices(roster: readonly Candidate[] | null) {
  const [picked, setPicked] = useSessionState("compare/selection", NO_PICK, parsePick);
  const [view, setView] = useSessionState("compare/view", DEFAULT_VIEW, parseView);
  const [stored, setAsked] = useSessionState("compare/asked", null, parseRequest);

  const known = useMemo(
    () => (roster === null ? null : new Set(roster.map((candidate) => candidate.id))),
    [roster],
  );
  const kept = useCallback((id: string) => known === null || known.has(id), [known]);
  const focus = picked.focus !== null && kept(picked.focus) ? picked.focus : null;
  const comparators = useMemo(() => picked.comparators.filter(kept), [picked, kept]);
  // Asked again only once the roster says its candidates still exist.
  const asked = useMemo(
    () =>
      stored !== null && known !== null && kept(stored.focus) && stored.comparators.every(kept)
        ? stored
        : null,
    [stored, known, kept],
  );

  // **Choosing a focus drops it from the comparators** (P81). The chips already hide the focus,
  // so a candidate ticked first and then made the focus vanished from the screen while staying
  // in the request -- and the server refuses comparing a candidate with itself, so every
  // Compare answered 409 with nothing on screen to untick. Pruning here keeps what is sent and
  // what is shown the same list.
  const chooseFocus = useCallback(
    (candidate: string | null) =>
      setPicked((current) => ({
        focus: candidate,
        comparators: current.comparators.filter((each) => each !== candidate),
      })),
    [setPicked],
  );
  const toggleComparator = useCallback(
    (candidate: string) =>
      setPicked((current) => ({
        ...current,
        comparators: current.comparators.includes(candidate)
          ? current.comparators.filter((each) => each !== candidate)
          : [...current.comparators, candidate],
      })),
    [setPicked],
  );
  const showAs = useCallback(
    (shownAs: ShownAs) => setView((current) => ({ ...current, shownAs })),
    [setView],
  );
  const measureBy = useCallback(
    (measure: Measure) => setView((current) => ({ ...current, measure })),
    [setView],
  );

  return {
    focus,
    comparators,
    shownAs: view.shownAs,
    measure: view.measure,
    asked,
    chooseFocus,
    toggleComparator,
    showAs,
    measureBy,
    ask: setAsked,
  };
}

/** How the attribute rows read: the normalised score, or the figure in its own unit. */
type ShownAs = "score" | "raw";

interface Pick {
  focus: string | null;
  comparators: string[];
}

interface View {
  shownAs: ShownAs;
  measure: Measure;
}

const NO_PICK: Pick = { focus: null, comparators: [] };
const DEFAULT_VIEW: View = { shownAs: "score", measure: "points" };

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === "string");
}

export function parsePick(stored: unknown): Pick | undefined {
  if (!isRecord(stored) || !isIdList(stored["comparators"])) return undefined;
  const focus = typeof stored["focus"] === "string" ? stored["focus"] : null;
  return { focus, comparators: stored["comparators"] };
}

export function parseView(stored: unknown): View | undefined {
  if (!isRecord(stored)) return undefined;
  const { shownAs, measure } = stored;
  if (shownAs !== "score" && shownAs !== "raw") return undefined;
  if (measure !== "points" && measure !== "impact") return undefined;
  return { shownAs, measure };
}

export function parseRequest(stored: unknown): ComparisonRequest | null | undefined {
  if (stored === null) return null;
  if (!isRecord(stored) || typeof stored["focus"] !== "string") return undefined;
  if (!isIdList(stored["comparators"]) || stored["comparators"].length === 0) return undefined;
  return { focus: stored["focus"], comparators: stored["comparators"] };
}
