/**
 * What the criteria-set stage does: make one, use one, rename one, copy one, discard one
 * (`reqs.md` 3.4).
 *
 * **A new set is a copy of the default**, which the API decides (PL-034). Deleting a set does
 * not touch a saved evaluation, which froze its own copy of the criteria (`reqs.md` Q193), and
 * the server keeps the set restorable (PL-033, PL-035).
 *
 * **The one writer of sets, at screen level** (D-C03-9, G5). It is the only module that sends a
 * set verb, and each verb it sends is noted in Recent changes with the request that reverses it:
 * Created (undo deletes it, restorably), Renamed (undo renames back), Duplicated (undo deletes
 * the copy) and Deleted (undo restores it, and puts it back in use if it was and nobody has
 * chosen another set since). Choosing a set is not a stored change, so it is not noted.
 *
 * **One name, not a name and an identifier.** The design asks for what the set is called and
 * derives the rest (`setIdentifier.ts`); the server still refuses a collision, so nothing is
 * guessed around.
 */

import { useEffect, useState } from "react";
import { ApiError, CLIENT_ERROR_CODES, isApiError } from "../../../api/ApiError";
import {
  createCriteriaSet,
  deleteCriteriaSet,
  duplicateCriteriaSet,
  fetchCriteriaSet,
  renameCriteriaSet,
  restoreCriteriaSet,
  type CriteriaSet,
} from "../../../api/endpoints";
import type { Selection } from "../../../shell/SelectionContext";
import {
  pendingEntry,
  READ_PATIENCE_MS,
  type ReadBack,
  settled,
  UnconfirmedWrite,
} from "../unknownOutcome";
import type { ChangeHistory, RecordedChange } from "../useChangeHistory";
import { copyName, identifierFrom, ownIdentifier } from "./setIdentifier";

/** A set verb's entry in Recent changes, before the history stamps it. */
type SetEntry = Omit<RecordedChange, "id" | "at">;

/** Where Recent changes says a set verb was made. */
const STAGE = "Criteria set";

export interface CriteriaSetsForm {
  newName: string;
  /** Which set's name is being edited in place, or null while none is. */
  renaming: string | null;
  renameDraft: string;
  failure: unknown;
  /**
   * A set action is in flight, or an undo is, so every set action is held until it answers
   * (PL-037, PL-033): one sent meanwhile could be noted for a set the undo is taking away.
   */
  busy: boolean;
  /** Why the name typed cannot make a set, or null when it can. */
  createRefusal: string | null;
  /** A press of Create set was refused, so the reason is said rather than only implied. */
  createRefused: boolean;
  canSaveRename: boolean;
  typeNewName: (value: string) => void;
  typeRenameDraft: (value: string) => void;
  beginRename: (criteriaSetId: string, currentName: string) => void;
  cancelRename: () => void;
  /** Resolves once the rename has answered, whichever way. */
  saveRename: () => Promise<void>;
  create: () => Promise<void>;
  duplicate: (criteriaSetId: string, currentName: string) => Promise<void>;
  /** Resolves true once the set is gone, false when it was refused or not sent. */
  discard: (criteriaSetId: string) => Promise<boolean>;
  /** The list has yet to show the last set action, so every set action and undo waits. */
  listPending: boolean;
  /** The list failed to be read again after a set action, so every set action waits. */
  listFailure: unknown;
  retryList: () => void;
  /** Whether the list, once it shows every set action, no longer has this set. */
  isDeleted: (criteriaSetId: string) => boolean;
  /**
   * Whether this set's verbs are held: while anything is, or while a change to the set is
   * unconfirmed and has to be checked first (PL-033).
   */
  heldFor: (criteriaSetId: string) => boolean;
}

