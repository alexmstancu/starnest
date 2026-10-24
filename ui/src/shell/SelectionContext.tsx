import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchCriteriaSets, fetchLevels, type CriteriaSetSummary, type Level } from "../api/endpoints";
import { combine, map, type Read } from "../api/read";
import { useRead } from "../api/useRead";

/**
 * What the user currently has selected: one criteria set and one level.
 *
 * Both are sidebar controls that every screen reads (`reqs.md` 8.1), so the selection lives
 * above the routes rather than inside any one of them. This is client state in the sense
 * `arch.md` 8.1 permits -- "what is selected" -- and it decides nothing: the level and the
 * criteria set are sent to the API as query parameters, and the API does the rest.
 *
 * Levels are ordered records, not a hardcoded pair (`reqs.md` 3.1). Nothing here assumes two,
 * and nothing here names `country` or `city`; the toggle renders whatever `/v1/levels`
 * returns, in `depth_order`.
 */

export interface Selection {
  levels: Level[];
  criteriaSets: CriteriaSetSummary[];
  levelId: string | null;
  criteriaSetId: string | null;
  selectLevel: (levelId: string) => void;
  selectCriteriaSet: (criteriaSetId: string | null) => void;
  /**
   * The two lists as one read (PL-009): what a screen draws first, so a list still coming or
   * one that failed never reads as "there are none". `levels` and `criteriaSets` above are its
   * data once it is ready, and empty until then.
   */
  read: Read<SelectionLists>;
  /** Reads both lists again, keeping them on screen meanwhile. */
  reload: () => void;
  /** `reload`, settling once both lists have landed: for a caller that must wait for them. */
  reloadAndWait: () => Promise<void>;
  /**
   * Bumped whenever a ranking is saved.
   *
   * **The sidebar lists what Rank saves**, and the two are in different subtrees, so one has
   * to be able to tell the other that the list has moved on. A counter rather than the list
   * itself: what changed is "there is something new to read", and the server stays the
   * authority on what that is.
   */
  savedRankingsVersion: number;
  noteSavedRanking: () => void;
  /**
   * Bumped whenever an acquisition the shell saw running stops running (UI-11).
   *
   * **The strip under the tabs watches the run and the sidebar reports it**, in different
   * subtrees again -- so the same kind of counter as the one above, for the same reason: what
   * changed is "the last run and the ranking are worth reading again", and the server stays
   * the authority on what they now say.
   */
  acquisitionsEnded: number;
  noteAcquisitionEnded: () => void;
  /**
   * Bumped whenever a screen starts an acquisition (PL-132), so the shell's watch looks at once
   * and follows it closely, rather than at its idle pace of every thirty seconds.
   */
  acquisitionsStarted: number;
  noteAcquisitionStarted: () => void;
}

export interface SelectionLists {
  levels: Level[];
  criteriaSets: CriteriaSetSummary[];
}

const SelectionContext = createContext<Selection | null>(null);
const NO_LEVELS: Level[] = [];
const NO_SETS: CriteriaSetSummary[] = [];
const PENDING: Read<never> = { state: "pending" };

