import { useCallback, useEffect, useState } from "react";
import {
  fetchCriteriaSet,
  updateCriterionLock,
  updateCriterionRule,
  updateCriterionWeight,
  type CriteriaSet,
  type Criterion,
  type CriterionRule,
} from "../../api/endpoints";
import { useResource, type Resource } from "../../api/useResource";
import type { ChangeHistory } from "./useChangeHistory";

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
  /**
   * Lock or unlock a weight. **Its own change, not part of a weight change** -- the server
   * refuses to move a locked weight even to the value it already holds.
   */
  setLock: (attribute: string, weightLocked: boolean) => void;
  /**
   * Change how one criterion judges: goal, method, band, anchors, threshold.
   *
   * Separate from `setWeight` because the server treats them differently -- a weight
   * rebalances its pillar and a rule moves nothing -- and because the refusals differ: a
   * weight is refused by locks, a rule by the ontology (`reqs.md` 3.4).
   */
  setRule: (attribute: string, rule: CriterionRule) => void;
  reload: () => void;
}

export function useCriteriaEditor(
  criteriaSetId: string | null,
  history?: ChangeHistory,
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

      // Read before the request, because the answer replaces it and an undo needs the value
      // that was there rather than the one that came back.
      const was = criteria.find((each) => each.attribute === attribute)?.weight;

      void updateCriterionWeight(criteriaSetId, attribute, weight)
        .then((rebalanced) => {
          setCriteria((current) =>
            applyRebalance(current, rebalanced.criteria),
          );
          history?.note({
            target: `criterion:${attribute}`,
            label: `Weight for ${attribute}: ${String(was)} to ${String(weight)}`,
            before: was,
            after: weight,
            // The opposite request, not a local restore: an undo that only moved a number on
            // screen would disagree with the server the moment anything else read it.
            reverse: async (before) => {
              if (typeof before !== "number") return;
              const back = await updateCriterionWeight(
                criteriaSetId,
                attribute,
                before,
              );
              setCriteria((current) => applyRebalance(current, back.criteria));
            },
          });
        })
        .catch((error: unknown) => setSaveError(error))
        .finally(() => setSavingAttribute(null));
    },
    [criteriaSetId, criteria, history],
  );

  const setLock = useCallback(
    (attribute: string, weightLocked: boolean) => {
      if (criteriaSetId === null) return;

      setSavingAttribute(attribute);
      setSaveError(null);

      void updateCriterionLock(criteriaSetId, attribute, weightLocked)
        .then((rebalanced) => {
          setCriteria((current) =>
            applyRebalance(current, rebalanced.criteria),
          );
          history?.note({
            target: `lock:${attribute}`,
            label: `${weightLocked ? "Locked" : "Unlocked"} ${attribute}`,
            before: !weightLocked,
            after: weightLocked,
            reverse: async (before) => {
              const back = await updateCriterionLock(
                criteriaSetId,
                attribute,
                before === true,
              );
              setCriteria((current) => applyRebalance(current, back.criteria));
            },
          });
        })
        .catch((error: unknown) => setSaveError(error))
        .finally(() => setSavingAttribute(null));
    },
    [criteriaSetId, history],
  );

  const setRule = useCallback(
    (attribute: string, rule: CriterionRule) => {
      if (criteriaSetId === null) return;

      setSavingAttribute(attribute);
      setSaveError(null);

      void updateCriterionRule(criteriaSetId, attribute, rule)
        .then((changed) => {
          // The same response shape as a weight change, and applied the same way: the screen
          // shows what the server decided rather than what was typed at it.
          setCriteria((current) => applyRebalance(current, changed.criteria));
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
    setLock,
    setRule,
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
