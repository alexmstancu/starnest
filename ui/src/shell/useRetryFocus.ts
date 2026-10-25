import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
import type { Read } from "../api/read";

/**
 * Focus across a Try again (RULES "Focus").
 *
 * **Try again takes its own button away**, and a browser answers by putting focus on the
 * page. So `region` -- an element that stays while the read is retried, with `tabIndex={-1}` --
 * holds focus while it is read again, and hands it to the new Try again if that fails too; but
 * only while focus is still in the region or lost: a reader who tabbed elsewhere meanwhile put
 * it there on purpose.
 *
 * Call `hold()` as Try again is pressed, and give the failure card `retryButton`.
 */
export function useRetryFocus(read: Read<unknown>, region: RefObject<HTMLElement | null>) {
  const retryButton = useRef<HTMLButtonElement>(null);
  const holding = useRef(false);

  const hold = useCallback(() => {
    holding.current = region.current?.contains(document.activeElement) ?? false;
  }, [region]);

  // Before paint, so focus never sits on the page between the commit and an effect.
  useLayoutEffect(() => {
    if (!holding.current) return;
    if (!focusIsInOrLost(region.current)) {
      holding.current = false;
      return;
    }
    (retryButton.current ?? region.current)?.focus();
    const settled =
      read.state !== "pending" && !(read.state === "ready" && read.refresh === "running");
    if (settled) holding.current = false;
  }, [read, region]);

  return { retryButton, hold };
}

function focusIsInOrLost(region: HTMLElement | null): boolean {
  const focused = document.activeElement;
  return focused === null || focused === document.body || (region?.contains(focused) ?? false);
}