export function SelectionProvider({ children }: { children: ReactNode }) {
  const levels = useRead(useCallback((signal: AbortSignal) => fetchLevels({ signal }), []));
  const criteriaSets = useRead(
    useCallback((signal: AbortSignal) => fetchCriteriaSets({ signal }), []),
  );
  // Never idle: both are always asked for, so the narrowing only satisfies the type.
  const levelsRead: Read<{ items: Level[] }> = levels.read.state === "idle" ? PENDING : levels.read;
  const setsRead: Read<{ items: CriteriaSetSummary[] }> =
    criteriaSets.read.state === "idle" ? PENDING : criteriaSets.read;
  // The data, not the read: a re-read makes a new read object around the same data, and only a
  // new answer should move what depends on it.
  const levelsData = levelsRead.state === "ready" ? levelsRead.data : null;
  const setsData = setsRead.state === "ready" ? setsRead.data : null;

  const [levelId, setLevelId] = useState<string | null>(null);
  const [criteriaSetId, setCriteriaSetId] = useState<string | null>(null);
  const [savedRankingsVersion, setSavedRankingsVersion] = useState(0);
  const noteSavedRanking = useCallback(
    () => setSavedRankingsVersion((version) => version + 1),
    [],
  );
  const [acquisitionsEnded, setAcquisitionsEnded] = useState(0);
  const noteAcquisitionEnded = useCallback(
    () => setAcquisitionsEnded((ended) => ended + 1),
    [],
  );
  const [acquisitionsStarted, setAcquisitionsStarted] = useState(0);
  const noteAcquisitionStarted = useCallback(
    () => setAcquisitionsStarted((started) => started + 1),
    [],
  );

  const orderedLevels = useMemo(
    () =>
      levelsData === null
        ? NO_LEVELS
        : [...levelsData.items].sort((a, b) => a.depth_order - b.depth_order),
    [levelsData],
  );
  // One empty array, not a new one each render: this is a dependency of the effect below, and
  // a fresh `[]` re-ran it on every render for as long as the fetch had not landed.
  const availableCriteriaSets = setsData === null ? NO_SETS : setsData.items;

  // The shallowest level and the first criteria set are the opening view. Adopting a default
  // only while nothing is chosen means a reload never overrides a deliberate choice.
  useEffect(() => {
    if (levelId === null && orderedLevels.length > 0) setLevelId(orderedLevels[0]!.id);
  }, [levelId, orderedLevels]);

  // **A set that disappears takes the selection with it** (P44). Adopting only while nothing was
  // chosen left a discarded set selected: every screen went on requesting an id the server had
  // deleted, Configure showed "No such criteria set.", and a 404 is not retryable, so there was
  // no Try again to press either.
  //
  // **Keyed on disappearance, not on absence.** "Not in the list" alone is the wrong rule and
  // broke creating a set: a new one is selected the moment the server confirms it, a beat before
  // the refreshed list arrives, and absence-as-the-rule snapped the selection straight back to
  // the first existing set. A set that was in the list and has left it is the real event, and it
  // covers a set deleted from anywhere, not only from the panel below.
  const lastSeenCriteriaSets = useRef<string[]>([]);
  const criteriaSetsReady = setsData !== null;
  useEffect(() => {
    // **A list that has not arrived is a reload in flight**, so it is not recorded: recording
    // it forgot that the discarded set had ever been there, and the correction below then had
    // nothing to recognise when the real list landed a moment later. **An empty list that has
    // arrived is a real answer** (UI-28): reading it as "in flight" too left the last set
    // discarded still selected, so every screen went on asking for it.
    if (!criteriaSetsReady) return;
    const available = availableCriteriaSets.map((set) => set.id);
    const wasThere =
      criteriaSetId !== null && lastSeenCriteriaSets.current.includes(criteriaSetId);
    const isGone = criteriaSetId !== null && !available.includes(criteriaSetId);

    lastSeenCriteriaSets.current = available;
    if ((criteriaSetId === null && available.length > 0) || (wasThere && isGone)) {
      setCriteriaSetId(available[0] ?? null);
    }
  }, [criteriaSetsReady, criteriaSetId, availableCriteriaSets]);

  // **Depends on the two `reload` functions, not on the reads that carry them.** The hook
  // returns a fresh object every render, so `[levels, criteriaSets]` would make the context
  // value below new every render -- and a consumer reading it in a dependency array would
  // re-run its effect for ever, the shape behind the 137,316-request loop already filed once.
  const reloadLevels = levels.reload;
  const reloadCriteriaSets = criteriaSets.reload;
  const reloadAndWait = useCallback(async () => {
    await Promise.all([reloadLevels(), reloadCriteriaSets()]);
  }, [reloadLevels, reloadCriteriaSets]);
  const reload = useCallback(() => void reloadAndWait(), [reloadAndWait]);

  // **Memoised, so the context has a stable identity.** `orderedLevels` and
  // `availableCriteriaSets` are already memoised and `reload` is now genuinely stable, so this
  // object was the last thing making every consumer re-render on every render of the shell --
  // and the only thing standing between a consumer that reads `selection` in a dependency
  // array and an endless effect.
  const read = useMemo(
    () =>
      map(combine(levelsRead, setsRead), ([, sets]) => ({
        levels: orderedLevels,
        criteriaSets: sets.items,
      })),
    [levelsRead, setsRead, orderedLevels],
  );
  const value: Selection = useMemo(
    () => ({
      levels: orderedLevels,
      criteriaSets: availableCriteriaSets,
      levelId,
      criteriaSetId,
      selectLevel: setLevelId,
      selectCriteriaSet: setCriteriaSetId,
      savedRankingsVersion,
      noteSavedRanking,
      acquisitionsEnded,
      noteAcquisitionEnded,
      acquisitionsStarted,
      noteAcquisitionStarted,
      read,
      reload,
      reloadAndWait,
    }),
    [
      orderedLevels,
      availableCriteriaSets,
      levelId,
      criteriaSetId,
      savedRankingsVersion,
      noteSavedRanking,
      acquisitionsEnded,
      noteAcquisitionEnded,
      acquisitionsStarted,
      noteAcquisitionStarted,
      read,
      reload,
      reloadAndWait,
    ],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): Selection {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("useSelection must be used inside SelectionProvider");
  return selection;
}
