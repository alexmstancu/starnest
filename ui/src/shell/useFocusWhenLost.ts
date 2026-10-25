import { useEffect, useRef } from "react";

/**
 * Focus for what replaces a control the reader pressed (RULES "Focus").
 *
 * When a refusal swaps the pressed control for a notice, the browser puts focus on the page.
 * The notice takes it -- **only when `replacing`**, so a notice that was there from the first
 * render never takes focus from a reader who pressed nothing, and **only while focus is lost**,
 * so a reader who moved on keeps it where they put it. The element needs `tabIndex={-1}`.
 */
export function useFocusWhenLost<T extends HTMLElement>(replacing: boolean) {
  const target = useRef<T>(null);

  useEffect(() => {
    const focused = document.activeElement;
    if (replacing && (focused === null || focused === document.body)) target.current?.focus();
  }, [replacing]);

  return target;
}
