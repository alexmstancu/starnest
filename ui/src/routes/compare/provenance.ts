/**
 * Where a figure on Compare came from (PL-096): its source, the period it describes, when it was
 * fetched and how far it can be trusted.
 *
 * **Structural, like `format/figure`**: it reads the fields a `Value` carries and nothing else,
 * and leaves out a part the value does not carry rather than printing a blank. It lives here,
 * beside the one screen that uses it; Rank keeps its own provenance layout.
 */

import { formatDate, formatDateTime, formatIdentifier, sourceName } from "../../format/display";

/** The fields of a `Value` its provenance is read from. */
export interface HasProvenance {
  data_source?: string;
  reference_period?: { start: string; end: string } | null;
  retrieval_date?: string | null;
  confidence_level?: string | null;
  quote?: string | null;
}

/** The source that copies another candidate's figure where nothing else answers (Q208). */
const STAND_IN = "stand_in";

/**
 * One sentence per fact. A borrowed figure adds its quote, which names whose figure it is and
 * why it stands in: without it, the figure reads as this candidate's own measurement.
 */
export function describeProvenance(
  value: HasProvenance,
  sourceNames: ReadonlyMap<string, string>,
): string {
  const parts = [
    value.data_source && `Source: ${sourceName(sourceNames, value.data_source)}.`,
    value.reference_period &&
      `Describes ${formatDate(value.reference_period.start)} to ${formatDate(value.reference_period.end)}.`,
    value.retrieval_date && `Fetched ${formatDateTime(value.retrieval_date)}.`,
    value.confidence_level && `${formatIdentifier(value.confidence_level)} confidence.`,
    value.data_source === STAND_IN && value.quote,
  ];
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}

/**
 * The mark a figure wears where it is shown: borrowed before low confidence, because a borrowed
 * figure is always low confidence and "Borrowed" says why.
 */
export function provenanceMark(value: HasProvenance): string | null {
  if (value.data_source === STAND_IN) return "Borrowed";
  if (value.confidence_level === "low") return "Low confidence";
  return null;
}
