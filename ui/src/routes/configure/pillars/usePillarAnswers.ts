import { useMemo, useRef } from "react";
import type { components } from "../../../api/schema";

type PillarWeight = components["schemas"]["PillarWeight"];

/**
 * Where a pillar undo's answer goes (PL-138a): **to the panel on screen now**, not the one that
 * recorded the change.
 *
 * The history outlives the pillar panel -- switching sets remounts it -- so an undo whose reverse
 * called the recording panel's own setter fed a panel long gone, and the screen kept showing the
 * weight the server had just put back. The screen holds this; the mounted panel listens for its
 * set, as a criterion's answer reaches the editor through `mergeInto(sentFor, ...)`. An answer
 * for a set nobody shows is dropped: that set is read afresh when it is next shown.
 */
export interface PillarAnswers {
  /** Shows a set's answers in `show` until the returned function is called. */
  listen: (setId: string, show: (weights: PillarWeight[]) => void) => () => void;
  deliver: (setId: string, weights: PillarWeight[]) => void;
}

export function usePillarAnswers(): PillarAnswers {
  const listeners = useRef(new Map<string, (weights: PillarWeight[]) => void>());
  return useMemo(
    () => ({
      listen: (setId, show) => {
        listeners.current.set(setId, show);
        return () => {
          if (listeners.current.get(setId) === show) listeners.current.delete(setId);
        };
      },
      deliver: (setId, weights) => listeners.current.get(setId)?.(weights),
    }),
    [],
  );
}
