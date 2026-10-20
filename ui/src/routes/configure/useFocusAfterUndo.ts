import { useEffect, useRef, type RefObject } from "react";
import { refocusIfLost } from "./focusReturn";
import type { ChangeHistory } from "./useChangeHistory";

/**
 * Where a keyboard goes once an undo has answered (NEW-45).
 *
 * **An undo takes the pressed button away with its entry**, and "Back to where I started" takes
 * itself away with the last one, so a keyboard user was put back on the page after either. Focus
 * goes to the panel's own heading button: always there, and a stray Enter on it only folds the
 * panel, where one on the next Undo would undo more. A refused undo leaves its button, and focus
 * with it, where they were.
 */
export function useFocusAfterUndo(
  history: ChangeHistory,
  /** The panel's own heading button, which focus goes to. */
  heading: RefObject<HTMLElement | null>,
) {
  const pressed = useRef(false);

  useEffect(() => {
    if (!pressed.current || history.undoing) return;
    pressed.current = false;
    refocusIfLost(heading.current);
  }, [history.changes, history.undoing, heading]);

  return {
    /** Notes that an undo was sent from this panel, so its answer can hand focus on. */
    pressed: (): void => {
      pressed.current = true;
    },
  };
}
