import { useCallback, useEffect, useRef, useState } from "react";
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
   * For an unconfirmed change whose request is still running: settles as it does, and the
   * history then resolves the change by itself (PL-033).
   */
  settles?: Promise<unknown>;
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
   *
   * **A write to a set waits, too, while a change to that set is unconfirmed** (PL-033): changed
   * again meanwhile, what the set holds could no longer say whether the earlier change ever
   * landed, and resolving it would rewrite the history the undo depends on.
   */
  begin: (criteriaSetId?: string) => (() => void) | null;
  /** Whether a write to this set waits for an unconfirmed change to it to be checked. */
  waitsFor: (criteriaSetId: string) => boolean;
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
  // The changes as last rendered, for what is decided outside a render: a write about to be
  // sent, and an unconfirmed change resolved when its request settles.
  const recorded = useRef<RecordedChange[]>([]);
  // Every id the history has rendered, so a settlement heard before its change is rendered is
  // kept for when it is, and one about a change since removed is let go.
  const rendered = useRef(new Set<number>());
  // Unconfirmed changes whose request has settled, resolved as soon as nothing is in flight.
  const settledMeanwhile = useRef(new Set<number>());
  const checkRef = useRef<(change: RecordedChange, quietly: boolean) => Promise<void>>(
    () => Promise.resolve(),
  );
  const resolveSettled = useCallback(() => {
    if (inFlight.current) return;
    for (const id of settledMeanwhile.current) {
      const change = recorded.current.find((each) => each.id === id);
      // **Not rendered yet, it waits for its render** (PL-033): a request can settle before the
      // change it resolves is in the history, and that settlement must not be lost.
      if (change === undefined && !rendered.current.has(id)) continue;
      settledMeanwhile.current.delete(id);
      if (change?.unconfirmed !== undefined) {
        void checkRef.current(change, true);
        return;
      }
    }
  }, []);
  useEffect(() => {
    recorded.current = changes;
    for (const { id } of changes) rendered.current.add(id);
    resolveSettled();
  }, [changes, resolveSettled]);

  const note = useCallback(
    (entry: Omit<RecordedChange, "id" | "at">) => {
      const id = nextId.current++;
      setChanges(
        (history) => record(history, { ...entry, id, at: new Date() }) as RecordedChange[],
      );
      // **Its own settlement resolves it** (PL-033): answered, refused or lost, the change is
      // checked as soon as the request is done, rather than waiting for Check again.
      const settledNow = () => {
        settledMeanwhile.current.add(id);
        resolveSettled();
      };
      entry.settles?.then(settledNow, settledNow);
    },
    [resolveSettled],
  );

  const begin = useCallback(
    (criteriaSetId?: string) => {
      if (inFlight.current) return null;
      if (criteriaSetId !== undefined && unconfirmedIn(recorded.current, criteriaSetId)) {
        return null;
      }
      inFlight.current = true;
      setWriting(true);
      let given = false;
      return () => {
        if (given) return;
        given = true;
        inFlight.current = false;
        setWriting(false);
        resolveSettled();
      };
    },
    [resolveSettled],
  );

  const check = useCallback(
    async (change: RecordedChange, quietly: boolean) => {
      const readBack = change.unconfirmed;
      if (inFlight.current || readBack === undefined) return;
      inFlight.current = true;
      setWriting(true);
      if (!quietly) setFailure(null);
      try {
        const tookEffect = await readBack();
        setChanges((history) =>
          tookEffect
            ? history.map((each) => (each.id === change.id ? confirmed(each) : each))
            : history.filter((each) => each.id !== change.id),
        );
      } catch (error) {
        // Still unknown. Said when somebody asked; resolved by itself, it waits for Check again.
        if (!quietly) setFailure(error);
      } finally {
        inFlight.current = false;
        setWriting(false);
        resolveSettled();
      }
    },
    [resolveSettled],
  );
  useEffect(() => {
    checkRef.current = check;
  }, [check]);

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
      resolveSettled();
    }
  }, [resolveSettled]);

  return {
    changes,
    note,
    begin,
    waitsFor: (criteriaSetId) => unconfirmedIn(changes, criteriaSetId),
    writing,
    busy: writing || undoing,
    undoThrough: (id) => void undo(reachOf(changes, id) as RecordedChange[]),
    confirm: (id) => {
      const change = changes.find((each) => each.id === id);
      if (change !== undefined) void check(change, false);
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
  delete copy.settles;
  return copy;
}

/** Whether a change to this set is listed unconfirmed. */
function unconfirmedIn(changes: readonly RecordedChange[], criteriaSetId: string): boolean {
  return changes.some(
    (change) =>
      change.unconfirmed !== undefined && change.undoes?.criteriaSetId === criteriaSetId,
  );
}
