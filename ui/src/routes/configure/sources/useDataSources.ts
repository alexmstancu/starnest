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
import {
  pendingEntry,
  settled,
  settledUndo,
  UnconfirmedWrite,
  type ReadBack,
} from "../unknownOutcome";

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

  // **A change nobody can confirm holds the next** (P103): changed again meanwhile, the list could
  // no longer say whether the first ever landed. Read from the history, so it holds whichever
  // screen is mounted when it is checked.
  const unconfirmed = history.changes.some(
    (each) => each.stage === SOURCES_STAGE && each.unconfirmed !== undefined,
  );

  /**
   * **One change at a time, and Configure's one write in flight** (UI-07, PL-138): a gesture
   * started while another is written would be computed from the order before it. Recorded in
   * Recent changes with the request that reverses it, as every other Configure write is.
   *
   * **An answer lost on the way is read back** (P103), as every other Configure write's is: what
   * took effect is noted as any change, and what nobody can yet say is noted unconfirmed, with
   * Check again -- never reported as refused, which would leave a change that did happen with no
   * entry and no undo. Its undo reads back the same way.
   */
  const change = useCallback(
    async (id: string, entry: SourceChange) => {
      if (unconfirmed) return;
      const done = history.begin();
      if (done === null) return;
      setSaving(id);
      setFailure(null);
      // **Every sources panel reads again when a change lands** (PL-138), this one's included: a
      // write answered after its screen was left would otherwise leave the panel shown since then
      // on the order before it, and the next move would be computed from that order (P102).
      const shown = () => {
        noteRankingInputsChanged();
        noteSourcesChanged();
      };
      const recorded = {
        target: entry.target,
        setting: entry.setting,
        describe: entry.describe,
        before: entry.before,
        after: entry.after,
        stage: SOURCES_STAGE,
        reverse: (back: unknown) =>
          settledUndo(() => entry.send(back), entry.readBack(back), shown),
      };
      try {
        await settled(() => entry.send(entry.after), entry.readBack(entry.after));
        shown();
        history.note(recorded);
      } catch (error) {
        if (error instanceof UnconfirmedWrite) {
          history.note({ ...recorded, ...pendingEntry(error, shown) });
        } else setFailure(error);
      }
      // **Re-read even after a failure**, so the order on screen is the one the server last
      // answered, and the refusal stays shown beside it. **And wait for it**: until it lands,
      // the order on screen is the one from before.
      await reload();
      done();
      setSaving(null);
    },
    [history, reload, noteSourcesChanged, unconfirmed],
  );

  const reorder = (id: string, order: string[] | null) => {
    if (order === null) return;
    const before = inPriorityOrder(sources).map((source) => source.id);
    const name = sources.find((source) => source.id === id)?.name ?? id;
    void change(id, {
      target: `source-order:${id}`,
      // Every move rewrites the whole order, so the order is one setting (PL-140).
      setting: "source-order",
      describe: ({ before: from, after: to }) =>
        `Moved ${name} from position ${String((from as string[]).indexOf(id) + 1)} to ${String((to as string[]).indexOf(id) + 1)}`,
      before,
      after: order,
      send: (wanted) => reorderDataSources(wanted as string[]).then(() => true as const),
      readBack: (wanted) => async (signal) => {
        const stored = inPriorityOrder((await fetchDataSources({ signal })).items);
        return sameOrder(
          stored.map((source) => source.id),
          wanted as string[],
        )
          ? true
          : null;
      },
    });
  };

  const setEnabled = (id: string, isEnabled: boolean) => {
    const name = sources.find((source) => source.id === id)?.name ?? id;
    void change(id, {
      target: `source-enabled:${id}`,
      describe: ({ after: to }) => `${to === true ? "Switched on" : "Switched off"} ${name}`,
      before: !isEnabled,
      after: isEnabled,
      send: (wanted) =>
        updateDataSource(id, { is_enabled: wanted === true }).then(() => true as const),
      readBack: (wanted) => async (signal) => {
        const stored = (await fetchDataSources({ signal })).items.find(
          (source) => source.id === id,
        );
        return stored?.is_enabled === (wanted === true) ? true : null;
      },
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
    /**
     * Whether a press is refused now: this stage's change, any other Configure write, or a change
     * to the sources nobody has confirmed yet.
     */
    held: saving !== null || history.busy || unconfirmed,
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

/**
 * A change to the sources, as `change` is given it: what it was and is, how either is sent --
 * forward with `after`, back with `before` -- and how the list says one of them is stored.
 */
interface SourceChange {
  target: string;
  setting?: string;
  describe: (parts: LabelParts) => string;
  before: unknown;
  after: unknown;
  send: (wanted: unknown) => Promise<true>;
  readBack: (wanted: unknown) => ReadBack<true>;
}

/** Whether two orders of the sources are the same, place for place. */
function sameOrder(stored: readonly string[], wanted: readonly string[]): boolean {
  return stored.length === wanted.length && stored.every((id, place) => id === wanted[place]);
}
