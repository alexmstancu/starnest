import { useEffect, useRef, type RefObject } from "react";
import type { PassEnd } from "./researchPass";

/**
 * Where a keyboard goes when a research pass ends (UI-01).
 *
 * **The controls a pass offered go with it.** Its estimate is spent, so Research the gates leaves
 * the page, and Stop leaves with the pass -- and a keyboard user standing on either would be put
 * back on the page, which is NEW-45's kind. So focus goes to `next`, the act the next pass needs,
 * and only when the page has it: focus the reader put somewhere else stays where they put it.
 *
 * **Only when a pass ends while this panel is on screen.** A panel mounted after one ended -- the
 * criteria set switched, say -- has nothing of its own to hand focus back from.
 */
export function useFocusAfterPass(
  end: PassEnd | null,
  next: RefObject<HTMLElement | null>,
): void {
  const seen = useRef(end);

  useEffect(() => {
    if (end === seen.current) return;
    seen.current = end;
    if (end !== null && document.activeElement === document.body) {
      next.current?.focus();
    }
  }, [end, next]);
}
