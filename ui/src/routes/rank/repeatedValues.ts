import type { StoredValue } from "../../api/endpoints";
import { formatDate } from "../../format/display";

/**
 * Stored values with byte-identical repeats folded into one, counted.
 *
 * **Every stored value is kept, and the panel is meant to list them** (`reqs.md` 3.6: a figure
 * is never discarded, and the design says the candidate detail shows active, superseded and
 * rejected alike). That stays true. What it did not anticipate is the same figure stored
 * twenty-six times.
 *
 * It happens because an acquisition appends what it fetched without asking whether the figure
 * changed, so every sweep writes another row: Malta's working hours is one Eurostat figure for
 * one year, stored 26 times from 26 runs, identical in source, period and magnitude. Listing
 * all 26 is not provenance, it is the same provenance 26 times -- and it buried the two rows
 * that actually differ.
 *
 * **Only an exact repeat folds.** Two figures that differ in any way a reader could act on --
 * a different source, a different period, a different magnitude, a rejection -- are different
 * evidence and stay separate rows. That is the whole point of storing them.
 */
export interface RepeatedValue {
  /** The most recently retrieved of the identical copies, which is the one to show. */
  value: StoredValue;
  /** How many identical copies were stored, including the one shown. */
  copies: number;
  /** When the earliest identical copy was fetched, when there is more than one. */
  firstRetrieved: string | null;
}

/**
 * What makes two stored figures the same evidence.
 *
 * Deliberately everything a reader is shown about a figure except *when we fetched it* and
 * *which run fetched it*. Two rows agreeing on all of this differ only in the occasion, and an
 * occasion is not a second opinion.
 */
function fingerprintOf(value: StoredValue): string {
  return JSON.stringify([
    value.attribute,
    value.candidate,
    value.data_source,
    value.breakdown_option ?? null,
    value.reference_period,
    value.payload,
    value.rejection_reason ?? null,
    value.confidence_level ?? null,
  ]);
}

function retrievedAt(value: StoredValue): string {
  return value.retrieval_date;
}

export function foldRepeats(
  values: readonly StoredValue[],
): RepeatedValue[] {
  const byFingerprint = new Map<string, StoredValue[]>();
  // Insertion order is the order the server sent, which the panel already relies on.
  for (const value of values) {
    const key = fingerprintOf(value);
    const seen = byFingerprint.get(key);
    if (seen === undefined) byFingerprint.set(key, [value]);
    else seen.push(value);
  }

  return [...byFingerprint.values()].map((copies) => {
    const newest = copies.reduce((latest, each) =>
      retrievedAt(each) > retrievedAt(latest) ? each : latest,
    );
    const oldest = copies.reduce((earliest, each) =>
      retrievedAt(each) < retrievedAt(earliest) ? each : earliest,
    );
    return {
      value: newest,
      copies: copies.length,
      firstRetrieved: copies.length > 1 ? retrievedAt(oldest) : null,
    };
  });
}

/**
 * How to say "this same figure arrived more than once", in a sentence rather than a count.
 *
 * **No `·` separators and no bare number**: "26" beside a date is two facts chained, which the
 * design rules out. The reader's question is whether anything changed, and the answer is that
 * nothing did.
 *
 * **The date is `formatDate`'s, not this file's.** It hand-rolled `toLocaleDateString` with a
 * guard for a date that could not be read -- a branch nothing reached through the component,
 * because `firstRetrieved` is a `retrieval_date` and the contract makes that a required
 * `date-time`. `CLAUDE.md` rules that worse than no check at all: it reads as a case that
 * happens. The guard is gone and the formatting is delegated to the one place formatting
 * lives, where an unreadable date becomes `—` for every screen at once and a test already
 * covers it.
 *
 * **It also fixes a day that could be wrong.** `toLocaleDateString` with no `timeZone` reads
 * the machine's; `formatDate` pins UTC, as every other date on this panel does. A figure
 * fetched at 08:00Z was printed as the day before, in this sentence only, for any reader west
 * of UTC -- beside a "Fetched" cell naming the right day.
 */
export function describeRepeats(
  copies: number,
  firstRetrieved: string | null,
): string {
  const unchanged = `unchanged across ${String(copies)} acquisitions`;
  if (firstRetrieved === null) return unchanged;
  return `${unchanged}, first on ${formatDate(firstRetrieved)}`;
}
