import { formatDate, formatDateTime } from "./display";

/**
 * The wording and the ordering behind a saved ranking, wherever one is listed.
 *
 * **It lives here because two places list them.** The sidebar carries the compact card the
 * design draws, and Rank carries the full panel with the control that saves one; `shell/` may
 * not import `routes/`, so a helper both need cannot live inside a feature folder.
 *
 * **The type is structural, not the contract's.** `format/` imports nothing of ours -- the
 * layering rule makes it the one module safe to call from anywhere -- so it names the four
 * fields it reads rather than importing `EvaluationSummary` from `api/`.
 */
export interface SavedRankingLike {
  criteria_set: string;
  level: string;
  computed_at: string;
  note?: string | null;
}

/**
 * Newest first, which is the order a saved list is read in.
 *
 * **Sorted here rather than trusted from the server.** `GET /evaluations` does not document an
 * order, and a list that is usually newest-first is worse than one that always is -- the
 * exception arrives long after anybody remembers the assumption.
 */
export function newestFirst<T extends SavedRankingLike>(items: readonly T[]): T[] {
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
export function describeSaved(saved: SavedRankingLike): string {
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
export function detailOf(saved: SavedRankingLike): string {
  return `${saved.criteria_set} at ${saved.level} level, saved ${formatDateTime(saved.computed_at)}`;
}

/**
 * The same provenance at sidebar width, which is 262px and cannot hold a sentence.
 *
 * The date alone, without the time: in a card listing several, what distinguishes them is
 * which day they were kept, and the minute is noise until two share a day.
 */
export function summariseSaved(saved: SavedRankingLike): string {
  return `${saved.criteria_set}, ${formatDate(saved.computed_at)}`;
}

/**
 * The evaluation id in `?saved=`, or nothing.
 *
 * **Parsed here rather than in the panel.** A `.tsx` under `routes/` may not call `Number`
 * (`CLAUDE.md`), which is the rule that keeps "text becomes a number" somewhere a test can
 * reach. A parameter somebody typed by hand can be anything, so anything that is not a whole
 * positive number reads as no request at all rather than as `NaN`.
 */
export function requestedSavedRanking(parameter: string | null): number | null {
  if (parameter === null) return null;
  if (!/^[1-9][0-9]*$/.test(parameter)) return null;
  return Number(parameter);
}
