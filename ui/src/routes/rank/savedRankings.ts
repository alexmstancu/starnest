import type { EvaluationSummary } from "../../api/endpoints";
import { formatDateTime } from "../../format/display";

/**
 * The arithmetic and the wording behind the saved-rankings list, kept out of the markup.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number` and friends, and the same
 * reasoning applies to deciding what a row says: it is a rule about the domain, and a rule is
 * worth a test.
 */

/**
 * Newest first, which is the order a saved list is read in.
 *
 * **Sorted here rather than trusted from the server.** `GET /evaluations` does not document an
 * order, and a list that is usually newest-first is worse than one that always is -- the
 * exception arrives long after anybody remembers the assumption.
 */
export function newestFirst(
  items: readonly EvaluationSummary[],
): EvaluationSummary[] {
  return [...items].sort((left, right) =>
    right.computed_at.localeCompare(left.computed_at),
  );
}

/**
 * What a saved ranking is called in the list.
 *
 * The note leads when there is one, because a note is the reason it was kept and the rest is
 * bookkeeping. Without one, the criteria set and the moment are all there is to go on.
 */
export function describeSaved(saved: EvaluationSummary): string {
  // **Not `??`.** An empty string is not nullish, so `note ?? fallback` would keep a note of
  // spaces -- a note that says nothing while looking like one that does.
  const note = saved.note?.trim();
  return note === undefined || note === ""
    ? `${saved.criteria_set}, ${saved.level}`
    : note;
}

/**
 * The second line: always the full provenance, whether or not a note took the first.
 *
 * **A phrase, not a list of facts strung together.** The separator this used to lean on is
 * barred outright (`CLAUDE.md`), and the fix that matters is not a different character -- it
 * is saying the thing in words, which reads as a sentence and needs no separator at all.
 */
export function detailOf(saved: EvaluationSummary): string {
  return `${saved.criteria_set} at ${saved.level} level, saved ${formatDateTime(saved.computed_at)}`;
}
