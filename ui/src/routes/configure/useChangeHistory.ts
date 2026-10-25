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
  /**
   * Present while it is unknown whether the change took effect (PL-033): its answer was lost and
   * reading it back could not say. Reads back again -- true when it did, false when it did not.
   * Nothing is undone through it until it is confirmed.
   */
  unconfirmed?: () => Promise<boolean>;
}

export interface ChangeHistory {
  changes: RecordedChange[];
  /**
   * Note a change that has already been made, with the call that would undo it.
   *
   * **The id and the time are stamped here, not passed in.** Both are facts about the
   * recording rather than decisions of the caller, and a caller that could supply its own
   * would be able to record a change as having happened at a moment it did not.
   */
  note: (entry: Omit<RecordedChange, "id" | "at">) => void;
  /**
   * **Configure writes one thing at a time** (PL-033): a set verb, a pillar's or a criterion's
   * write, or an undo. `begin` takes the one place in flight and answers the call that gives it
   * back once the write has answered, whichever way -- or null while anything else holds it.
   * So the order writes are sent in, the order they commit in, and the history's order are one.
   */
  begin: () => (() => void) | null;
  /** A write is in flight. */
  writing: boolean;
  /** A write or an undo is in flight, so every other one is held until it answers. */
  busy: boolean;
  /** Undo this change and every change made after it. */
  undoThrough: (id: number) => void;
  /**
   * Read back an unconfirmed change, as Configure's one write in flight: confirmed, it stays
   * listed as any other; found not to have taken effect, it leaves the list.
   */
  confirm: (id: number) => void;
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
  // **One write or undo at a time** (NEW-34, PL-033). The buttons are held rather than disabled
  // while one runs, so they still take a press; a ref, because two can arrive before the first
  // has re-rendered, and the second would be sent beside it.
  const inFlight = useRef(false);
  const [writing, setWriting] = useState(false);

  const note = useCallback((entry: Omit<RecordedChange, "id" | "at">) => {
    setChanges(
      (history) =>
        record(history, { ...entry, id: nextId.current++, at: new Date() }) as RecordedChange[],
    );
  }, []);

  const begin = useCallback(() => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setWriting(true);
    let given = false;
    return () => {
      if (given) return;
      given = true;
      inFlight.current = false;
      setWriting(false);
    };
  }, []);

  const check = useCallback(async (change: RecordedChange) => {
    const readBack = change.unconfirmed;
    if (inFlight.current || readBack === undefined) return;
    inFlight.current = true;
    setWriting(true);
    setFailure(null);
    try {
      const tookEffect = await readBack();
      setChanges((history) =>
        tookEffect
          ? history.map((each) => (each.id === change.id ? confirmed(each) : each))
          : history.filter((each) => each.id !== change.id),
      );
    } catch (error) {
      setFailure(error);
    } finally {
      inFlight.current = false;
      setWriting(false);
    }
  }, []);

  const undo = useCallback(async (reach: RecordedChange[]) => {
    // Nothing is undone through a change nobody knows took effect.
    if (inFlight.current || reach.some((change) => change.unconfirmed)) return;
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
    writing,
    busy: writing || undoing,
    undoThrough: (id) => void undo(reachOf(changes, id) as RecordedChange[]),
    confirm: (id) => {
      const change = changes.find((each) => each.id === id);
      if (change !== undefined) void check(change);
    },
    reset: () => void undo([...changes]),
    undoing,
    failure,
  };
}

/** The change, no longer awaiting confirmation. */
function confirmed(change: RecordedChange): RecordedChange {
  const copy = { ...change };
  delete copy.unconfirmed;
  return copy;
}
