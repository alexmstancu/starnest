import { useEffect, useMemo, useRef } from "react";

/**
 * Focus for what replaces a control the reader pressed (RULES "Focus").
 *
 * When a refusal swaps the pressed control for a notice, the browser puts focus on the page.
 * **Only the notice that replaced it may take it back**: a region claims focus whenever focus
 * enters it, any focus elsewhere releases the claim, and a notice takes focus only if its own
 * region holds the claim -- so two refusals landing together never fight over one focus, and a
 * notice drawn on the first render, before anything was pressed, takes none. **And only while
 * focus is lost**, so a reader who is still somewhere takes nothing from where they are.
 */

export interface FocusRegion {
  /** For the region's stable element, as `onFocus`: focus is in here now. */
  claim: () => void;
  /** Whether focus was last in this region. */
  holds: () => boolean;
}

let claimant: object | null = null;
let listening = false;

/** Any focus releases the claim; the region it entered claims it again as the event reaches it. */
function releaseOnEveryFocus(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("focusin", () => {
    claimant = null;
  }, true);
}

export function useFocusRegion(): FocusRegion {
  const token = useRef({});
  useEffect(releaseOnEveryFocus, []);
  return useMemo(
    () => ({
      claim: () => {
        claimant = token.current;
      },
      holds: () => claimant === token.current,
    }),
    [],
  );
}

/** For the notice that replaces a region's control. The element needs `tabIndex={-1}`. */
export function useFocusWhenLost<T extends HTMLElement>(region: FocusRegion) {
  const target = useRef<T>(null);

  useEffect(() => {
    const focused = document.activeElement;
    const lost = focused === null || focused === document.body;
    if (lost && region.holds()) target.current?.focus();
  }, [region]);

  return target;
}
