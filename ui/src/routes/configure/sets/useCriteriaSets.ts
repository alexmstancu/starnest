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

import { useEffect, useRef, useState } from "react";
import {
  createCriteriaSet,
  deleteCriteriaSet,
  duplicateCriteriaSet,
  renameCriteriaSet,
  restoreCriteriaSet,
} from "../../../api/endpoints";
import type { Selection } from "../../../shell/SelectionContext";
import type { ChangeHistory } from "../useChangeHistory";
import { copyName, identifierFrom } from "./setIdentifier";

/** Where Recent changes says a set verb was made. */
const STAGE = "Criteria set";

export interface CriteriaSetsForm {
  newName: string;
  /** Which set's name is being edited in place, or null while none is. */
  renaming: string | null;
  renameDraft: string;
  failure: unknown;
  /** A set action is in flight, so every other one is held until it answers (PL-037). */
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
  /**
   * Delete is held on the set in use while a write to it is in flight (S8): answered after the
   * deletion, that write would sit above its entry and 404 before the restore could run.
   */
  deleteHeld: (criteriaSetId: string) => boolean;
}

export function useCriteriaSets(options: {
  selection: Selection;
  history: ChangeHistory;
  /** A write to the set in use is in flight: a criterion's or a pillar's. */
  writesInFlight: boolean;
}): CriteriaSetsForm {
  const { selection, history } = options;
  const names = selection.criteriaSets.map((set) => set.name);
  const nameOf = (criteriaSetId: string) =>
    selection.criteriaSets.find((set) => set.id === criteriaSetId)?.name ?? criteriaSetId;
  // What is in use when an undo runs, which is later than any render this hook has seen.
  const inUse = useRef(selection.criteriaSetId);
  useEffect(() => {
    inUse.current = selection.criteriaSetId;
  }, [selection.criteriaSetId]);

  /** Deleting restorably, which is also how a created set or a copy is undone. */
  const deleteAndReread = async (criteriaSetId: string) => {
    await deleteCriteriaSet(criteriaSetId);
    selection.reload();
  };
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [createRefused, setCreateRefused] = useState(false);
  // **One action at a time, across every row** (PL-037). A ref, not the state above: two presses
  // can land before the first has re-rendered, and the second would be sent too.
  const inFlight = useRef(false);
  const createRefusal = refusalOf(newName, names);

  /** Whether the action was sent and answered without a refusal. */
  async function act(action: () => Promise<void>): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await action();
      selection.reload();
      return true;
    } catch (error) {
      setFailure(error);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return {
    newName,
    renaming,
    renameDraft,
    failure,
    busy,
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
      // A run of renames is one entry, so it reads from the name the run started from.
      const latest = history.changes[0];
      const first =
        latest?.target === targetKey ? (latest.before as { name: string }).name : was;
      await act(async () => {
        await renameCriteriaSet(target, name);
        setRenaming(null);
        setRenameDraft("");
        history.note({
          target: targetKey,
          stage: STAGE,
          label: `Renamed ${first} to ${name}`,
          before: { name: was },
          after: { name },
          reverse: async (before) => {
            await renameCriteriaSet(target, (before as { name: string }).name);
            selection.reload();
          },
        });
      });
    },
    // **Refused here as well as held on screen** (UIC-G1): Enter in the field submits whatever
    // the button looks like, now that it is held rather than disabled.
    create: async () => {
      if (createRefusal !== null) {
        setCreateRefused(true);
        return;
      }
      await act(async () => {
        const name = newName.trim();
        const created = await createCriteriaSet(identifierFrom(name), name);
        setNewName("");
        selection.selectCriteriaSet(created.id);
        history.note({
          target: `criteria-set:${created.id}:created`,
          stage: STAGE,
          label: `Created ${name}`,
          before: { exists: false },
          after: { exists: true },
          reverse: () => deleteAndReread(created.id),
        });
      });
    },
    // The copy is selected, because duplicating is how an experiment starts and the next
    // edit belongs to the copy rather than to what it was copied from.
    duplicate: async (criteriaSetId, currentName) => {
      await act(async () => {
        const name = copyName(currentName, names);
        const copy = await duplicateCriteriaSet(
          criteriaSetId,
          identifierFrom(name),
          name,
        );
        selection.selectCriteriaSet(copy.id);
        history.note({
          target: `criteria-set:${copy.id}:duplicated`,
          stage: STAGE,
          label: `Duplicated ${currentName} as ${name}`,
          before: { exists: false },
          after: { exists: true },
          reverse: () => deleteAndReread(copy.id),
        });
      });
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
      return act(async () => {
        await deleteCriteriaSet(criteriaSetId);
        history.note({
          target: `criteria-set:${criteriaSetId}:deleted`,
          stage: STAGE,
          label: `Deleted ${name}`,
          before: { deleted: false, wasInUse },
          after: { deleted: true },
          reverse: async () => {
            await restoreCriteriaSet(criteriaSetId);
            selection.reload();
            // Back in use only if the selection is still where the deletion left it.
            if (wasInUse && inUse.current === fallback) {
              selection.selectCriteriaSet(criteriaSetId);
            }
          },
        });
      });
    },
    deleteHeld: (criteriaSetId) =>
      busy || (options.writesInFlight && criteriaSetId === selection.criteriaSetId),
  };
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
