import { useEffect } from "react";

/**
 * Asks before a reload or a closed tab throws away what was typed and not saved (PL-025, D8).
 *
 * **Through the browser's own prompt, and registered only while something is unsaved**: a
 * handler that is always there would make every reload ask, and teach the reader to click past
 * it. Moving between tabs inside the app needs no prompt, because the drafts outlive it.
 */
export function useWarnBeforeLeaving(unsaved: boolean): void {
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chromium before 119 asks only when this is set as well.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
}
