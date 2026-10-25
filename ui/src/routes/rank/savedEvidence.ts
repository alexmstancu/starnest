/**
 * What a saved ranking kept as the evidence behind each figure, in words (PL-144, D46).
 *
 * **Absence comes in two kinds, and they read differently.** A contribution with no figure had
 * nothing to score; a scored contribution with no row was saved before the evidence was kept,
 * so its figure is *not recorded* -- never a zero, and never today's figure passed off as the
 * one it scored. The same holds for a refusal or a warning whose inputs were not kept.
 *
 * `CLAUDE.md` keeps "text becomes a number" out of a `.tsx` under `routes/`, so the reading
 * happens here and the panel prints what it is given.
 */

import { describeFigure } from "../../format/figure";
import { formatDate, formatDateTime, sourceName } from "../../format/display";

export const NOT_RECORDED = "not recorded";

/** A stored figure as the contract serves it, narrowed to what provenance reads. */
export interface SavedFigure {
  payload: unknown;
  data_source: string;
  reference_period: { start: string; end: string };
  retrieval_date: string;
  quote?: string | null;
}

/** A gate answer as a refusal read it. */
export interface SavedGateAnswer {
  match_result: "matching" | "not_matching" | "unknown";
  data_source: string;
  retrieval_date?: string;
  reference_period?: { start: string; end: string } | null;
  reason?: string | null;
}

/** One figure with everything that says where it came from. */
export interface Provenance {
  figure: string;
  source: string;
  describes: string;
  fetched: string;
}

export type FigureReading =
  | { kind: "recorded"; provenance: Provenance }
  | { kind: "not_recorded" }
  | { kind: "no_figure" };

/**
 * The figure a saved contribution scored, or why there is none.
 *
 * Scored and without a row is the ranking saved before its evidence was kept: not recorded.
 * Unscored and without a row is a criterion nothing answered.
 */
export function savedFigure(
  value: SavedFigure | null | undefined,
  scored: boolean,
  sources: ReadonlyMap<string, string>,
): FigureReading {
  if (value != null) return { kind: "recorded", provenance: provenanceOf(value, sources) };
  return scored ? { kind: "not_recorded" } : { kind: "no_figure" };
}

export function provenanceOf(
  value: SavedFigure,
  sources: ReadonlyMap<string, string>,
): Provenance {
  return {
    figure: describeFigure(value),
    source: sourceName(sources, value.data_source),
    describes: periodOf(value.reference_period),
    fetched: formatDateTime(value.retrieval_date),
  };
}

/** What a refusal or a warning read, or `null` where it read nothing that was kept. */
export function savedInputs(
  inputs: readonly SavedFigure[] | null | undefined,
  sources: ReadonlyMap<string, string>,
): Provenance[] | null {
  if (inputs == null || inputs.length === 0) return null;
  return inputs.map((input) => provenanceOf(input, sources));
}

export interface GateReading {
  answer: string;
  source: string;
  fetched: string;
  describes: string | null;
  reason: string | null;
}

const ANSWERS: Readonly<Record<SavedGateAnswer["match_result"], string>> = {
  matching: "Matches",
  not_matching: "Does not match",
  unknown: "Not known",
};

/** The gate answer a refusal read, or `null` when it was saved before answers were kept. */
export function savedGateAnswer(
  answer: SavedGateAnswer | null | undefined,
  sources: ReadonlyMap<string, string>,
): GateReading | null {
  if (answer == null) return null;
  return {
    answer: ANSWERS[answer.match_result],
    source: sourceName(sources, answer.data_source),
    fetched: formatDateTime(answer.retrieval_date),
    describes: answer.reference_period ? periodOf(answer.reference_period) : null,
    reason: answer.reason?.trim() ? answer.reason.trim() : null,
  };
}

function periodOf(period: { start: string; end: string }): string {
  return `${formatDate(period.start)} to ${formatDate(period.end)}`;
}
