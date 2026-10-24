import { useCallback, useMemo, useRef, useState } from "react";
import {
  fetchDataSources,
  updateDataSource,
} from "../../../api/endpoints";
import { useRead } from "../../../api/useRead";
import { priorityForMove, reorderForDrop } from "./sourceOrder";

/**
 * Switching a source on or off, and moving it in the order.
 *
 * **The list is re-read after every change rather than patched locally.** A move takes the
 * neighbour's priority, so two rows change and only the server knows both; and the whole point
 * of the switch is that it changes what scores, which nothing here may guess at.
 */
export function useDataSources() {
  const { read, reload } = useRead(
    useCallback((signal: AbortSignal) => fetchDataSources({ signal }), []),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // **One change at a time** (UI-07). A reorder is several writes in a row, so a second one
  // started meanwhile would be computed from a list that is partly the old one. A ref, because
  // two gestures in one tick would both pass a check on state that has not re-rendered yet.
  const inFlight = useRef(false);
  // **The list stays on screen while a change is read back** (NEW-34, PL-010): a re-read of the
  // same list keeps it, marked busy, so the switch or arrow a keyboard just pressed keeps focus.
  const sources = useMemo(
    () => (read.state === "ready" ? read.data.items : []),
    [read],
  );

  const change = useCallback(
    async (
      id: string,
      patch: { is_enabled?: boolean; default_priority?: number },
      alsoChange: readonly {
        id: string;
        default_priority: number;
      }[] = [],
    ) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSaving(id);
      setFailure(null);
      try {
        await updateDataSource(id, patch);
        for (const other of alsoChange) {
          await updateDataSource(other.id, {
            default_priority: other.default_priority,
          });
        }
      } catch (error) {
        setFailure(error);
      }
      // **Re-read even after a failure.** The writes before it are stored, so the order on
      // screen would otherwise be one the database no longer holds; the refusal stays shown.
      // **And wait for it**: until it lands, the order on screen is the one from before.
      await reload();
      inFlight.current = false;
      setSaving(null);
    },
    [reload],
  );

  return {
    read,
    reload,
    /** The last change's refusal. The list's own read failing is the read's to say. */
    failure,
    sources,
    /** The source a change is being made to, until the list has been read back after it. */
    saving,
    setEnabled: (id: string, isEnabled: boolean) =>
      void change(id, { is_enabled: isEnabled }),
    /** Null where there is no neighbour to swap with, which is what disables the button. */
    moveTo: (id: string, direction: "up" | "down") =>
      priorityForMove(sources, id, direction),
    move: (id: string, direction: "up" | "down") => {
      const swap = priorityForMove(sources, id, direction);
      if (swap === null) return;
      // **Both halves, in order.** A move is an exchange of two numbers, and writing only one
      // of them leaves the pair level rather than reordered.
      void change(id, { default_priority: swap.priority }, [
        { id: swap.neighbourId, default_priority: swap.neighbourPriority },
      ]);
    },
    /**
     * A source dropped onto another's row, which is a splice rather than a swap.
     *
     * **Every change is the same `PATCH` the arrows send**, one per row whose number moves.
     * There is no batch reorder in the contract and this does not invent one.
     *
     * **A drop that changes no number sends nothing**, which is what a drop where the row
     * already was comes to. A request writing the number already stored would still be a
     * request: it would flash the row as saving and re-read the whole list to show the order
     * that was already on screen.
     */
    reorder: (draggedId: string, targetId: string) => {
      const [first, ...rest] = reorderForDrop(sources, draggedId, targetId);
      if (first === undefined) return;
      void change(first.id, { default_priority: first.default_priority }, rest);
    },
  };
}
