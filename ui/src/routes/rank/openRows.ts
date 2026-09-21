import type { PillarScore } from "./rankTable";

/**
 * A candidate whose evidence the reader has opened, and what the drill-down needs from it.
 *
 * **It carries the pillar rollup rather than looking it up again.** The row already had it --
 * it drew the chart from it -- so finding the candidate a second time in the ranking would be
 * two paths to one number, and the sort of thing that goes out of step.
 */
export interface OpenRow {
  candidate: string;
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
    : [...open, row];
}

/** Whether this candidate's evidence is one of the panels on screen. */
export function isOpen(
  open: readonly OpenRow[],
  candidate: string,
): boolean {
  return open.some((each) => each.candidate === candidate);
}
