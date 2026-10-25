/**
 * Turning a selection of failed or unanswered items into a run that asks about exactly those
 * pairs (PL-124, D32): a retry of the run they came from, or a run scoped to the pairs.
 */

import type { RunPair, RunScope } from "../../api/endpoints";

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

/** What a remedy card goes over again: its failures, its unanswered items, or what was never asked. */
export type RemedyKind = "failed" | "unanswered" | "not_reached";

/**
 * How a selection is asked about again (PL-124, D32), always as its exact pairs.
 *
 * **A retry of the one run they belong to, where there is one**: a failure is then asked only of
 * the sources that failed on it, and the estimate is the retry's own. A selection spanning
 * several runs, or pairs no run has asked about, is a run scoped to those pairs, which asks
 * every switched-on source -- the strip names them before anything is agreed to.
 */
export type Proposal =
  | { via: "retry"; level: string; runId: number; items: "failed" | "unanswered"; pairs: RunPair[] }
  | { via: "scoped"; scope: RunScope };

/** The distinct pairs of a selection, in the order picked: an item two sources failed on is one. */
export function pairsOf(items: readonly Item[]): RunPair[] {
  const pairs = new Map<string, RunPair>();
  for (const { candidate, attribute } of items) {
    pairs.set(`${candidate}|${attribute}`, { candidate, attribute });
  }
  return [...pairs.values()];
}

/**
 * The proposal for `items` of one kind, at `level`. `runOf` names the run each pair's gap
 * belongs to, by `candidate|attribute`; null where no run has asked about it.
 */
export function proposalFor(
  level: string,
  kind: RemedyKind,
  items: readonly Item[],
  runOf: ReadonlyMap<string, number | null>,
): Proposal {
  const pairs = pairsOf(items);
  const runs = new Set(pairs.map((pair) => runOf.get(`${pair.candidate}|${pair.attribute}`) ?? null));
  const [only] = runs;
  if (kind !== "not_reached" && runs.size === 1 && only !== null && only !== undefined) {
    return { via: "retry", level, runId: only, items: kind, pairs };
  }
  return { via: "scoped", scope: { level, pairs } };
}

/** The level a proposal is at, so one for a level the reader has left is never started. */
export function levelOf(proposal: Proposal): string {
  return proposal.via === "retry" ? proposal.level : proposal.scope.level;
}
