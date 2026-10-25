import { useEffect, useId, useRef, useState } from "react";
import type { CriteriaSetSummary } from "../../../api/endpoints";
import { refocusIfLost } from "../../../shell/focusReturn";

/** Where focus goes once a set action that took its own control away has answered. */
type Pending =
  | { to: "rename"; criteriaSetId: string }
  | { to: "successor"; gone: string; index: number };

type Verb = "rename" | "delete";

/**
 * Where a keyboard goes after a set action (PL-037, PL-038).
 *
 * **Save, Cancel and Delete take the pressed button away**, so each names its successor: the
 * row's Rename after a rename closes; after a deletion, the same slot on the row that takes the
 * deleted one's place, else the row above, else the new-set field. A deletion's row leaves only
 * once the refreshed list arrives, so that is what this waits for. Focus that a reader moved
 * meanwhile is left where they put it (`refocusIfLost`), and a Delete pressed without focus on
 * it claims none.
 */
export function useSetFocus(
  criteriaSets: readonly CriteriaSetSummary[],
  renaming: string | null,
  /** The list failed to be read again, so the stage offers Try again. */
  listFailed: boolean,
) {
  const prefix = useId();
  const renameField = useRef<HTMLInputElement>(null);
  const newName = useRef<HTMLInputElement>(null);
  // A ref and a counter rather than state: what is pending is read once, by the effect, and
  // the counter is only the signal that something now is.
  const pending = useRef<Pending | null>(null);
  const [settled, setSettled] = useState(0);
  const buttonId = (criteriaSetId: string, verb: Verb) =>
    `${prefix}-${criteriaSetId}-${verb}`;

  // On a change only, never on mount, so Strict Mode's second mount moves nothing.
  useEffect(() => {
    if (renaming === null) return;
    renameField.current?.focus();
    renameField.current?.select();
  }, [renaming]);

  // **A rename whose set went away** -- undone, or deleted elsewhere -- took its field with it,
  // so focus goes where a deletion would send it, on the Rename slot.
  const renamed = useRef<{ criteriaSetId: string; index: number } | null>(null);
  useEffect(() => {
    const was = renamed.current;
    renamed.current =
      renaming === null
        ? null
        : { criteriaSetId: renaming, index: criteriaSets.findIndex((set) => set.id === renaming) };
    if (was === null || criteriaSets.some((set) => set.id === was.criteriaSetId)) return;
    const successor = criteriaSets[was.index] ?? criteriaSets[was.index - 1];
    refocusIfLost(
      successor && document.getElementById(buttonId(successor.id, "rename")),
      newName.current,
    );
    // `buttonId` is derived from `prefix`, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming, criteriaSets]);

  useEffect(() => {
    const awaited = pending.current;
    if (awaited === null) return;
    if (awaited.to === "rename") {
      refocusIfLost(document.getElementById(buttonId(awaited.criteriaSetId, "rename")));
    } else {
      if (criteriaSets.some((set) => set.id === awaited.gone)) return;
      const successor =
        criteriaSets[awaited.index] ?? criteriaSets[awaited.index - 1];
      refocusIfLost(
        successor && document.getElementById(buttonId(successor.id, "delete")),
        newName.current,
      );
    }
    pending.current = null;
    // `buttonId` is derived from `prefix`, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, criteriaSets]);

  // **Try again takes its own button away** while the list is read again (PL-033), so focus it
  // held goes to the new-set field rather than to the page.
  const wasFailing = useRef(listFailed);
  useEffect(() => {
    if (wasFailing.current && !listFailed) refocusIfLost(newName.current);
    wasFailing.current = listFailed;
  }, [listFailed]);

  const expect = (next: Pending) => {
    pending.current = next;
    setSettled((count) => count + 1);
  };

  return {
    renameField,
    newName,
    buttonId,
    renameClosed: (criteriaSetId: string) => expect({ to: "rename", criteriaSetId }),
    deleted: (criteriaSetId: string) => {
      // **Only a keyboard on the Delete it pressed has a successor to go to** (PL-033): a Delete
      // pressed with focus elsewhere has no claim on where focus goes, and its list can arrive
      // just as another answer has placed focus -- a confirmation on its Undo -- which a stale
      // successor would take away.
      if (document.activeElement !== document.getElementById(buttonId(criteriaSetId, "delete"))) {
        return;
      }
      expect({
        to: "successor",
        gone: criteriaSetId,
        index: criteriaSets.findIndex((set) => set.id === criteriaSetId),
      });
    },
  };
}
