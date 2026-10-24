/**
 * Where a keyboard goes once the control it was on is gone (NEW-45).
 *
 * **A write can take its own button away.** An undo removes its entry, a confirmed proposal
 * leaves the table, an arrow is disabled once its row reaches the end of the list -- and a
 * browser answers each by putting focus on the page, from where a keyboard user starts again at
 * the top. So the panel names where focus should go instead, in order of preference, and the
 * first that can take it does.
 *
 * **Only when it was lost.** Focus a reader moved somewhere else while the write was in flight
 * was put there on purpose, and taking it back would be the screen deciding for them. Focus left
 * on a control that has since been disabled counts as lost: Chromium drops it there at once,
 * and jsdom only later, if at all.
 */
export function refocusIfLost(...targets: (HTMLElement | null | undefined)[]): void {
  if (!focusIsLost()) return;
  for (const target of targets) {
    if (!target?.isConnected || target.matches(":disabled")) continue;
    target.focus();
    if (document.activeElement === target) return;
  }
}

function focusIsLost(): boolean {
  const focused = document.activeElement;
  return (
    focused === null ||
    focused === document.body ||
    (focused instanceof HTMLElement && focused.matches(":disabled"))
  );
}
