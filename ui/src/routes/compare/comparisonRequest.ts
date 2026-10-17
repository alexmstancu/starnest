/**
 * What Compare would ask the server for, or nothing while there is nothing to ask.
 *
 * **One answer to both questions: may Compare be pressed, and what does pressing it send.** The
 * button was disabled only for a `null` focus while the click submitted only a truthy one, and
 * the focus picker's placeholder is the empty string -- so clearing the focus left Compare
 * enabled and clicking it did nothing (UI-25).
 */

export interface ComparisonRequest {
  focus: string;
  comparators: string[];
}

export function requestFor(
  focus: string | null,
  comparators: readonly string[],
): ComparisonRequest | null {
  if (focus === null || focus === "" || comparators.length === 0) return null;
  return { focus, comparators: [...comparators] };
}
