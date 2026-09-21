import { useCallback, useState } from "react";
import { fetchDataSources, updateDataSource } from "../../../api/endpoints";
import { useResource } from "../../../api/useResource";
import { priorityForMove } from "./sourceOrder";

/**
 * Switching a source on or off, and moving it in the order.
 *
 * **The list is re-read after every change rather than patched locally.** A move takes the
 * neighbour's priority, so two rows change and only the server knows both; and the whole point
 * of the switch is that it changes what scores, which nothing here may guess at.
 */
export function useDataSources() {
  const { resource, reload } = useResource(
    useCallback((signal: AbortSignal) => fetchDataSources({ signal }), []),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const sources = resource.status === "ready" ? resource.data.items : [];

  const change = useCallback(
    async (
      id: string,
      patch: { is_enabled?: boolean; default_priority?: number },
      alsoChange: readonly {
        id: string;
        default_priority: number;
      }[] = [],
    ) => {
      setSaving(id);
      setFailure(null);
      try {
        await updateDataSource(id, patch);
        for (const other of alsoChange) {
          await updateDataSource(other.id, {
            default_priority: other.default_priority,
          });
        }
        reload();
      } catch (error) {
        setFailure(error);
      } finally {
        setSaving(null);
      }
    },
    [reload],
  );

  return {
    status: resource.status,
    error: resource.status === "error" ? resource.error : failure,
    reload,
    sources,
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
  };
}
