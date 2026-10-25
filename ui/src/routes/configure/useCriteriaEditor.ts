import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCriteriaSet,
  updateCriterionLock,
  updateCriterionRule,
  updateCriterionWeight,
  type CriteriaSet,
  type Criterion,
  type CriterionRule,
  type RebalancedPillar,
} from "../../api/endpoints";
import type { Idle, Read } from "../../api/read";
import { useRead } from "../../api/useRead";
import {
  UNDO_CANNOT_RESTORE_THE_PILLAR,
  undoCanRestore,
} from "./changeHistory";
import { titleOf, type AttributeCatalog } from "./criteria/criterionReading";
import type { Answers } from "./useAnswers";
import type { ChangeHistory, RecordedChange } from "./useChangeHistory";
import { confirmation, settled, UnconfirmedWrite } from "./unknownOutcome";

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
  /** The set's read: idle while none is chosen, then pending, failed or ready. */
  read: Read<CriteriaSet> | Idle;
  /**
   * The set as fetched, for the panels that read what is on it rather than editing criteria:
   * the pillar weights and which rules it lets act. Null until it has arrived.
   */
  criteriaSet: CriteriaSet | null;
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
   * Whether a write to this set is in flight -- a change, or the undo of one -- or must wait
   * while the set itself is being deleted or restored (PL-033).
   *
   * **One at a time** (UI-04). Every answer is a whole pillar rebalanced, so two writes in
   * flight can answer in either order, and the later answer would be shown over newer weights.
   */
  busy: boolean;
  /** The failure of the last weight or lock change. Shown; never swallowed. A rule's is its own. */
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
   *
   * Resolves to the refusal for the rule form to report, or null: stored, nothing sent while
   * another write is in flight, or answered for a set no longer on screen.
   */
  setRule: (attribute: string, rule: CriterionRule) => Promise<unknown>;
  reload: () => Promise<void>;
}

