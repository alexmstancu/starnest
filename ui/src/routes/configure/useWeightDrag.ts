import { useCallback, useState } from "react";
import {
  NOTHING_PREVIEWED,
  previewRebalance,
  weightFrom,
  type WeightedItem,
} from "./weights";

/**
 * A weight drag in progress, and what it would do to the weights around it.
 *
 * **The server is still asked once, when the pointer lifts** (`arch.md` 8.3). What this adds is
 * the part that was missing while it was down: moving one weight moves its siblings, and a
 * screen that waits for the release to say so spends the whole gesture showing a set that does
 * not sum to 100 -- which reads as the rule being broken rather than as a request not yet made.
 *
 * **Held here rather than in a row, because a row does not know the answer.** What a pillar's
 * weight becomes depends on every other weight at that level and on which of them are locked,
 * so the only place that can preview it is the panel that holds them all.
 *
 * Used by both levels of weighting, because it is the same gesture twice: a pillar's weight
 * within its level, a criterion's within its pillar.
 */

/**
 * The gesture: which weight the pointer holds, where it has moved it to, and what the weights
 * were when it took hold.
 */
interface Gesture {
  moved: string;
  to: number;
  /**
   * **The weights as they stood when the drag began, and never the frame before it.**
   *
   * Every frame is computed from this, which is what the server does with the stored weights on
   * every request it answers. Feeding each preview into the next compounds instead: the drift
   * hides at first, because proportional sharing keeps the siblings' ratios, and then the drag
   * passes a point where the absorbers are all at zero -- at the top of the track, say -- and
   * the shape the reader set is gone for good, replaced on the way back down by an even split.
   */
  from: readonly WeightedItem[];
}

export interface WeightDrag {
  /**
   * What each weight would become if the pointer were lifted now, which is what the running
   * total counts. Empty when nothing is being dragged; when the locks leave the move no room it
   * holds the weight under the pointer and nothing else, because that is all that has moved and
   * all that will -- see below.
   */
  preview: ReadonlyMap<string, number>;
  /**
   * What one row should show, or `undefined` for a row that should show its stored weight.
   *
   * **Nothing for the weight the pointer is holding.** That row renders the position of the
   * pointer, or the thumb fights the cursor -- and its preview is the pointer's position
   * anyway, which is what it would be rendering.
   */
  previewFor: (identifier: string) => number | undefined;
  /**
   * The pointer has moved a weight to the value the control now holds -- text, because that is
   * what an input gives, and the first such call is the one that snapshots the siblings.
   */
  moveTo: (
    siblings: readonly WeightedItem[],
    moved: string,
    asked: string,
  ) => void;
  /**
   * The gesture is over.
   *
   * **Called when the server's answer lands, not when the pointer lifts.** Dropping the preview
   * on release would send every sibling back to its old weight for the length of a round trip
   * and then forward again to nearly the same number -- a flash backwards through a figure
   * nobody chose. The exception is a release that sends nothing, where no answer is coming.
   */
  ended: () => void;
}

export function useWeightDrag(): WeightDrag {
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const rebalanced =
    gesture === null
      ? NOTHING_PREVIEWED
      : previewRebalance(gesture.from, gesture.moved, gesture.to);

  /**
   * **When nothing can absorb the move, the weight under the pointer has still moved.**
   *
   * `previewRebalance` previews nothing then, because nothing is what the release will do. But
   * a total summed from the stored weights would read 100 beside rows that visibly come to 70,
   * which is the screen contradicting itself -- so the one weight that has moved says so, no
   * sibling moves, and the chip stays amber for the length of a gesture the server is going to
   * refuse. The refusal itself is still the server's, and arrives with the release.
   */
  const preview =
    gesture !== null && rebalanced.size === 0
      ? new Map([[gesture.moved, gesture.to]])
      : rebalanced;

  // **Stable, so a panel can list them as effect and callback dependencies.** Both are written
  // as updates on the previous state rather than reads of it, which is what lets them be.
  const moveTo = useCallback(
    (siblings: readonly WeightedItem[], moved: string, asked: string) => {
      // A range input always holds a number, so this never fires -- it is here because
      // `weightFrom` is honest about text that might not be one, and previewing `NaN` across
      // every sibling would be worse than previewing nothing.
      const to = weightFrom(asked);
      if (to === null) return;
      setGesture((current) =>
        current !== null && current.moved === moved
          ? { ...current, to }
          : { moved, to, from: siblings },
      );
    },
    [],
  );
  const ended = useCallback(() => setGesture(null), []);

  return {
    preview,
    previewFor: (identifier) =>
      identifier === gesture?.moved ? undefined : preview.get(identifier),
    moveTo,
    ended,
  };
}
