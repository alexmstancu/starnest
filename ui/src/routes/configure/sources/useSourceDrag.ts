import { useCallback, useState } from "react";
import { landingEdge, type OrderedSource } from "./sourceOrder";

/**
 * A source being dragged to a new place in the order.
 *
 * **The gesture is local and the result is not.** Which row the pointer holds and which row it
 * is over are nothing but screen state, so they live here; where the drop leaves the order is
 * `reorderForDrop` in `sourceOrder.ts`, and writing it is `useDataSources`. This hook is the
 * join, and it holds no arithmetic of its own.
 *
 * **Nothing is previewed while the pointer moves.** The weight sliders do preview, because
 * moving one weight moves its siblings and a reader cannot otherwise tell what they are
 * about to do; a reorder is already legible from the line drawn at the gap it would land in,
 * and reshuffling the list under a held row would move the target out from under the pointer.
 */

/** Which row the pointer holds, and which row it is currently over. */
interface Gesture {
  draggedId: string;
  overId: string | null;
}

export interface SourceDrag {
  /** The row under the pointer, so it can be drawn as lifted. Null when nothing is held. */
  draggedId: string | null;
  /**
   * Which edge of this row the held row would come to rest against, or null.
   *
   * Non-null for at most one row at a time: the one the pointer is over, and only while that
   * is not the held row itself.
   */
  edgeFor: (id: string) => "above" | "below" | null;
  start: (id: string) => void;
  over: (id: string) => void;
  drop: (id: string) => void;
  end: () => void;
}

export function useSourceDrag(
  sources: readonly OrderedSource[],
  reorder: (draggedId: string, targetId: string) => void,
  /**
   * Whether a change is already in flight.
   *
   * **A drag refuses to start rather than a drop refusing to land.** A reorder writes several
   * rows one at a time, so a second gesture arriving mid-write would compute its new order
   * from a list that is partly the old one -- and the row numbers it sent would be a mix of
   * the two. Refusing at the start also means the reader never gets as far as a line drawn at
   * a gap the drop will not use.
   */
  saving: boolean,
): SourceDrag {
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const end = useCallback(() => setGesture(null), []);

  const start = useCallback(
    (id: string) => {
      if (saving) return;
      setGesture({ draggedId: id, overId: null });
    },
    [saving],
  );

  const over = useCallback((id: string) => {
    setGesture((held) =>
      held === null || held.overId === id ? held : { ...held, overId: id },
    );
  }, []);

  const drop = useCallback(
    (id: string) => {
      // **A drop with nothing held sends nothing.** Reachable: a drag that never started
      // because a save was in flight still fires a `drop` on whatever row it is released
      // over, and so does a payload dragged in from outside the page.
      if (gesture !== null) reorder(gesture.draggedId, id);
      setGesture(null);
    },
    [gesture, reorder],
  );

  return {
    draggedId: gesture?.draggedId ?? null,
    edgeFor: (id: string) => {
      if (gesture === null) return null;
      if (gesture.overId !== id) return null;
      return landingEdge(sources, gesture.draggedId, id);
    },
    start,
    over,
    drop,
    end,
  };
}

/**
 * Tell the browser the drag is a move, where there is a browser to tell.
 *
 * **Guarded because `dataTransfer` is typed as always present and is not.** jsdom implements
 * no `DataTransfer` at all, so a test firing `dragstart` would throw here and never reach the
 * gesture it meant to exercise -- the handler would be the only part of the drag the suite
 * could not run.
 *
 * The payload is set because some browsers refuse to begin a drag that advertises nothing.
 * Nothing reads it: the row being dragged is held in the gesture above, where a drop between
 * two windows cannot reach it.
 */
export function advertiseMove(
  transfer: DataTransfer | null | undefined,
  identifier: string,
): void {
  if (!transfer) return;
  transfer.effectAllowed = "move";
  transfer.setData("text/plain", identifier);
}