export function useCriteriaSets(options: {
  selection: Selection;
  history: ChangeHistory;
}): CriteriaSetsForm {
  const { selection, history } = options;
  const names = selection.criteriaSets.map((set) => set.name);
  const nameOf = (criteriaSetId: string) =>
    selection.criteriaSets.find((set) => set.id === criteriaSetId)?.name ?? criteriaSetId;

  // **Every set action waits for the list to show what it did** (PL-033), its undo included: a
  // row the list has yet to take away, or to bring back, still takes a press. Read from the
  // list itself rather than from the request, so a refresh that failed keeps the wait and offers
  // Try again instead of releasing it onto stale rows.
  const lists = selection.read;
  const listSettled = lists.state === "ready" && lists.refresh === "idle";
  // **A read that never comes back is a failure too** (PL-033), once it has been waited for as
  // long as a reader would: otherwise the wait holds every set action and undo for ever, with
  // nothing to press. Keyed on the data being read again and on each Try again, so a refresh
  // that is retried and hangs again is waited for afresh rather than for ever.
  const runningSince = lists.state === "ready" && lists.refresh === "running" ? lists.readAt : null;
  const [listAttempt, setListAttempt] = useState(0);
  const [overdueFor, setOverdueFor] = useState<{ since: Date; attempt: number } | null>(null);
  useEffect(() => {
    if (runningSince === null) return undefined;
    const timer = setTimeout(
      () => setOverdueFor({ since: runningSince, attempt: listAttempt }),
      READ_PATIENCE_MS,
    );
    return () => clearTimeout(timer);
  }, [runningSince, listAttempt]);
  const overdue =
    runningSince !== null &&
    overdueFor?.since === runningSince &&
    overdueFor.attempt === listAttempt;
  const listFailure =
    lists.state === "ready" && typeof lists.refresh === "object"
      ? lists.refresh.failed
      : overdue
        ? LIST_NEVER_CAME_BACK
        : null;

  /** Deleting restorably, which is also how a created set or a copy is undone. */
  const deleteAndReread = async (criteriaSetId: string) => {
    await settled(
      () => deleteCriteriaSet(criteriaSetId).then(() => true as const),
      async (signal) => ((await setNow(criteriaSetId, signal)) === null ? true : null),
    );
    selection.reload();
  };
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // **A rename ends with its set** (PL-033): an undo or another tab can take the set away with
  // the field open, and a field kept open in state would reopen if the set came back. Adjusted
  // while rendering, as React advises for state that follows a prop.
  if (renaming !== null && !selection.criteriaSets.some((set) => set.id === renaming)) {
    setRenaming(null);
    setRenameDraft("");
  }
  const [failure, setFailure] = useState<unknown>(null);
  const [createRefused, setCreateRefused] = useState(false);
  const createRefusal = refusalOf(newName, names);
  const held = history.busy || !listSettled;

  /**
   * Sends a set verb and notes `entry`: true once the list shows it, false when it was refused or
   * not sent. **It is Configure's one write in flight** (PL-037, PL-033) until it has answered, so
   * no other write, undo or set action is sent beside it; the list read after it holds only the
   * set actions and the undo, and a read that fails or never answers offers Try again.
   *
   * **An answer lost on the way is read back** (`settled`): what took effect is noted as any
   * other change, and what nobody can yet say is noted unconfirmed, with Check again -- never
   * dropped, so a deletion that did happen always keeps its restore.
   */
  async function act<Answer>(
    /** The set the verb changes, held while a change to it is unconfirmed; none for a new one. */
    criteriaSetId: string | undefined,
    send: () => Promise<Answer>,
    readBack: ReadBack<Answer>,
    /** Its entry; `confirmed` false when it is listed unconfirmed, and so on its own. */
    entry: (confirmed: boolean) => SetEntry,
    landed: (answer: Answer) => void = () => undefined,
  ): Promise<boolean> {
    if (!listSettled) return false;
    const done = history.begin(criteriaSetId);
    if (done === null) return false;
    setFailure(null);
    try {
      landed(await settled(send, readBack));
      history.note(entry(true));
    } catch (error) {
      if (!(error instanceof UnconfirmedWrite)) {
        setFailure(error);
        return false;
      }
      // Confirmed later, the list is read again so the rows show what the server holds.
      history.note({ ...entry(false), ...pendingEntry(error, () => selection.reload()) });
    } finally {
      done();
    }
    await selection.reloadAndWait();
    return true;
  }

  return {
    newName,
    renaming,
    renameDraft,
    failure,
    busy: held,
    createRefusal,
    createRefused,
    canSaveRename: renameDraft.trim() !== "",
    typeNewName: (value) => {
      setNewName(value);
      setCreateRefused(false);
    },
    typeRenameDraft: setRenameDraft,
    beginRename: (criteriaSetId, currentName) => {
      setRenaming(criteriaSetId);
      setRenameDraft(currentName);
    },
    cancelRename: () => {
      setRenaming(null);
      setRenameDraft("");
    },
    saveRename: async () => {
      const target = renaming;
      if (target === null || renameDraft.trim() === "") return;
      const name = renameDraft.trim();
      const was = nameOf(target);
      const targetKey = `criteria-set:${target}:renamed`;
      // A run of renames is one entry, so it reads from the name the run started from. Never
      // from an unconfirmed one: a rename waits while one to its set is (PL-033).
      const latest = history.changes[0];
      const first =
        latest?.target === targetKey ? (latest.before as { name: string }).name : was;
      const renamedTo = (wanted: string) => async (signal: AbortSignal) =>
        (await setNow(target, signal))?.name === wanted ? { name: wanted } : null;
      const sent = await act(
        target,
        () => renameCriteriaSet(target, name),
        renamedTo(name),
        (confirmed) => ({
          target: targetKey,
          stage: STAGE,
          label: `Renamed ${confirmed ? first : was} to ${name}`,
          before: { name: was },
          after: { name },
          reverse: async (before) => {
            const back = (before as { name: string }).name;
            await settled(() => renameCriteriaSet(target, back), renamedTo(back));
            selection.reload();
          },
          undoes: { criteriaSetId: target, by: "write" },
        }),
      );
      if (sent) {
        setRenaming(null);
        setRenameDraft("");
      }
    },
    // **Refused here as well as held on screen** (UIC-G1): Enter in the field submits whatever
    // the button looks like, now that it is held rather than disabled.
    create: async () => {
      if (createRefusal !== null) {
        setCreateRefused(true);
        return;
      }
      const name = newName.trim();
      // **An identifier this tab chose** (PL-033), so a set read back under it is provably this
      // tab's: another tab making a set of the same name gets one of its own.
      const id = ownIdentifier(name);
      await act(
        undefined,
        () => createCriteriaSet(id, name),
        (signal) => setNow(id, signal),
        () => ({
          target: `criteria-set:${id}:created`,
          stage: STAGE,
          label: `Created ${name}`,
          before: { exists: false },
          after: { exists: true },
          reverse: () => deleteAndReread(id),
          undoes: { criteriaSetId: id, by: "delete" },
        }),
        () => {
          setNewName("");
          selection.selectCriteriaSet(id);
        },
      );
    },
    // The copy is selected, because duplicating is how an experiment starts and the next
    // edit belongs to the copy rather than to what it was copied from.
    duplicate: async (criteriaSetId, currentName) => {
      const name = copyName(currentName, names);
      const id = ownIdentifier(name);
      // A copy of a set with an unconfirmed change would copy what nobody knows it holds.
      await act(
        criteriaSetId,
        () => duplicateCriteriaSet(criteriaSetId, id, name),
        (signal) => setNow(id, signal),
        () => ({
          target: `criteria-set:${id}:duplicated`,
          stage: STAGE,
          label: `Duplicated ${currentName} as ${name}`,
          before: { exists: false },
          after: { exists: true },
          reverse: () => deleteAndReread(id),
          undoes: { criteriaSetId: id, by: "delete" },
        }),
        () => selection.selectCriteriaSet(id),
      );
    },
    // **The set in use falls back to the first other set**, which `SelectionContext` adopts
    // once the refreshed list lacks it (P44); it is worked out here too, so the undo knows where
    // the deletion left the selection. The name is captured now: a deleted set is in no list
    // to read it from later.
    discard: (criteriaSetId) => {
      const name = nameOf(criteriaSetId);
      const wasInUse = selection.criteriaSetId === criteriaSetId;
      const fallback = wasInUse
        ? (selection.criteriaSets.find((set) => set.id !== criteriaSetId)?.id ?? null)
        : null;
      // **A deletion whose answer was lost is read back** (PL-033): one that took effect is
      // listed with its restore, and one nobody can yet confirm is listed unconfirmed -- the
      // server keeps the deleted set (0508), so the restore is always there to be had.
      return act(
        criteriaSetId,
        () => deleteCriteriaSet(criteriaSetId).then(() => true as const),
        async (signal) => ((await setNow(criteriaSetId, signal)) === null ? true : null),
        () => ({
          target: `criteria-set:${criteriaSetId}:deleted`,
          stage: STAGE,
          label: `Deleted ${name}`,
          before: { deleted: false, wasInUse },
          after: { deleted: true },
          reverse: async () => {
            await settled(
              () => restoreCriteriaSet(criteriaSetId),
              (signal) => setNow(criteriaSetId, signal),
            );
            // Back in use only if the selection is still where the deletion left it, asked of
            // the selection itself: the restore may answer after Configure has gone.
            if (wasInUse) selection.selectCriteriaSetIf(fallback, criteriaSetId);
            selection.reload();
          },
          undoes: { criteriaSetId, by: "restore" },
        }),
      );
    },
    listPending: !listSettled,
    listFailure,
    retryList: () => {
      setListAttempt((attempt) => attempt + 1);
      selection.reload();
    },
    heldFor: (criteriaSetId) => held || history.waitsFor(criteriaSetId),
    isDeleted: (criteriaSetId) =>
      listSettled && !selection.criteriaSets.some((set) => set.id === criteriaSetId),
  };
}

const LIST_NEVER_CAME_BACK = new ApiError({
  code: CLIENT_ERROR_CODES.unreachable,
  message: "The list of criteria sets was asked for again and did not come back.",
});

/** A set as the server holds it now, or null when it holds no live set by that id. */
async function setNow(criteriaSetId: string, signal: AbortSignal): Promise<CriteriaSet | null> {
  try {
    return await fetchCriteriaSet(criteriaSetId, { signal });
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

/**
 * Why a name cannot make a set, said before anything is sent. A presentational guard: the server
 * still refuses an identifier something already holds.
 */
function refusalOf(name: string, taken: readonly string[]): string | null {
  if (identifierFrom(name) === "") return "Give the new set a name first.";
  const wanted = name.trim().toLowerCase();
  const clash = taken.find((each) => each.trim().toLowerCase() === wanted);
  return clash === undefined ? null : `A set called ${clash} already exists.`;
}
