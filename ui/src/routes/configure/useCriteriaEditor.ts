import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  UNDO_CANNOT_RESTORE_THE_PILLAR,
  undoCanRestore,
} from "./changeHistory";
import { titleOf, type AttributeCatalog } from "./criteria/criterionReading";
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
  /**
   * The attribute whose *rule* is being saved, which is not the same question.
   *
   * A weight drag and a lock both set `savingAttribute` as well, and the rule editor
   * reverts its draft when a save it was waiting for finishes -- so dragging a weight
   * threw away an unsent rule edit on the same row, with nothing said (P82).
   */
  savingRuleFor: string | null;
  /**
   * Whether a write to this set is in flight: a change, or the undo of one.
   *
   * **One at a time** (UI-04). Every answer is a whole pillar rebalanced, so two writes in
   * flight can answer in either order, and the later answer would be shown over newer weights.
   */
  busy: boolean;
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

/** A set as read, with the set it is and how many of its writes had been answered when asked. */
interface SetRead {
  set: CriteriaSet;
  id: string;
  begunAfter: number;
}

export function useCriteriaEditor(
  criteriaSetId: string | null,
  history?: ChangeHistory,
  /** For what a change is called in the history: the catalog's name, never the id. */
  catalog?: AttributeCatalog,
): CriteriaEditor {
  // **How many writes to each set have been answered** (UIC-A3). A read carries the count it
  // began at: one that lands after another write to its set was answered may have been taken
  // before that write committed, so it is read again rather than shown. Shown, it ended the
  // screen on weights older than a save it had just confirmed.
  const answered = useRef(new Map<string, number>());

  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<SetRead> => {
      // Not reachable while disabled; the guard is here so the type is honest.
      if (!criteriaSetId) throw new Error("no criteria set selected");
      const begunAfter = answered.current.get(criteriaSetId) ?? 0;
      const set = await fetchCriteriaSet(criteriaSetId, { signal });
      return { set, id: criteriaSetId, begunAfter };
    },
    [criteriaSetId],
  );

  const { resource, reload } = useResource(fetcher, criteriaSetId !== null);
  const loaded = resource.data?.set ?? null;
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [savingAttribute, setSavingAttribute] = useState<string | null>(null);
  const [savingRuleFor, setSavingRuleFor] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);

  // A newly fetched set replaces everything, including a stale refusal: the error belonged to
  // weights that are no longer on screen.
  useEffect(() => {
    const read = resource.data;
    if (read !== null && (answered.current.get(read.id) ?? 0) !== read.begunAfter) {
      reload();
      return;
    }
    setCriteria(read?.set.criteria ?? []);
    setSaveError(null);
  }, [resource.data, reload]);

  // **Which set is on screen when an answer lands**, not when it was asked for (UI-04). A set
  // chosen meanwhile holds the same attributes when it is a copy, so an answer matched on
  // attribute alone would land in a set it was never sent to. Written in an effect because
  // lint forbids writing a ref during render.
  const shownSet = useRef(criteriaSetId);
  useEffect(() => {
    shownSet.current = criteriaSetId;
  }, [criteriaSetId]);
  // A ref as well as `savingAttribute`, because two releases in one tick would both pass a
  // check on state that has not re-rendered yet.
  const inFlight = useRef(false);
  const undoing = history?.undoing === true;
  const setName = loaded?.name;

  /** An answer for one set, applied only while that set is the one on screen. */
  const mergeInto = useCallback((sentFor: string, answer: Criterion[]) => {
    answered.current.set(sentFor, (answered.current.get(sentFor) ?? 0) + 1);
    if (shownSet.current === sentFor) {
      setCriteria((current) => applyRebalance(current, answer));
    }
  }, []);

  /** A refusal for one set, reported only while that set is the one on screen. */
  const reportFor = useCallback((sentFor: string, error: unknown) => {
    if (shownSet.current === sentFor) setSaveError(error);
  }, []);

  const setWeight = useCallback(
    (attribute: string, weight: number) => {
      if (criteriaSetId === null || inFlight.current || undoing) return;
      inFlight.current = true;
      const sentFor = criteriaSetId;

      setSavingAttribute(attribute);
      setSaveError(null);

      // Read before the request, because the answer replaces it and an undo needs the value
      // that was there rather than the one that came back. The names too: the history says
      // what the change was when it was made, whichever set is on screen when it lands.
      const was = criteria.find((each) => each.attribute === attribute)?.weight;
      const named = titleOf(attribute, catalog?.get(attribute));
      const inSet = setName ?? sentFor;

      void updateCriterionWeight(sentFor, attribute, weight)
        .then((rebalanced) => {
          mergeInto(sentFor, rebalanced.criteria);
          // Noted whichever set is on screen now: the change was made, in the set it names.
          history?.note({
            // The set is part of the identity: the same attribute in two sets is two
            // decisions, and folding them together undid one set's weight into the other.
            target: `criterion:${sentFor}:${attribute}`,
            // The stage it was made in, named: a criterion's weight is a share of its
            // pillar's, so it is changed inside the pillar weights rather than anywhere of
            // its own.
            stage: "Pillar weights",
            label: `Weight for ${named}: ${String(was)} to ${String(weight)}, in ${inSet}`,
            before: was,
            after: weight,
            caveat: undoCanRestore(criteria, rebalanced.criteria, attribute)
              ? undefined
              : UNDO_CANNOT_RESTORE_THE_PILLAR,
            // The opposite request, not a local restore: an undo that only moved a number on
            // screen would disagree with the server the moment anything else read it.
            reverse: async (before) => {
              if (typeof before !== "number") return;
              const back = await updateCriterionWeight(
                sentFor,
                attribute,
                before,
              );
              mergeInto(sentFor, back.criteria);
            },
          });
        })
        .catch((error: unknown) => reportFor(sentFor, error))
        .finally(() => {
          inFlight.current = false;
          setSavingAttribute(null);
        });
    },
    [
      criteriaSetId,
      criteria,
      history,
      undoing,
      catalog,
      setName,
      mergeInto,
      reportFor,
    ],
  );

  const setLock = useCallback(
    (attribute: string, weightLocked: boolean) => {
      if (criteriaSetId === null || inFlight.current || undoing) return;
      inFlight.current = true;
      const sentFor = criteriaSetId;

      setSavingAttribute(attribute);
      setSaveError(null);
      const named = titleOf(attribute, catalog?.get(attribute));
      const inSet = setName ?? sentFor;

      void updateCriterionLock(sentFor, attribute, weightLocked)
        .then((rebalanced) => {
          mergeInto(sentFor, rebalanced.criteria);
          history?.note({
            target: `lock:${sentFor}:${attribute}`,
            stage: "Pillar weights",
            label: `${weightLocked ? "Locked" : "Unlocked"} ${named}, in ${inSet}`,
            before: !weightLocked,
            after: weightLocked,
            reverse: async (before) => {
              const back = await updateCriterionLock(
                sentFor,
                attribute,
                before === true,
              );
              mergeInto(sentFor, back.criteria);
            },
          });
        })
        .catch((error: unknown) => reportFor(sentFor, error))
        .finally(() => {
          inFlight.current = false;
          setSavingAttribute(null);
        });
    },
    [criteriaSetId, history, undoing, catalog, setName, mergeInto, reportFor],
  );

  const setRule = useCallback(
    (attribute: string, rule: CriterionRule) => {
      if (criteriaSetId === null || inFlight.current || undoing) return;
      inFlight.current = true;
      const sentFor = criteriaSetId;

      setSavingAttribute(attribute);
      setSavingRuleFor(attribute);
      setSaveError(null);

      void updateCriterionRule(sentFor, attribute, rule)
        .then((changed) => {
          // The same response shape as a weight change, and applied the same way: the screen
          // shows what the server decided rather than what was typed at it.
          mergeInto(sentFor, changed.criteria);
        })
        .catch((error: unknown) => reportFor(sentFor, error))
        .finally(() => {
          inFlight.current = false;
          setSavingAttribute(null);
          setSavingRuleFor(null);
        });
    },
    [criteriaSetId, undoing, mergeInto, reportFor],
  );

  return {
    status: resource.status,
    criteriaSet: loaded,
    error: resource.error,
    criteria,
    savingAttribute,
    savingRuleFor,
    busy: savingAttribute !== null || undoing,
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
