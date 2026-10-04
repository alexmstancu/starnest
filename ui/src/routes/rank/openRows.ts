import type { PillarScore } from "./rankTable";

/**
 * A candidate whose evidence the reader has opened, and which pillar they are reading in it.
 *
 * **Identity and choice, and nothing the ranking already holds.** This used to carry the
 * candidate's name and its pillar rollup as well, with a docstring defending "the row already
 * had it, so looking it up again would be two paths to one number" -- but there was only ever
 * one path: `CandidateRow` builds a fresh object from `result.pillar_scores` on every render
 * and that is what `detail(row)` receives, so the copy kept here was read by nobody. Dropping
 * it from the state left all 210 tests green, which is how it was found.
 *
 * **Keeping it would have been worse than dead.** A rollup stored when the row was opened is a
 * snapshot; the ranking it came from can be refetched under it, and then the snapshot is a
 * stale set of figures sitting beside a live one, waiting for a reader of this file to pick the
 * wrong one. The live result is the only correct source, so the state holds no figures at all.
 */
export interface OpenRow {
  candidate: string;
  /**
   * Which pillar's values the reader is reading, or null for all of them.
   *
   * **It lives here because two components need it and neither contains the other.** The
   * chart of pillar scores is drawn in the row; the cards that filter the values are drawn in
   * the panel underneath. Held inside the panel -- where it was -- the chart could neither
   * show which pillar was chosen nor change it, because a sibling cannot read a sibling's
   * state. This is their nearest common ground, and it is already the record of what the
   * reader has open.
   */
  chosenPillar?: string | null;
}

/**
 * An open row together with the figures the ranking row itself is drawn from.
 *
 * **The handover, not the state.** This is what a row hands to its toggle, to its pillar chart
 * and to the panel underneath it, and every field past `candidate` comes straight off the
 * `CandidateResult` being rendered. The functions below take one of these and store only the
 * `OpenRow` part, which is the whole distinction: what the reader has open is state, and what
 * the candidate scored is the server's answer, re-read on every render.
 */
export interface OpenCandidate extends OpenRow {
  name: string;
  pillars?: readonly PillarScore[] | null;
}

/**
 * Open a candidate's evidence, or close it if it was already open.
 *
 * **Several rows stay open at once.** This used to be one candidate or none, so opening
 * Finland closed Portugal -- and comparing what two countries are scored on meant holding one
 * of them in your head. The list is the design's answer, and the order is the order they were
 * opened in, so a newly opened panel appears below the ones already being read rather than
 * somewhere in the middle of them.
 */
export function toggleRow(
  open: readonly OpenRow[],
  row: OpenRow,
): OpenRow[] {
  return isOpen(open, row.candidate)
    ? open.filter((each) => each.candidate !== row.candidate)
    // **Built, never spread.** A caller hands a whole `OpenCandidate`, and TypeScript checks
    // excess properties on literals only -- so `[...open, row]` would store the name and the
    // rollup at runtime whatever this signature says. Naming the two fields is what makes
    // "the state holds no figures" true rather than intended.
    : [...open, { candidate: row.candidate, chosenPillar: row.chosenPillar }];
}

/** Whether this candidate's evidence is one of the panels on screen. */
export function isOpen(
  open: readonly OpenRow[],
  candidate: string,
): boolean {
  return open.some((each) => each.candidate === candidate);
}

/**
 * Read which pillar is chosen for one candidate, with null for "all of them".
 *
 * A candidate that is not open has nothing chosen, which is the same answer as a candidate
 * that is open and filtered to nothing -- and both should draw the chart unfiltered.
 */
export function chosenPillarOf(
  open: readonly OpenRow[],
  candidate: string,
): string | null {
  return open.find((each) => each.candidate === candidate)?.chosenPillar ?? null;
}

/**
 * Choose a pillar for one candidate, or clear the choice by choosing it again.
 *
 * **Choosing a pillar on a closed candidate opens it**, because the chart is in the row and
 * the values it filters are in the panel: filtering something the reader cannot see would
 * look like nothing happening.
 */
export function choosePillar(
  open: readonly OpenRow[],
  row: OpenRow,
  pillar: string,
): OpenRow[] {
  const already = open.find((each) => each.candidate === row.candidate);
  if (already === undefined) {
    // Built rather than spread, for the reason `toggleRow` gives.
    return [...open, { candidate: row.candidate, chosenPillar: pillar }];
  }
  return open.map((each) =>
    each.candidate === row.candidate
      ? { ...each, chosenPillar: each.chosenPillar === pillar ? null : pillar }
      : each,
  );
}
