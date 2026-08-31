import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCriteriaSets, fetchLevels, type CriteriaSetSummary, type Level } from "../api/endpoints";
import { useResource, type Resource } from "../api/useResource";

/**
 * What the user currently has selected: one criteria set and one level.
 *
 * Both are sidebar controls that every screen reads (`reqs.md` §8.1), so the selection lives
 * above the routes rather than inside any one of them. This is client state in the sense
 * `arch.md` §8.1 permits -- "what is selected" -- and it decides nothing: the level and the
 * criteria set are sent to the API as query parameters, and the API does the rest.
 *
 * Levels are ordered records, not a hardcoded pair (`reqs.md` §3.1). Nothing here assumes two,
 * and nothing here names `country` or `city`; the toggle renders whatever `/v1/levels`
 * returns, in `depth_order`.
 */

export interface Selection {
  levels: Level[];
  criteriaSets: CriteriaSetSummary[];
  levelId: string | null;
  criteriaSetId: string | null;
  selectLevel: (levelId: string) => void;
  selectCriteriaSet: (criteriaSetId: string) => void;
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
  const availableCriteriaSets = criteriaSets.resource.data?.items ?? [];

  // The shallowest level and the first criteria set are the opening view. Adopting a default
  // only while nothing is chosen means a reload never overrides a deliberate choice.
  useEffect(() => {
    if (levelId === null && orderedLevels.length > 0) setLevelId(orderedLevels[0]!.id);
  }, [levelId, orderedLevels]);

  useEffect(() => {
    if (criteriaSetId === null && availableCriteriaSets.length > 0) {
      setCriteriaSetId(availableCriteriaSets[0]!.id);
    }
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

function combineStatus(...statuses: Array<Resource<unknown>["status"]>): Selection["status"] {
  if (statuses.includes("error")) return "error";
  return statuses.every((status) => status === "ready") ? "ready" : "loading";
}
