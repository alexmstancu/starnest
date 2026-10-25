import { useCallback, useEffect, useMemo } from "react";
import type { Candidate } from "../../api/endpoints";
import { isRecord } from "../../shell/sessionState";
import { useSessionState } from "../../shell/SessionProvider";
import type { ComparisonRequest } from "./comparisonRequest";
import {
  EMPTY_SELECTION,
  chooseFocus,
  openPillar,
  parseSelection,
  reconcile,
  setMeasure,
  setShownAs,
  toggleComparator,
  type CompareSelection,
  type ShownAs,
} from "./compareSelection";
import type { Measure } from "./pillarMatrix";

/**
 * Compare's selection, kept in the session store (X1, PL-016): it survives a tab change, a set
 * switch and a reload, and a level change resets it, because a candidate id means nothing at
 * another level (P54).
 *
 * **What is drawn is the stored selection made true to what is known now**: pruned to the
 * roster once it is read, trimmed to the limit once it is known (PL-092). The correction is
 * written back, so a trimmed comparator never returns and the trim is said once.
 */
export function useCompareSelection(roster: readonly Candidate[] | null, limit: number | null) {
  const [stored, setStored] = useSessionState("compare/selection", EMPTY_SELECTION, parseSelection);
  const [storedAsk, setAsked] = useSessionState("compare/asked", null, parseRequest);

  const known = useMemo(
    () => (roster === null ? null : new Set(roster.map((candidate) => candidate.id))),
    [roster],
  );
  const selection = useMemo(() => reconcile(stored, known, limit), [stored, known, limit]);
  useEffect(() => {
    if (selection !== stored) setStored(selection);
  }, [selection, stored, setStored]);

  // Asked again only once the roster says its candidates still exist.
  const asked = useMemo(
    () =>
      storedAsk !== null &&
      known !== null &&
      known.has(storedAsk.focus) &&
      storedAsk.comparators.every((each) => known.has(each))
        ? storedAsk
        : null,
    [storedAsk, known],
  );

  const update = useCallback(
    (change: (current: CompareSelection) => CompareSelection) =>
      setStored((current) => change(reconcile(current, known, limit))),
    [setStored, known, limit],
  );
  const actions = useMemo(
    () => ({
      chooseFocus: (focus: string | null) => update((current) => chooseFocus(current, focus)),
      toggleComparator: (candidate: string) =>
        update((current) => toggleComparator(current, candidate, limit).state),
      showAs: (shownAs: ShownAs) => update((current) => setShownAs(current, shownAs)),
      measureBy: (measure: Measure) => update((current) => setMeasure(current, measure)),
      openPillar: (pillar: string) => update((current) => openPillar(current, pillar)),
      ask: setAsked,
    }),
    [update, limit, setAsked],
  );

  return { selection, asked, ...actions };
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === "string");
}

function parseRequest(stored: unknown): ComparisonRequest | null | undefined {
  if (stored === null) return null;
  if (!isRecord(stored) || typeof stored["focus"] !== "string") return undefined;
  if (!isIdList(stored["comparators"]) || stored["comparators"].length === 0) return undefined;
  return { focus: stored["focus"], comparators: stored["comparators"] };
}
