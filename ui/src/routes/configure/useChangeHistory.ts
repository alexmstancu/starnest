import { useCallback, useRef, useState } from "react";
import { type Change, reachOf, record, without } from "./changeHistory";

/**
 * How a change gets undone: by making the opposite request, never by restoring local state.
 *
 * An undo that only put a number back on screen would disagree with the server the moment
 * anything else read it, and a configuration screen that lies about what is stored is worse
 * than one with no undo at all. So each recorded change carries the call that would reverse
 * it, and undoing runs that call.
 */
export type Reverse = (before: unknown) => Promise<void> | void;

export interface RecordedChange extends Change {
  reverse: Reverse;
}

export interface ChangeHistory {
  changes: RecordedChange[];
  /** Note a change that has already been made, with the call that would undo it. */
  note: (
    entry: Omit<RecordedChange, "id">,
  ) => void;
  /** Undo this change and every change made after it. */
  undoThrough: (id: number) => void;
  /** Undo everything this session did, oldest last. */
  reset: () => void;
  undoing: boolean;
  failure: unknown;
}

export function useChangeHistory(): ChangeHistory {
  const [changes, setChanges] = useState<RecordedChange[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  // A ref, not state: an id must be unique across renders and never re-used, and nothing on
  // screen depends on its value.
  const nextId = useRef(1);

  const note = useCallback((entry: Omit<RecordedChange, "id">) => {
    setChanges((history) =>
      record(history, { ...entry, id: nextId.current++ }) as RecordedChange[],
    );
  }, []);

  const undo = useCallback(async (reach: RecordedChange[]) => {
    setUndoing(true);
    setFailure(null);
    try {
      // **Newest first.** The changes are reversed in the order that returns the
      // configuration through the states it actually passed through; going the other way
      // would write an older value and then a newer one over it.
      for (const change of reach) {
        await change.reverse(change.before);
      }
      setChanges((history) => without(history, reach) as RecordedChange[]);
    } catch (error) {
      // Whatever was undone stays undone and stays listed: the history must keep matching
      // what the server holds, and a half-finished undo is a real state.
      setFailure(error);
    } finally {
      setUndoing(false);
    }
  }, []);

  return {
    changes,
    note,
    undoThrough: (id) => void undo(reachOf(changes, id) as RecordedChange[]),
    reset: () => void undo([...changes]),
    undoing,
    failure,
  };
}