export function useCriteriaEditor(
  criteriaSetId: string | null,
  history?: ChangeHistory,
  /** For what a change is called in the history: the catalog's name, never the id. */
  catalog?: AttributeCatalog,
  /**
   * Where an answer goes: to the editor showing its set when it lands, which may not be this one
   * if Configure was left and opened again meanwhile (PL-033).
   */
  answers?: Answers<Criterion[]>,
): CriteriaEditor {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<CriteriaSet> => {
      // Not reachable while disabled; the guard is here so the type is honest.
      if (!criteriaSetId) throw new Error("no criteria set selected");
      // Never a read a write to this set overlapped: the client waits and reads again (PL-142).
      return fetchCriteriaSet(criteriaSetId, { signal });
    },
    [criteriaSetId],
  );

  const { read, reload } = useRead(fetcher, { enabled: criteriaSetId !== null });
  const criteriaSet = read.state === "ready" ? read.data : null;
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [savingAttribute, setSavingAttribute] = useState<string | null>(null);
  const [savingRuleFor, setSavingRuleFor] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);

  // A newly fetched set replaces everything, including a stale refusal: the error belonged to
  // weights that are no longer on screen. A re-read of the same set keeps its data until the
  // answer lands (PL-010), so this runs when that answer does and not in between.
  useEffect(() => {
    setCriteria(criteriaSet?.criteria ?? []);
    setSaveError(null);
  }, [criteriaSet]);

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
  const setName = criteriaSet?.name;

  /** An answer for one set, applied only while that set is the one on screen. */
  const mergeInto = useCallback((sentFor: string, answer: Criterion[]) => {
    if (shownSet.current === sentFor) {
      setCriteria((current) => applyRebalance(current, answer));
    }
  }, []);

  const deliver = useCallback(
    (sentFor: string, answer: Criterion[]) =>
      answers === undefined ? mergeInto(sentFor, answer) : answers.deliver(sentFor, answer),
    [answers, mergeInto],
  );
  useEffect(() => {
    if (answers === undefined || criteriaSetId === null) return undefined;
    return answers.listen(criteriaSetId, (answer) =>
      setCriteria((current) => applyRebalance(current, answer)),
    );
  }, [answers, criteriaSetId]);

  /** A refusal for one set, reported only while that set is the one on screen. */
  const reportFor = useCallback((sentFor: string, error: unknown) => {
    if (shownSet.current === sentFor) setSaveError(error);
  }, []);

  /**
   * A write that failed is reported; one whose answer was lost and could not be read back is
   * listed unconfirmed instead, with Check again (PL-033): it may well have taken effect.
   */
  const noteOrReport = useCallback(
    (sentFor: string, error: unknown, entry: ChangeEntry) => {
      if (error instanceof UnconfirmedWrite) {
        // Confirmed later, what it read back reaches the editor showing the set then.
        const show = (read: RebalancedPillar) => deliver(sentFor, read.criteria);
        history?.note({ ...entry, unconfirmed: confirmation(error, show) });
      } else reportFor(sentFor, error);
    },
    [history, reportFor, deliver],
  );

  const setWeight = useCallback(
    (attribute: string, weight: number) => {
      if (criteriaSetId === null || inFlight.current || undoing) return;
      // The one write in flight, or a wait while another is (PL-033).
      const done = history?.begin();
      if (done === null) return;
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

      // Noted whichever set is on screen now: the change was made, in the set it names. Without
      // an answer -- one lost and not yet confirmed -- whether undo is exact is not known.
      const entry = (rebalanced?: RebalancedPillar): ChangeEntry => ({
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
        caveat:
          rebalanced === undefined || undoCanRestore(criteria, rebalanced.criteria, attribute)
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
          deliver(sentFor, back.criteria);
        },
        undoes: { criteriaSetId: sentFor, by: "write" },
      });

      void settled(
        () => updateCriterionWeight(sentFor, attribute, weight),
        (signal) =>
          criteriaIf(sentFor, attribute, (criterion) => criterion.weight === weight, signal),
      )
        .then((rebalanced) => {
          deliver(sentFor, rebalanced.criteria);
          history?.note(entry(rebalanced));
        })
        .catch((error: unknown) => noteOrReport(sentFor, error, entry()))
        .finally(() => {
          inFlight.current = false;
          setSavingAttribute(null);
          done?.();
        });
    },
    [
      noteOrReport,
      criteriaSetId,
      criteria,
      history,
      undoing,
      catalog,
      setName,
      deliver,
    ],
  );

  const setLock = useCallback(
    (attribute: string, weightLocked: boolean) => {
      if (criteriaSetId === null || inFlight.current || undoing) return;
      // The one write in flight, or a wait while another is (PL-033).
      const done = history?.begin();
      if (done === null) return;
      inFlight.current = true;
      const sentFor = criteriaSetId;

      setSavingAttribute(attribute);
      setSaveError(null);
      const named = titleOf(attribute, catalog?.get(attribute));
      const inSet = setName ?? sentFor;

      const entry = (): ChangeEntry => ({
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
          deliver(sentFor, back.criteria);
        },
        undoes: { criteriaSetId: sentFor, by: "write" },
      });

      void settled(
        () => updateCriterionLock(sentFor, attribute, weightLocked),
        (signal) =>
          criteriaIf(
            sentFor,
            attribute,
            (criterion) => criterion.weight_locked === weightLocked,
            signal,
          ),
      )
        .then((rebalanced) => {
          deliver(sentFor, rebalanced.criteria);
          history?.note(entry());
        })
        .catch((error: unknown) => noteOrReport(sentFor, error, entry()))
        .finally(() => {
          inFlight.current = false;
          setSavingAttribute(null);
          done?.();
        });
    },
    [criteriaSetId, history, undoing, catalog, setName, deliver, noteOrReport],
  );

  const setRule = useCallback(
    (attribute: string, rule: CriterionRule): Promise<unknown> => {
      if (criteriaSetId === null || inFlight.current || undoing) return Promise.resolve(null);
      // The one write in flight, or a wait while another is (PL-033).
      const done = history?.begin();
      if (done === null) return Promise.resolve(null);
      inFlight.current = true;
      const sentFor = criteriaSetId;

      setSavingAttribute(attribute);
      setSavingRuleFor(attribute);
      setSaveError(null);

      return updateCriterionRule(sentFor, attribute, rule)
        .then(
          (changed) => {
            // The same response shape as a weight change, and applied the same way: the screen
            // shows what the server decided rather than what was typed at it.
            deliver(sentFor, changed.criteria);
            return null;
          },
          // **A refused rule is the rule form's to report** (PL-026), field by field inside it,
          // never the pillar's `saveError` -- and only while its set is the one on screen.
          (error: unknown) => (shownSet.current === sentFor ? error : null),
        )
        .finally(() => {
          inFlight.current = false;
          setSavingAttribute(null);
          done?.();
          setSavingRuleFor(null);
        });
    },
    [criteriaSetId, history, undoing, deliver],
  );

  return {
    read,
    criteriaSet,
    criteria,
    savingAttribute,
    savingRuleFor,
    busy:
      savingAttribute !== null ||
      undoing ||
      history?.busy === true,
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

/**
 * A set's criteria read back, when a write's answer was lost: the pillar the write would have
 * answered with if the read shows it took effect, nothing when it did not (PL-033).
 */
async function criteriaIf(
  criteriaSetId: string,
  attribute: string,
  tookEffect: (criterion: Criterion) => boolean,
  signal: AbortSignal,
): Promise<RebalancedPillar | null> {
  const criteria = (await fetchCriteriaSet(criteriaSetId, { signal })).criteria ?? [];
  const written = criteria.find((each) => each.attribute === attribute);
  if (written === undefined || !tookEffect(written)) return null;
  return {
    pillar: written.pillar,
    criteria: criteria.filter((each) => each.pillar === written.pillar),
  };
}

/** A change as the history is given it, before it stamps the id and the time. */
type ChangeEntry = Omit<RecordedChange, "id" | "at">;
