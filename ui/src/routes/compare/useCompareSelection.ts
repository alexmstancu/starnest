import { useCallback, useEffect, useMemo } from "react";
import { fetchHousehold, fetchRanking, type Candidate } from "../../api/endpoints";
import { useRead } from "../../api/useRead";
import { useSessionState } from "../../shell/SessionProvider";
import {
  EMPTY_SELECTION,
  applyDefaultFocus,
  chooseFocus,
  parseSelection,
  reconcile,
  setMeasure,
  setOpenPillar,
  setShownAs,
  toggleComparator,
  type CompareSelection,
  type ShownAs,
} from "./compareSelection";
import { homeIn, topOfRanking } from "./defaultFocus";
import type { Measure } from "./pillarMatrix";

interface Known {
  roster: readonly Candidate[] | null;
  /** The limit Compare may act on, or null while it is unknown (`knownLimit`). */
  limit: number | null;
  criteriaSetId: string | null;
  levelId: string | null;
}

/**
 * Compare's selection, kept in the session store (X1, PL-016): it survives a tab change, a set
 * switch and a reload, and a level change resets it, because a candidate id means nothing at
 * another level (P54).
 *
 * **What is drawn is the stored selection made true to what is known now**: pruned to the
 * roster once it is read, trimmed to the limit once it is known (PL-092), and given the default
 * focus on the first visit at a level (PL-102). The correction is written back, so a trimmed
 * comparator never returns, the trim is said once, and the default is offered once.
 */
export function useCompareSelection({ roster, limit, criteriaSetId, levelId }: Known) {
  const [stored, setStored] = useSessionState("compare/selection", EMPTY_SELECTION, parseSelection);

  const known = useMemo(
    () => (roster === null ? null : new Set(roster.map((candidate) => candidate.id))),
    [roster],
  );
  const offered = useDefaultFocus(known, stored.defaulted, criteriaSetId, levelId);
  const selection = useMemo(() => {
    const reconciled = reconcile(stored, known, limit);
    return offered === null ? reconciled : applyDefaultFocus(reconciled, offered);
  }, [stored, known, limit, offered]);
  useEffect(() => {
    if (selection !== stored) setStored(selection);
  }, [selection, stored, setStored]);

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
      openPillar: (pillar: string | null) => update((current) => setOpenPillar(current, pillar)),
    }),
    [update, limit],
  );

  return { selection, ...actions };
}

/**
 * The focus Compare opens on, read only while it has not yet been offered at this level: the
 * household's home, and the ranking only when home is not a candidate here.
 */
function useDefaultFocus(
  roster: ReadonlySet<string> | null,
  offeredAlready: boolean,
  criteriaSetId: string | null,
  levelId: string | null,
): string | null {
  const wanted = roster !== null && !offeredAlready && criteriaSetId !== null && levelId !== null;
  const household = useRead(
    useCallback((signal: AbortSignal) => fetchHousehold({ signal }), []),
    { enabled: wanted },
  );
  const householdSettled = household.read.state === "ready" || household.read.state === "failed";
  const home =
    roster !== null && household.read.state === "ready" ? homeIn(roster, household.read.data) : null;
  const ranking = useRead(
    useCallback(
      (signal: AbortSignal) => fetchRanking(criteriaSetId ?? "", levelId ?? "", { signal }),
      [criteriaSetId, levelId],
    ),
    { enabled: wanted && householdSettled && home === null },
  );
  if (!wanted) return null;
  if (home !== null) return home;
  return ranking.read.state === "ready" ? topOfRanking(roster, ranking.read.data) : null;
}
