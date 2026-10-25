import { useCallback, useMemo, useState } from "react";
import {
  fetchDataSources,
  reorderDataSources,
  updateDataSource,
} from "../../../api/endpoints";
import { useRead } from "../../../api/useRead";
import type { LabelParts } from "../changeHistory";
import { useConfigurationSession } from "../useConfigurationSession";
import { inPriorityOrder, orderAfterDrop, orderAfterMove } from "./sourceOrder";
import { noteRankingInputsChanged } from "../../../api/rankingInputs";

/**
 * Switching a source on or off, and moving it in the order.
 *
 * **The list is re-read after every change rather than patched locally.** A move hands every
 * stored priority back out (D36), so only the server knows the numbers it ends with; and the
 * whole point of the switch is that it changes what scores, which nothing here may guess at.
 */
export function useDataSources() {
  const { history, sourcesVersion, noteSourcesChanged } = useConfigurationSession();
  // Read again whenever a write to the sources lands, an undo's included (PL-138).
  const { read, reload } = useRead(
    useCallback((signal: AbortSignal) => fetchDataSources({ signal }), []),
    { freshness: sourcesVersion },
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // **The list stays on screen while a change is read back** (NEW-34, PL-010): a re-read of the
  // same list keeps it, marked busy, so the switch or arrow a keyboard just pressed keeps focus.
  const sources = useMemo(
    () => (read.state === "ready" ? read.data.items : []),
    [read],
  );

  /**
   * **One change at a time, and Configure's one write in flight** (UI-07, PL-138): a gesture
   * started while another is written would be computed from the order before it. Recorded in
   * Recent changes with the request that reverses it, as every other Configure write is.
   */
  const change = useCallback(
    async (id: string, write: () => Promise<unknown>, entry: SourceChange) => {
      const done = history.begin();
      if (done === null) return;
      setSaving(id);
      setFailure(null);
      try {
        await write();
        noteRankingInputsChanged();
        history.note({
          ...entry,
          stage: SOURCES_STAGE,
          reverse: async (back) => {
            await entry.reverse(back);
            noteRankingInputsChanged();
            noteSourcesChanged();
          },
        });
      } catch (error) {
        setFailure(error);
      }
      // **Re-read even after a failure**, so the order on screen is the one the server last
      // answered, and the refusal stays shown beside it. **And wait for it**: until it lands,
      // the order on screen is the one from before.
      await reload();
      done();
      setSaving(null);
    },
    [history, reload, noteSourcesChanged],
  );

  const reorder = (id: string, order: string[] | null) => {
    if (order === null) return;
    const before = inPriorityOrder(sources).map((source) => source.id);
    const name = sources.find((source) => source.id === id)?.name ?? id;
    void change(id, () => reorderDataSources(order), {
      target: `source-order:${id}`,
      // Every move rewrites the whole order, so the order is one setting (PL-140).
      setting: "source-order",
      describe: ({ before: from, after: to }) =>
        `Moved ${name} from position ${String((from as string[]).indexOf(id) + 1)} to ${String((to as string[]).indexOf(id) + 1)}`,
      before,
      after: order,
      reverse: (back) => reorderDataSources(back as string[]),
    });
  };

  const setEnabled = (id: string, isEnabled: boolean) => {
    const name = sources.find((source) => source.id === id)?.name ?? id;
    void change(id, () => updateDataSource(id, { is_enabled: isEnabled }), {
      target: `source-enabled:${id}`,
      describe: ({ after: to }) => `${to === true ? "Switched on" : "Switched off"} ${name}`,
      before: !isEnabled,
      after: isEnabled,
      reverse: (back) => updateDataSource(id, { is_enabled: back === true }),
    });
  };

  return {
    read,
    reload,
    /** The last change's refusal. The list's own read failing is the read's to say. */
    failure,
    sources,
    /** The source a change is being made to, until the list has been read back after it. */
    saving,
    /** Whether a press is refused now: this stage's change, or any other Configure write. */
    held: saving !== null || history.busy,
    setEnabled,
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

/** Where a change to the sources is made, as Recent changes names it. */
const SOURCES_STAGE = "Source priority";

/** A change to the sources, as `change` is given it: what it was, is, and how it goes back. */
interface SourceChange {
  target: string;
  setting?: string;
  describe: (parts: LabelParts) => string;
  before: unknown;
  after: unknown;
  reverse: (before: unknown) => Promise<unknown>;
}
