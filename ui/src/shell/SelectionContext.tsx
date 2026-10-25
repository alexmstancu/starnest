import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchCriteriaSets, fetchLevels, type CriteriaSetListItem, type Level } from "../api/endpoints";
import { combine, map, type Read } from "../api/read";
import { useRead } from "../api/useRead";
import {
  readLastUsedSelection,
  readTabSelection,
  writeSelection,
  type RememberedSet,
  type StoredSelection,
} from "./sessionState";

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
  criteriaSets: CriteriaSetListItem[];
  levelId: string | null;
  criteriaSetId: string | null;
  selectLevel: (levelId: string) => void;
  selectCriteriaSet: (criteriaSetId: string | null) => void;
  /**
   * The remembered set this tab could not reopen because it no longer exists (PL-017), so the
   * sidebar can say which set was gone; null once anything is chosen.
   */
  missingCriteriaSet: RememberedSet | null;
  /**
   * Selects `next` only while `still` is selected, decided against the selection as it is when
   * this runs: for an answer that lands after the reader may have chosen another set, perhaps
   * on another screen (PL-033).
   */
  selectCriteriaSetIf: (still: string | null, next: string) => void;
  /**
   * The two lists as one read (PL-009): what a screen draws first, so a list still coming or
   * one that failed never reads as "there are none". `levels` and `criteriaSets` above are its
   * data once it is ready, and empty until then. **Pending until the opening choice is made**
   * too: lists that have landed with nothing yet adopted from them are not a selection, and a
   * screen reading "no set" in that render drew a fact from it (PL-001).
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
  /** The run that last ended, when the shell knows which; a figure typed by hand is none. */
  lastEndedRun: number | null;
  noteAcquisitionEnded: (runId?: number) => void;
  /**
   * Bumped whenever a screen starts an acquisition (PL-132), so the shell's watch looks at once
   * and follows it closely, rather than at its idle pace of every thirty seconds.
   */
  acquisitionsStarted: number;
  noteAcquisitionStarted: () => void;
}

export interface SelectionLists {
  levels: Level[];
  criteriaSets: CriteriaSetListItem[];
}

const SelectionContext = createContext<Selection | null>(null);
const NO_LEVELS: Level[] = [];
const NO_SETS: CriteriaSetListItem[] = [];
const PENDING: Read<never> = { state: "pending" };

