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

import { useState } from "react";
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
  canCreate: boolean;
  canSaveRename: boolean;
  typeNewName: (value: string) => void;
  typeRenameDraft: (value: string) => void;
  beginRename: (criteriaSetId: string, currentName: string) => void;
  cancelRename: () => void;
  saveRename: () => void;
  create: () => void;
  duplicate: (criteriaSetId: string, currentName: string) => void;
  discard: (criteriaSetId: string) => void;
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

  async function act(action: () => Promise<void>): Promise<void> {
    setFailure(null);
    try {
      await action();
      options.reload();
    } catch (error) {
      setFailure(error);
    }
  }

  return {
    newName,
    renaming,
    renameDraft,
    failure,
    canCreate: identifierFrom(newName) !== "",
    canSaveRename: renameDraft.trim() !== "",
    typeNewName: setNewName,
    typeRenameDraft: setRenameDraft,
    beginRename: (criteriaSetId, currentName) => {
      setRenaming(criteriaSetId);
      setRenameDraft(currentName);
    },
    cancelRename: () => {
      setRenaming(null);
      setRenameDraft("");
    },
    saveRename: () => {
      const target = renaming;
      if (target === null) return;
      void act(async () => {
        await renameCriteriaSet(target, renameDraft.trim());
        setRenaming(null);
        setRenameDraft("");
      });
    },
    create: () =>
      void act(async () => {
        const name = newName.trim();
        const created = await createCriteriaSet(identifierFrom(name), name);
        setNewName("");
        options.select(created.id);
      }),
    // The copy is selected, because duplicating is how an experiment starts and the next
    // edit belongs to the copy rather than to what it was copied from.
    duplicate: (criteriaSetId, currentName) =>
      void act(async () => {
        const name = copyName(currentName, options.names);
        const copy = await duplicateCriteriaSet(
          criteriaSetId,
          identifierFrom(name),
          name,
        );
        options.select(copy.id);
      }),
    // Discarding says nothing about what to select next: `SelectionContext` holds the rule that
    // the chosen set is one that exists, and applies it when the refreshed list arrives (P44).
    discard: (criteriaSetId) => void act(() => deleteCriteriaSet(criteriaSetId)),
  };
}
