import { useMemo } from "react";
import {
  fetchCriteriaSet,
  updatePillarLock,
  updatePillarWeight,
  type CriteriaSet,
} from "../../../api/endpoints";
import type { components } from "../../../api/schema";
import type { PillarNames } from "../../../api/usePillarNames";
import { formatPercentage, pillarName } from "../../../format/display";
import {
  UNDO_CANNOT_RESTORE_THE_PILLARS,
  undoCanRestore,
  type PillarShare,
} from "../changeHistory";
import { settledUndo, type Pending } from "../unknownOutcome";
import type { ChangeHistory } from "../useChangeHistory";

type PillarWeight = components["schemas"]["PillarWeight"];

/**
 * **A pillar's weight and lock go into Recent changes as a criterion's do** (PL-138a), each with
 * the request that reverses it. Noted once the server has answered, so the history lists only
 * what is stored; the reverse is the opposite request, never a local restore.
 *
 * The set is part of the target, because the same pillar in two sets is two decisions.
 */
export function useNotePillarChange(
  criteriaSet: Pick<CriteriaSet, "id" | "name">,
  names: PillarNames,
  /** Shows an answer for a set in whichever panel shows that set now, if any (PL-138a). */
  showAnswer: (setId: string, weights: PillarWeight[]) => void,
  history: ChangeHistory | undefined,
) {
  return useMemo(() => {
    const { id: sentFor, name: inSet } = criteriaSet;
    const named = (pillar: string) => pillarName(names, pillar);
    return {
      weight(
        pillar: string,
        was: PillarWeight[],
        /** Null while the write is unconfirmed: whether undo is exact is then not known. */
        answer: PillarWeight[] | null,
        weight: number,
        pending?: Pending,
      ) {
        const before = was.find((each) => each.pillar === pillar)?.weight;
        history?.note({
          target: `pillar:${sentFor}:${pillar}`,
          // A pillar's weight is a share of its level's hundred, so every pillar's weight and
          // lock in the set is one setting (PL-140).
          setting: `pillar-weights:${sentFor}`,
          stage: "Pillar weights",
          describe: ({ before: from, after: to, inSet: now }) =>
            `Pillar weight for ${named(pillar)}: ${formatPercentage(from as number)} to ${formatPercentage(to as number)}, in ${now ?? inSet}`,
          before,
          after: weight,
          caveat:
            answer === null || undoCanRestore(asShares(was), asShares(answer), pillar)
              ? undefined
              : UNDO_CANNOT_RESTORE_THE_PILLARS,
          // Read back as the write is (P105): an undo whose answer never came is unconfirmed.
          reverse: async (back) => {
            if (typeof back !== "number") return;
            await settledUndo(
              () => updatePillarWeight(sentFor, pillar, back),
              (signal) =>
                pillarsIf(sentFor, (row) => row.pillar === pillar && row.weight === back, signal),
              (answer) => showAnswer(sentFor, answer.items),
            );
          },
          undoes: { criteriaSetId: sentFor, by: "write" },
          ...pending,
        });
      },
      lock(pillar: string, locked: boolean, pending?: Pending) {
        history?.note({
          target: `pillar-lock:${sentFor}:${pillar}`,
          setting: `pillar-weights:${sentFor}`,
          stage: "Pillar weights",
          describe: ({ after: to, inSet: now }) =>
            `${to === true ? "Locked" : "Unlocked"} the ${named(pillar)} pillar, in ${now ?? inSet}`,
          before: !locked,
          after: locked,
          reverse: (back) =>
            settledUndo(
              () => updatePillarLock(sentFor, pillar, back === true),
              (signal) =>
                pillarsIf(
                  sentFor,
                  (row) => row.pillar === pillar && row.weight_locked === (back === true),
                  signal,
                ),
              (answer) => showAnswer(sentFor, answer.items),
            ),
          undoes: { criteriaSetId: sentFor, by: "write" },
          ...pending,
        });
      },
    };
  }, [criteriaSet, names, showAnswer, history]);
}

/**
 * A set's pillar weights read back, when a write's answer was lost: what the write would have
 * answered if the read shows it took effect, nothing when it did not (PL-033). An undo reads back
 * the same way (P105).
 */
export async function pillarsIf(
  criteriaSetId: string,
  tookEffect: (row: PillarWeight) => boolean,
  signal: AbortSignal,
): Promise<{ items: PillarWeight[] } | null> {
  const items = (await fetchCriteriaSet(criteriaSetId, { signal })).pillar_weights ?? [];
  return items.some(tookEffect) ? { items } : null;
}

/** A level's weights in the shape `undoCanRestore` reads a pillar's in. */
function asShares(weights: readonly PillarWeight[]): PillarShare[] {
  return weights.map(({ pillar, weight, weight_locked }) => ({
    attribute: pillar,
    weight,
    weight_locked,
  }));
}
