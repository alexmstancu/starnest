/**
 * What Compare asks the server for, or nothing while there is nothing to ask.
 *
 * **Derived from the selection, never stored** (PL-094): the drawing follows every change, so
 * the request is a function of what is chosen. The focus picker's placeholder is the empty
 * string, which is no candidate (UI-25).
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
 * Whether a drawn comparison is the comparison of this request: the same focus, against the
 * same comparators. The order is not compared, because the drawing puts them in score order.
 */
export function describesSelection(
  comparison: { focus: { candidate: string }; comparators?: readonly { candidate: string }[] },
  request: ComparisonRequest | null,
): boolean {
  if (comparison.focus.candidate !== request?.focus) return false;
  const drawn = (comparison.comparators ?? []).map((each) => each.candidate).sort();
  const asked = [...request.comparators].sort();
  return drawn.length === asked.length && drawn.every((each, at) => each === asked[at]);
}
