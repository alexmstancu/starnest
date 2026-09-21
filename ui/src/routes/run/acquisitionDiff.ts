/**
 * What changed between two acquisitions.
 *
 * **It compares what the two runs produced, not what the store holds.** A value keeps the run
 * that produced it for the life of the row, so this is a question about two runs rather than
 * about the database — and "went missing" means the later run did not produce a figure for
 * that pair, never that the figure is gone. The earlier value is still stored, still visible
 * in the drill-down, and may well still be the active one. Saying otherwise would be the
 * screen claiming a deletion this application never performs (`reqs.md` 3.6).
 */

export interface ProducedValue {
  candidate: string;
  attribute: string;
  data_source?: string;
  retrieval_date?: string | null;
}

export type Change = "newly acquired" | "refreshed" | "went missing";

export interface DiffRow {
  candidate: string;
  attribute: string;
  change: Change;
  /** The source that answered in the later run, or in the earlier one when it went missing. */
  data_source?: string | undefined;
}

export interface Diff {
  rows: DiffRow[];
  newlyAcquired: number;
  refreshed: number;
  wentMissing: number;
}

/** A pair is the unit: one candidate, one attribute. */
function keyOf(value: ProducedValue): string {
  return `${value.candidate}|${value.attribute}`;
}

function byPair(values: readonly ProducedValue[]): Map<string, ProducedValue> {
  // Last wins, which is only reached when one run produced two figures for one pair -- from
  // two sources. Either answers the question this screen asks, which is whether the run
  // produced anything for that pair at all.
  return new Map(values.map((value) => [keyOf(value), value]));
}

/**
 * The difference, sorted so the same two runs always read the same way.
 *
 * Ordered by what the reader is looking for rather than alphabetically: what appeared, what
 * moved, and what stopped coming.
 */
const ORDER: Record<Change, number> = {
  "newly acquired": 0,
  refreshed: 1,
  "went missing": 2,
};

export function diffAcquisitions(
  earlier: readonly ProducedValue[],
  later: readonly ProducedValue[],
): Diff {
  const before = byPair(earlier);
  const after = byPair(later);

  const rows: DiffRow[] = [];
  for (const [key, value] of after) {
    rows.push({
      candidate: value.candidate,
      attribute: value.attribute,
      change: before.has(key) ? "refreshed" : "newly acquired",
      data_source: value.data_source,
    });
  }
  for (const [key, value] of before) {
    if (after.has(key)) continue;
    rows.push({
      candidate: value.candidate,
      attribute: value.attribute,
      change: "went missing",
      data_source: value.data_source,
    });
  }

  rows.sort(
    (one, other) =>
      ORDER[one.change] - ORDER[other.change] ||
      one.candidate.localeCompare(other.candidate) ||
      one.attribute.localeCompare(other.attribute),
  );

  return {
    rows,
    newlyAcquired: rows.filter((row) => row.change === "newly acquired").length,
    refreshed: rows.filter((row) => row.change === "refreshed").length,
    wentMissing: rows.filter((row) => row.change === "went missing").length,
  };
}

/**
 * The run a select's value names, or nothing for the empty choice.
 *
 * Here rather than in the panel because a `.tsx` under `routes/` may not call `Number` --
 * text becoming a number is the panel's own module's job, not its markup's.
 */
export function runIdFrom(chosen: string): number | null {
  if (chosen.trim() === "") return null;
  const run = Number(chosen);
  return Number.isInteger(run) ? run : null;
}
