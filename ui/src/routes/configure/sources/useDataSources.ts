import { useCallback, useMemo, useRef, useState } from "react";
import {
  fetchDataSources,
  reorderDataSources,
  updateDataSource,
} from "../../../api/endpoints";
import { useRead } from "../../../api/useRead";
import { orderAfterDrop, orderAfterMove } from "./sourceOrder";
import { noteRankingInputsChanged } from "../../../api/rankingInputs";

/**
 * Switching a source on or off, and moving it in the order.
 *
 * **The list is re-read after every change rather than patched locally.** A move hands every
 * stored priority back out (D36), so only the server knows the numbers it ends with; and the
 * whole point of the switch is that it changes what scores, which nothing here may guess at.
 */
export function useDataSources() {
  const { read, reload } = useRead(
    useCallback((signal: AbortSignal) => fetchDataSources({ signal }), []),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // **One change at a time** (UI-07). A gesture started while another is written would be
  // computed from the order before it. A ref, because two gestures in one tick would both pass
  // a check on state that has not re-rendered yet.
  const inFlight = useRef(false);
  // **The list stays on screen while a change is read back** (NEW-34, PL-010): a re-read of the
  // same list keeps it, marked busy, so the switch or arrow a keyboard just pressed keeps focus.
  const sources = useMemo(
    () => (read.state === "ready" ? read.data.items : []),
    [read],
  );

  const change = useCallback(
    async (id: string, write: () => Promise<unknown>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSaving(id);
      setFailure(null);
      try {
        await write();
        noteRankingInputsChanged();
      } catch (error) {
        setFailure(error);
      }
      // **Re-read even after a failure**, so the order on screen is the one the server last
      // answered, and the refusal stays shown beside it. **And wait for it**: until it lands,
      // the order on screen is the one from before.
      await reload();
      inFlight.current = false;
      setSaving(null);
    },
    [reload],
  );

  const reorder = (id: string, order: string[] | null) => {
    if (order !== null) void change(id, () => reorderDataSources(order));
  };

  return {
    read,
    reload,
    /** The last change's refusal. The list's own read failing is the read's to say. */
    failure,
    sources,
    /** The source a change is being made to, until the list has been read back after it. */
    saving,
    setEnabled: (id: string, isEnabled: boolean) =>
      void change(id, () => updateDataSource(id, { is_enabled: isEnabled })),
    /** Null where there is no neighbour to move past, which is what disables the button. */
    moveTo: (id: string, direction: "up" | "down") =>
      orderAfterMove(sources, id, direction),
    /** One request carrying the whole new order, so a move cannot stop half way (PL-136). */
    move: (id: string, direction: "up" | "down") =>
      reorder(id, orderAfterMove(sources, id, direction)),
    /** A source dropped onto another's row; a drop that moves nothing sends nothing. */
    reorder: (draggedId: string, targetId: string) =>
      reorder(draggedId, orderAfterDrop(sources, draggedId, targetId)),
  };
}
