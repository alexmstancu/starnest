import { useEffect, useId, useRef, useState } from "react";
import type { CriteriaSetSummary } from "../../../api/endpoints";
import { refocusIfLost } from "../../../shell/focusReturn";

/** Where focus goes once a set action that took its own control away has answered. */
type Pending =
  | { to: "button"; criteriaSetId: string; verb: Verb }
  | { to: "successor"; gone: string; index: number };

type Verb = "rename" | "delete";

/**
 * Where a keyboard goes after a set action (PL-037, PL-038).
 *
 * **Save, Cancel and the deletion strip take the pressed button away**, so each names its
 * successor: the row's Rename after a rename closes; the row's Delete once the strip is
 * dismissed or the copy it offered is made; after a deletion, the same slot on the row that takes the
 * deleted one's place, else the row above, else the new-set field. A deletion's row leaves only
 * once the refreshed list arrives, so that is what this waits for. Focus that a reader moved
 * meanwhile is left where they put it (`refocusIfLost`).
 */
export function useSetFocus(
  criteriaSets: readonly CriteriaSetSummary[],
  renaming: string | null,
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

  useEffect(() => {
    const awaited = pending.current;
    if (awaited === null) return;
    if (awaited.to === "button") {
      refocusIfLost(document.getElementById(buttonId(awaited.criteriaSetId, awaited.verb)));
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

  const expect = (next: Pending) => {
    pending.current = next;
    setSettled((count) => count + 1);
  };

  return {
    renameField,
    newName,
    buttonId,
    returnTo: (criteriaSetId: string, verb: Verb) =>
      expect({ to: "button", criteriaSetId, verb }),
    deleted: (criteriaSetId: string) =>
      expect({
        to: "successor",
        gone: criteriaSetId,
        index: criteriaSets.findIndex((set) => set.id === criteriaSetId),
      }),
  };
}
