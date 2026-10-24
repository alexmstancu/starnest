/**
 * Where the keyboard goes inside a row's pillar chart (PL-076, UF-120).
 *
 * **One tab stop per chart, and the arrow keys along it**, as a toolbar has. Eleven bars that
 * were each a stop of their own made crossing 32 rows about 350 presses of Tab, so the chart
 * keeps one bar reachable by Tab -- a roving tab index -- and moves that one with the arrows.
 */

/**
 * The bar a key moves the keyboard to, from the bar at `at` in a chart of `count`, or null for
 * a key the chart leaves to the browser.
 *
 * **The ends are ends, not a wrap.** The bars are an axis, read left to right, and Home and
 * End are already one key away from either end.
 */
export function barReachedBy(
  key: string,
  at: number,
  count: number,
): number | null {
  switch (key) {
    case "ArrowRight":
      return Math.min(at + 1, count - 1);
    case "ArrowLeft":
      return Math.max(at - 1, 0);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The one bar Tab reaches: the bar the keyboard is on, else the chosen one, else the first.
 *
 * **The bar the keyboard is on must be the stop while it is there**, or Shift+Tab from it finds
 * the stop before it -- inside the same chart -- rather than leaving. Once the keyboard has
 * left, the chosen bar is the one marked, so it is the one to come back to, as in a radio
 * group. A pillar the chart no longer draws is passed over, so a re-read never leaves the
 * chart with no stop at all.
 */
export function tabStopOf(
  bars: readonly string[],
  focused: string | null,
  chosen: string | null,
): string | undefined {
  return [focused, chosen].find(
    (pillar): pillar is string => pillar !== null && bars.includes(pillar),
  ) ?? bars[0];
}
