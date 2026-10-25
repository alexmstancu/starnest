import { useCallback, useRef, useState } from "react";
import {
  type Change,
  type Write,
  conflicts,
  mustWait,
  reachOf,
  record,
  without,
} from "./changeHistory";

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
  /**
   * Note a change that has already been made, with the call that would undo it.
   *
   * **The id and the time are stamped here, not passed in.** Both are facts about the
   * recording rather than decisions of the caller, and a caller that could supply its own
   * would be able to record a change as having happened at a moment it did not. A change sent
   * through `begin` takes the id its write was given then, which is its place in the order.
   */
  note: (entry: Omit<RecordedChange, "id" | "at">, write?: Write) => void;
  /**
   * **Every set write goes through here** (PL-033): it takes its place in the order as it is
   * sent, or null when it must wait -- while an undo runs, or while a write it does not commute
   * with is in flight (`conflicts`). End it once it has answered, whichever way.
   */
  begin: (criteriaSetId: string, reshapes?: boolean) => Write | null;
  end: (write: Write) => void;
  /** Whether `begin` would refuse now, so a control can be held rather than ignore a press. */
  waits: (criteriaSetId: string, reshapes?: boolean) => boolean;
  /** The writes sent and not yet answered. */
  writes: readonly Write[];
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
  // **One undo at a time** (NEW-34). The buttons are held rather than disabled while one runs,
  // so they still take a press; a ref, because two can arrive before the first has re-rendered,
  // and the second would reverse what the first is already reversing.
  const inFlight = useRef(false);
  // A ref for the refusal, as above, and state for the holds drawn from it.
  const sent = useRef<Write[]>([]);
  const [writes, setWrites] = useState<readonly Write[]>([]);

  const note = useCallback(
    (entry: Omit<RecordedChange, "id" | "at">, write?: Write) => {
      const id = write?.id ?? nextId.current++;
      setChanges(
        (history) => record(history, { ...entry, id, at: new Date() }) as RecordedChange[],
      );
    },
    [],
  );

  const begin = useCallback((criteriaSetId: string, reshapes = false) => {
    if (inFlight.current) return null;
    if (sent.current.some((write) => conflicts(write, criteriaSetId, reshapes))) return null;
    const write = { id: nextId.current++, criteriaSetId, reshapes };
    sent.current = [...sent.current, write];
    setWrites(sent.current);
    return write;
  }, []);

  const end = useCallback((write: Write) => {
    sent.current = sent.current.filter((each) => each !== write);
    setWrites(sent.current);
  }, []);

  const undo = useCallback(async (reach: RecordedChange[]) => {
    if (inFlight.current || mustWait(reach, sent.current)) return;
    inFlight.current = true;
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
      inFlight.current = false;
      setUndoing(false);
    }
  }, []);

  return {
    changes,
    note,
    begin,
    end,
    waits: (criteriaSetId, reshapes = false) =>
      undoing || writes.some((write) => conflicts(write, criteriaSetId, reshapes)),
    writes,
    undoThrough: (id) => void undo(reachOf(changes, id) as RecordedChange[]),
    reset: () => void undo([...changes]),
    undoing,
    failure,
  };
}
