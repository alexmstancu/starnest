/**
 * What the criteria-set stage does: make one, use one, rename one, copy one, discard one
 * (`reqs.md` 3.4).
 *
 * **A new set is empty**, which the API decides: copying one would mean starting from somebody
 * else's priorities without being asked. Discarding a set does not touch a saved evaluation,
 * which froze its own copy of the criteria (`reqs.md` Q193) -- the difference between an opinion
 * and a measurement.
 *
 * **One name, not a name and an identifier.** The design asks for what the set is called and
 * derives the rest (`setIdentifier.ts`); the server still refuses a collision, so nothing is
 * guessed around.
 */

import { useRef, useState } from "react";
import {
  createCriteriaSet,
  deleteCriteriaSet,
  duplicateCriteriaSet,
  renameCriteriaSet,
} from "../../../api/endpoints";
import { copyName, identifierFrom } from "./setIdentifier";

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
}

export function useCriteriaSets(options: {
  /** Every set's name, so a copy can be given one that is not taken. */
  names: readonly string[];
  reload: () => void;
  select: (criteriaSetId: string | null) => void;
}): CriteriaSetsForm {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [createRefused, setCreateRefused] = useState(false);
  // **One action at a time, across every row** (PL-037). A ref, not the state above: two presses
  // can land before the first has re-rendered, and the second would be sent too.
  const inFlight = useRef(false);
  const createRefusal = refusalOf(newName, options.names);

  /** Whether the action was sent and answered without a refusal. */
  async function act(action: () => Promise<void>): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await action();
      options.reload();
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
      await act(async () => {
        await renameCriteriaSet(target, renameDraft.trim());
        setRenaming(null);
        setRenameDraft("");
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
        options.select(created.id);
      });
    },
    // The copy is selected, because duplicating is how an experiment starts and the next
    // edit belongs to the copy rather than to what it was copied from.
    duplicate: async (criteriaSetId, currentName) => {
      await act(async () => {
        const name = copyName(currentName, options.names);
        const copy = await duplicateCriteriaSet(
          criteriaSetId,
          identifierFrom(name),
          name,
        );
        options.select(copy.id);
      });
    },
    // Discarding says nothing about what to select next: `SelectionContext` holds the rule that
    // the chosen set is one that exists, and applies it when the refreshed list arrives (P44).
    discard: (criteriaSetId) => act(() => deleteCriteriaSet(criteriaSetId)),
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
