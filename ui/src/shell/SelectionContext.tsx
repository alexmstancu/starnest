import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchCriteriaSets, fetchLevels, type CriteriaSetSummary, type Level } from "../api/endpoints";
import { useResource, type Resource } from "../api/useResource";

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
  status: "loading" | "ready" | "error";
  error: unknown;
  reload: () => void;
}

const SelectionContext = createContext<Selection | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const levels = useResource(useCallback((signal: AbortSignal) => fetchLevels({ signal }), []));
  const criteriaSets = useResource(
    useCallback((signal: AbortSignal) => fetchCriteriaSets({ signal }), []),
  );

  const [levelId, setLevelId] = useState<string | null>(null);
  const [criteriaSetId, setCriteriaSetId] = useState<string | null>(null);

  const orderedLevels = useMemo(
    () => [...(levels.resource.data?.items ?? [])].sort((a, b) => a.depth_order - b.depth_order),
    [levels.resource.data],
  );
  // Memoised for the same reason `orderedLevels` is: `?? []` builds a new array on every
  // render, and this one is a dependency of the effect below -- so without this the effect
  // re-ran on every render for as long as the fetch had not landed.
  const availableCriteriaSets = useMemo(
    () => criteriaSets.resource.data?.items ?? [],
    [criteriaSets.resource.data],
  );

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
  useEffect(() => {
    const available = availableCriteriaSets.map((set) => set.id);
    const wasThere =
      criteriaSetId !== null && lastSeenCriteriaSets.current.includes(criteriaSetId);
    const isGone = criteriaSetId !== null && !available.includes(criteriaSetId);

    // **An empty list is a reload in flight, not a list with nothing in it**, so it is not
    // recorded: recording it forgot that the discarded set had ever been there, and the
    // correction below then had nothing to recognise when the real list landed a moment later.
    if (available.length === 0) return;
    lastSeenCriteriaSets.current = available;
    if (criteriaSetId === null || (wasThere && isGone)) setCriteriaSetId(available[0]!);
  }, [criteriaSetId, availableCriteriaSets]);

  const reload = useCallback(() => {
    levels.reload();
    criteriaSets.reload();
  }, [levels, criteriaSets]);

  const value: Selection = {
    levels: orderedLevels,
    criteriaSets: availableCriteriaSets,
    levelId,
    criteriaSetId,
    selectLevel: setLevelId,
    selectCriteriaSet: setCriteriaSetId,
    status: combineStatus(levels.resource.status, criteriaSets.resource.status),
    error: levels.resource.error ?? criteriaSets.resource.error,
    reload,
  };

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): Selection {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("useSelection must be used inside SelectionProvider");
  return selection;
}

function combineStatus(...statuses: Resource<unknown>["status"][]): Selection["status"] {
  if (statuses.includes("error")) return "error";
  return statuses.every((status) => status === "ready") ? "ready" : "loading";
}