export function SelectionProvider({ children }: { children: ReactNode }) {
  const levels = useRead(useCallback((signal: AbortSignal) => fetchLevels({ signal }), []));
  const criteriaSets = useRead(
    useCallback((signal: AbortSignal) => fetchCriteriaSets({ signal }), []),
  );
  // Never idle: both are always asked for, so the narrowing only satisfies the type.
  const levelsRead: Read<{ items: Level[] }> = levels.read.state === "idle" ? PENDING : levels.read;
  const setsRead: Read<{ items: CriteriaSetListItem[] }> =
    criteriaSets.read.state === "idle" ? PENDING : criteriaSets.read;
  // The data, not the read: a re-read makes a new read object around the same data, and only a
  // new answer should move what depends on it.
  const levelsData = levelsRead.state === "ready" ? levelsRead.data : null;
  const setsData = setsRead.state === "ready" ? setsRead.data : null;

  // **Restored, then checked** (PL-017, P1-19): a reload keeps this tab's set and level, a new
  // tab opens on the ones last used anywhere. Held back from every screen until the lists have
  // been read, so nothing asks for a set that has since gone.
  const [restored] = useState(restoreSelection);
  const [levelId, setLevelId] = useState<string | null>(restored?.levelId ?? null);
  const [criteriaSetId, setCriteriaSetId] = useState<string | null>(
    restored?.criteriaSet?.id ?? null,
  );
  const [levelChecked, setLevelChecked] = useState(restored?.levelId == null);
  const [setChecked, setSetChecked] = useState(restored?.criteriaSet == null);
  const [missingCriteriaSet, setMissingCriteriaSet] = useState<RememberedSet | null>(null);
  // Only a choice made here becomes the one a new tab opens on; restoring or falling back is not.
  const chosenHere = useRef(false);
  const selectLevel = useCallback((next: string) => {
    chosenHere.current = true;
    setLevelChecked(true);
    setLevelId(next);
  }, []);
  const selectCriteriaSet = useCallback((next: string | null) => {
    chosenHere.current = true;
    setSetChecked(true);
    setMissingCriteriaSet(null);
    setCriteriaSetId(next);
  }, []);
  const [savedRankingsVersion, setSavedRankingsVersion] = useState(0);
  const noteSavedRanking = useCallback(
    () => setSavedRankingsVersion((version) => version + 1),
    [],
  );
  const [acquisitionsEnded, setAcquisitionsEnded] = useState(0);
  const [lastEndedRun, setLastEndedRun] = useState<number | null>(null);
  const noteAcquisitionEnded = useCallback((runId?: number) => {
    setLastEndedRun(runId ?? null);
    setAcquisitionsEnded((ended) => ended + 1);
  }, []);
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
    if (orderedLevels.length === 0) return;
    if (levelId === null || !orderedLevels.some((level) => level.id === levelId)) {
      setLevelId(orderedLevels[0]!.id);
    }
    setLevelChecked(true);
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
    if (!setChecked) {
      // The remembered set is checked once, against the first list read: one that has gone
      // (a soft-deleted set answers 404) gives way to the first, and the sidebar names it.
      lastSeenCriteriaSets.current = available;
      setSetChecked(true);
      if (criteriaSetId !== null && !available.includes(criteriaSetId)) {
        setMissingCriteriaSet(restored?.criteriaSet ?? null);
        setCriteriaSetId(available[0] ?? null);
      }
      return;
    }
    const wasThere =
      criteriaSetId !== null && lastSeenCriteriaSets.current.includes(criteriaSetId);
    const isGone = criteriaSetId !== null && !available.includes(criteriaSetId);

    lastSeenCriteriaSets.current = available;
    if ((criteriaSetId === null && available.length > 0) || (wasThere && isGone)) {
      setCriteriaSetId(available[0] ?? null);
    }
  }, [criteriaSetsReady, criteriaSetId, availableCriteriaSets, setChecked, restored]);

  // Exposed only once checked, so the screens read what the lists confirm.
  const shownLevelId = levelChecked ? levelId : null;
  const shownCriteriaSetId = setChecked ? criteriaSetId : null;
  const shownSetName = availableCriteriaSets.find((set) => set.id === shownCriteriaSetId)?.name;
  useEffect(() => {
    if (!levelChecked || !setChecked) return;
    if (shownLevelId === null && shownCriteriaSetId === null) return;
    const criteriaSet =
      shownCriteriaSetId === null
        ? null
        : { id: shownCriteriaSetId, name: shownSetName ?? shownCriteriaSetId };
    writeSelection({ criteriaSet, levelId: shownLevelId }, { lastUsed: chosenHere.current });
  }, [levelChecked, setChecked, shownLevelId, shownCriteriaSetId, shownSetName]);

  const selectCriteriaSetIf = useCallback(
    (still: string | null, next: string) =>
      setCriteriaSetId((current) => (current === still ? next : current)),
    [],
  );

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
  const adopting =
    (levelId === null && orderedLevels.length > 0) ||
    (criteriaSetId === null && availableCriteriaSets.length > 0);
  const read = useMemo(
    () =>
      adopting
        ? PENDING
        : map(combine(levelsRead, setsRead), ([, sets]) => ({
            levels: orderedLevels,
            criteriaSets: sets.items,
          })),
    [adopting, levelsRead, setsRead, orderedLevels],
  );
  const value: Selection = useMemo(
    () => ({
      levels: orderedLevels,
      criteriaSets: availableCriteriaSets,
      levelId: shownLevelId,
      criteriaSetId: shownCriteriaSetId,
      selectLevel,
      selectCriteriaSet,
      missingCriteriaSet,
      selectCriteriaSetIf,
      savedRankingsVersion,
      noteSavedRanking,
      acquisitionsEnded,
      lastEndedRun,
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
      shownLevelId,
      shownCriteriaSetId,
      selectLevel,
      selectCriteriaSet,
      missingCriteriaSet,
      selectCriteriaSetIf,
      savedRankingsVersion,
      noteSavedRanking,
      acquisitionsEnded,
      lastEndedRun,
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

/**
 * Where this tab opens: its own selection on a reload, else a set named in the address (a shared
 * link), else the one last used in any tab.
 */
function restoreSelection(): StoredSelection | undefined {
  const own = readTabSelection();
  if (own !== undefined) return own;
  const lastUsed = readLastUsedSelection();
  const fromAddress = new URLSearchParams(window.location.search).get("set");
  if (fromAddress === null || fromAddress === "") return lastUsed;
  return { criteriaSet: { id: fromAddress, name: fromAddress }, levelId: lastUsed?.levelId ?? null };
}

export function useSelection(): Selection {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("useSelection must be used inside SelectionProvider");
  return selection;
}
