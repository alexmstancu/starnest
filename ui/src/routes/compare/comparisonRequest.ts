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

/**
 * Whether pressing Compare asks for what is already asked: the same resource, read again, which
 * keeps the comparison on screen while it is (PL-010), rather than another one.
 */
export function asksTheSame(
  request: ComparisonRequest,
  asked: ComparisonRequest | null,
): boolean {
  return (
    asked !== null &&
    request.focus === asked.focus &&
    request.comparators.length === asked.comparators.length &&
    request.comparators.every((comparator, at) => comparator === asked.comparators[at])
  );
}
