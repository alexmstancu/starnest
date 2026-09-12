/**
 * What the criteria-sets panel does: make one, rename one, discard one (`reqs.md` 3.4).
 *
 * **A new set is empty**, which the API decides: copying one would mean starting from somebody
 * else's priorities without being asked. Discarding a set does not touch a saved evaluation,
 * which froze its own copy of the criteria (`reqs.md` Q193) -- the difference between an opinion
 * and a measurement.
 */

import { useState } from "react";
import {
  createCriteriaSet,
  deleteCriteriaSet,
  renameCriteriaSet,
} from "../../../api/endpoints";

export interface CriteriaSetsForm {
  newId: string;
  newName: string;
  rename: string;
  failure: unknown;
  /** Whether the two fields a new set needs are both filled in. */
  canCreate: boolean;
  canRename: boolean;
  typeNewId: (value: string) => void;
  typeNewName: (value: string) => void;
  typeRename: (value: string) => void;
  create: () => void;
  renameTo: (criteriaSetId: string) => void;
  discard: (criteriaSetId: string) => void;
}

export function useCriteriaSets(options: {
  reload: () => void;
  select: (criteriaSetId: string) => void;
}): CriteriaSetsForm {
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState("");
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
    newId,
    newName,
    rename,
    failure,
    canCreate: newId.trim() !== "" && newName.trim() !== "",
    canRename: rename.trim() !== "",
    typeNewId: setNewId,
    typeNewName: setNewName,
    typeRename: setRename,
    create: () =>
      void act(async () => {
        const created = await createCriteriaSet(newId.trim(), newName.trim());
        setNewId("");
        setNewName("");
        options.select(created.id);
      }),
    renameTo: (criteriaSetId) =>
      void act(async () => {
        await renameCriteriaSet(criteriaSetId, rename.trim());
        setRename("");
      }),
    discard: (criteriaSetId) =>
      void act(() => deleteCriteriaSet(criteriaSetId)),
  };
}
