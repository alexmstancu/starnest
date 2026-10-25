import { useMemo } from "react";
import { updatePillarLock, updatePillarWeight, type CriteriaSet } from "../../../api/endpoints";
import type { components } from "../../../api/schema";
import type { PillarNames } from "../../../api/usePillarNames";
import { formatPercentage, pillarName } from "../../../format/display";
import {
  UNDO_CANNOT_RESTORE_THE_PILLARS,
  undoCanRestore,
  type PillarShare,
} from "../changeHistory";
import type { Pending } from "../unknownOutcome";
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
          stage: "Pillar weights",
          label: `Pillar weight for ${named(pillar)}: ${formatPercentage(before)} to ${formatPercentage(weight)}, in ${inSet}`,
          before,
          after: weight,
          caveat:
            answer === null || undoCanRestore(asShares(was), asShares(answer), pillar)
              ? undefined
              : UNDO_CANNOT_RESTORE_THE_PILLARS,
          reverse: async (back) => {
            if (typeof back !== "number") return;
            showAnswer(sentFor, (await updatePillarWeight(sentFor, pillar, back)).items);
          },
          undoes: { criteriaSetId: sentFor, by: "write" },
          ...pending,
        });
      },
      lock(pillar: string, locked: boolean, pending?: Pending) {
        history?.note({
          target: `pillar-lock:${sentFor}:${pillar}`,
          stage: "Pillar weights",
          label: `${locked ? "Locked" : "Unlocked"} the ${named(pillar)} pillar, in ${inSet}`,
          before: !locked,
          after: locked,
          reverse: async (back) => {
            showAnswer(sentFor, (await updatePillarLock(sentFor, pillar, back === true)).items);
          },
          undoes: { criteriaSetId: sentFor, by: "write" },
          ...pending,
        });
      },
    };
  }, [criteriaSet, names, showAnswer, history]);
}

/** A level's weights in the shape `undoCanRestore` reads a pillar's in. */
function asShares(weights: readonly PillarWeight[]): PillarShare[] {
  return weights.map(({ pillar, weight, weight_locked }) => ({
    attribute: pillar,
    weight,
    weight_locked,
  }));
}
