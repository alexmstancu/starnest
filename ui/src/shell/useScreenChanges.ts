import { useState } from "react";
import { useLocation } from "react-router-dom";
import { findRouteByPath } from "../navigation/routes";

/**
 * How many times the reader has left one screen for another since the shell opened (UI-11).
 *
 * **The sidebar reads again on each**, because the screen just left may have written what it
 * shows -- a household saved on Configure, a gate answered there, a run started on Acquire. It
 * is the smaller of the two fixes the household was offered: a save is not seen until the
 * screen changes.
 *
 * **The screen, not the address.** Opening a saved ranking, or pressing the tab of the screen
 * already shown, changes the address and leaves the reader where they were, so it reads
 * nothing. **And only a screen that is left counts**: the root only redirects and an unknown
 * address shows nothing, so neither can have written anything -- and counting the redirect
 * would read the whole sidebar twice on every visit that starts at `/`.
 */
export function useScreenChanges(): number {
  const { pathname } = useLocation();
  const [shown, setShown] = useState(pathname);
  const [changes, setChanges] = useState(0);

  // Adjusted while rendering, as React advises for state that follows a value: in an effect,
  // the sidebar would render once with the old count and only then read again.
  if (shown !== pathname) {
    setShown(pathname);
    if (findRouteByPath(shown) !== undefined) setChanges(changes + 1);
  }

  return changes;
}
