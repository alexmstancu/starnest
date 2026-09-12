import { useCallback, useEffect, useState } from "react";
import {
  fetchCriteriaSet,
  updateCriterionWeight,
  type CriteriaSet,
  type Criterion,
} from "../../api/endpoints";
import { useResource, type Resource } from "../../api/useResource";

/**
 * One criteria set, and the one write the Configure screen makes.
 *
 * **The weights it holds are the server's answers, never a local calculation.** A weight change
 * rebalances the criterion's siblings, and which siblings absorb it depends on which are locked
 * (`arch.md` 8.3) -- so this sends one number and replaces whatever the response names. Working
 * out the new weights here would put half the arithmetic in the client and guarantee the two
 * halves disagree the first time a lock changes.
 */

export interface CriteriaEditor {
  status: Resource<CriteriaSet>["status"];
  /**
   * The set as fetched, for the panels that read what is on it rather than editing criteria:
   * the pillar weights and which rules it lets act. Null until it has arrived.
   */
  criteriaSet: CriteriaSet | null;
  /** The failure of the fetch, if it failed. */
  error: unknown;
  criteria: Criterion[];
  /** The attribute whose weight is being saved right now, so its row can say so. */
  savingAttribute: string | null;
  /** The failure of the last weight change. Shown; never swallowed. */
  saveError: unknown;
  setWeight: (attribute: string, weight: number) => void;
  reload: () => void;
}

export function useCriteriaEditor(
  criteriaSetId: string | null,
): CriteriaEditor {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<CriteriaSet> => {
      // Not reachable while disabled; the guard is here so the type is honest.
      if (!criteriaSetId) throw new Error("no criteria set selected");
      return fetchCriteriaSet(criteriaSetId, { signal });
    },
    [criteriaSetId],
  );

  const { resource, reload } = useResource(fetcher, criteriaSetId !== null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [savingAttribute, setSavingAttribute] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);

  // A newly fetched set replaces everything, including a stale refusal: the error belonged to
  // weights that are no longer on screen.
  useEffect(() => {
    setCriteria(resource.data?.criteria ?? []);
    setSaveError(null);
  }, [resource.data]);

  const setWeight = useCallback(
    (attribute: string, weight: number) => {
      if (criteriaSetId === null) return;

      setSavingAttribute(attribute);
      setSaveError(null);

      void updateCriterionWeight(criteriaSetId, attribute, weight)
        .then((rebalanced) => {
          setCriteria((current) =>
            applyRebalance(current, rebalanced.criteria),
          );
        })
        .catch((error: unknown) => setSaveError(error))
        .finally(() => setSavingAttribute(null));
    },
    [criteriaSetId],
  );

  return {
    status: resource.status,
    criteriaSet: resource.data,
    error: resource.error,
    criteria,
    savingAttribute,
    saveError,
    setWeight,
    reload,
  };
}

/**
 * Substitutes the rebalanced pillar into the list on screen, matching on attribute.
 *
 * A substitution, not a merge and not a recalculation: whatever the server sent for a
 * criterion is what that criterion now is.
 */
function applyRebalance(
  current: Criterion[],
  rebalanced: Criterion[],
): Criterion[] {
  return current.map(
    (criterion) =>
      rebalanced.find((entry) => entry.attribute === criterion.attribute) ??
      criterion,
  );
}
