/**
 * Turning a selection of failed or unanswered items into a run that asks about exactly those.
 *
 * **Why this is not `POST /{runId}/retry`.** That endpoint takes `items: failed | unanswered`
 * over the whole run and nothing narrower, so anything the reader has picked out has to go
 * through `/data-acquisition-runs/plan` and then `POST /data-acquisition-runs` with a scope.
 * A routing decision, not a limitation: the scope carries what to ask about, and a retry
 * carries only which bucket.
 */

/** One thing a run did not get an answer for. A failure also names the source that refused. */
export interface Item {
  candidate: string;
  attribute: string;
  data_source?: string;
  /**
   * Why it failed, where something did. **Carried on the item because the design puts it on
   * the item**: every row in a group list has a right-hand detail, and for a failure that
   * detail is the message. It was left off this type, which is what forced the message into a
   * table of its own.
   */
  error_message?: string;
}

export interface Group {
  /** The source that failed, or the attribute nobody answered. */
  key: string;
  items: Item[];
}

/** How an item is named in a selection, since neither half identifies it alone. */
export function keyOf(item: Item): string {
  return `${item.candidate}|${item.attribute}|${item.data_source ?? ""}`;
}

/**
 * Failures group by **source** and unanswered items by **attribute**.
 *
 * Not a display preference: a failure is a source refusing, so the useful question is "what
 * did Eurostat refuse?", while nothing refused an unanswered item -- no source covers it --
 * and the useful question is "which attribute does nobody answer?".
 */
export function groupBy(
  items: readonly Item[],
  by: "data_source" | "attribute",
): Group[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = by === "data_source" ? (item.data_source ?? "unknown") : item.attribute;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([key, grouped]) => ({ key, items: grouped }));
}

/**
 * The scope a run needs to ask about exactly these items.
 *
 * **Candidates and attributes are separate lists, so the scope is their product.** Asking
 * about two countries and two attributes asks four questions, not the two that were selected.
 * That is what `RunScope` can express, and pretending otherwise would be the interface
 * inventing a shape the contract does not have -- so the caller is told the real size.
 */
export function scopeFor(
  level: string,
  items: readonly Item[],
): { level: string; candidates: string[]; attributes: string[] } {
  return {
    level,
    candidates: [...new Set(items.map((item) => item.candidate))].sort(),
    attributes: [...new Set(items.map((item) => item.attribute))].sort(),
  };
}

/**
 * How many questions the scope actually asks, as against how many items were picked.
 *
 * They differ whenever the selection is not a full rectangle, and a reader about to spend
 * money is entitled to the real number rather than the flattering one.
 */
export function questionsIn(scope: {
  candidates: string[];
  attributes: string[];
}): number {
  return scope.candidates.length * scope.attributes.length;
}
