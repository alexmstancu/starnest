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

import { describeFigure, type FigureOptions } from "../../format/figure";

export interface ProducedValue {
  candidate: string;
  attribute: string;
  data_source?: string;
  retrieval_date?: string | null;
  payload?: unknown;
}

/**
 * **"Refreshed" and "unchanged" are different answers to the question this panel asks.**
 * A run that re-fetched a thousand figures and moved none of them is a run that cost
 * something and changed nothing, and a single "refreshed" count hides exactly that. They were
 * one word until the figures themselves were read, because without the figures they could not
 * be told apart.
 */
export type Change =
  | "newly acquired"
  | "refreshed"
  | "unchanged"
  | "went missing";

export interface DiffRow {
  candidate: string;
  attribute: string;
  change: Change;
  /** The source that answered in the later run, or in the earlier one when it went missing. */
  data_source?: string | undefined;
  /** The figure as each run produced it. Null where that run produced none. */
  earlier: string | null;
  later: string | null;
}

export interface Diff {
  rows: DiffRow[];
  newlyAcquired: number;
  refreshed: number;
  unchanged: number;
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
  // Last, and deliberately: a figure that did not move is the one row nobody has to act on.
  unchanged: 3,
};

export function diffAcquisitions(
  earlier: readonly ProducedValue[],
  later: readonly ProducedValue[],
): Diff {
  const before = byPair(earlier);
  const after = byPair(later);

  const rows: DiffRow[] = [];
  for (const [key, value] of after) {
    const earlier = before.get(key);
    rows.push({
      candidate: value.candidate,
      attribute: value.attribute,
      data_source: value.data_source,
      ...(earlier === undefined
        ? { change: "newly acquired", earlier: null, later: figureOf(value) }
        : compared(earlier, value)),
    });
  }
  for (const [key, value] of before) {
    if (after.has(key)) continue;
    rows.push({
      candidate: value.candidate,
      attribute: value.attribute,
      change: "went missing",
      data_source: value.data_source,
      earlier: figureOf(value),
      later: null,
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
    unchanged: rows.filter((row) => row.change === "unchanged").length,
    wentMissing: rows.filter((row) => row.change === "went missing").length,
  };
}

/**
 * A pair both runs produced: whether its figure moved, and the two figures that show it.
 *
 * **Decided on the stored payloads, never on their display** (UI-22). The figures are printed
 * to two decimals, so a move smaller than that read the same on both sides and was called
 * unchanged. Where that happens the two are shown exactly, so "refreshed" beside two figures
 * stays checkable rather than trusted -- a converted amount that moved in euros alone, at a
 * fresher exchange rate, with its euro equivalent, and an assigned score given again for
 * another reason with its reason (NEW-39).
 */
function compared(
  earlier: ProducedValue,
  later: ProducedValue,
): Pick<DiffRow, "change" | "earlier" | "later"> {
  const shown = { earlier: figureOf(earlier), later: figureOf(later) };
  if (samePayload(earlier.payload, later.payload)) {
    return { change: "unchanged", ...shown };
  }
  return shown.earlier === shown.later
    ? {
        change: "refreshed",
        earlier: figureOf(earlier, { exact: true }),
        later: figureOf(later, { exact: true }),
      }
    : { change: "refreshed", ...shown };
}

/**
 * **Unchanged is a claim, and it is only made when both figures were readable.**
 *
 * Where either side produced no payload the answer is "refreshed" -- the weaker statement that
 * a pair which already had a figure got one again. Calling two unreadable figures identical
 * would be the screen inventing agreement out of ignorance, which is the one thing this
 * application exists not to do.
 *
 * **One test for all ten value types**: the same keys holding the same values, whatever order
 * the keys arrive in. A list keeps its order, because that is the order the source served.
 */
function samePayload(earlier: unknown, later: unknown): boolean {
  return (
    earlier !== undefined &&
    earlier !== null &&
    later !== undefined &&
    later !== null &&
    sameShape(earlier, later)
  );
}

function sameShape(one: unknown, other: unknown): boolean {
  if (one === other) return true;
  if (Array.isArray(one) || Array.isArray(other)) {
    return (
      Array.isArray(one) &&
      Array.isArray(other) &&
      one.length === other.length &&
      one.every((each, at) => sameShape(each, other[at]))
    );
  }
  if (
    typeof one !== "object" ||
    typeof other !== "object" ||
    one === null ||
    other === null
  ) {
    return false;
  }
  const ones = one as Record<string, unknown>;
  const others = other as Record<string, unknown>;
  const keys = Object.keys(ones);
  return (
    keys.length === Object.keys(others).length &&
    keys.every((key) => Object.hasOwn(others, key) && sameShape(ones[key], others[key]))
  );
}

/**
 * The figure a run produced, as one line, or nothing where it produced no payload.
 *
 * **What a reader sees, not what decides.** Whether a pair moved is the payloads' question
 * (`samePayload`); this only fills the Earlier and Later cells.
 */
function figureOf(
  value: ProducedValue,
  options?: FigureOptions,
): string | null {
  return value.payload === undefined || value.payload === null
    ? null
    : describeFigure({ payload: value.payload }, options);
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

/** What `progressOf` reads of a run: where it stands, never what it stored. */
interface RunProgress {
  id: number;
  run_status: string;
  items_completed?: number;
  items_failed?: number;
}

/**
 * Where the compared runs stand, as a key that changes only when one of them may have moved on.
 *
 * **A run still going keeps storing figures; one that has finished never will again** (UIR-A1).
 * The diff stays on screen through every re-read of the history (NEW-11), so it reads its two
 * runs again when this changes -- a status, a count of items done or failed, and, for a run still
 * going, every read of the history (`historyReads`). Its counts cover distinct pairs, reused
 * ones included, so another source's figure for a pair already counted moves no counter (RB-3).
 * A finished comparison is never read again for nothing.
 */
export function progressOf(
  runs: readonly RunProgress[],
  ids: readonly (number | null)[],
  historyReads = 0,
): string {
  return ids
    .map((id) => {
      const run = runs.find((each) => each.id === id);
      if (run === undefined) return `${String(id)}:?`;
      const counts = `${String(run.items_completed ?? "")}:${String(run.items_failed ?? "")}`;
      const going = run.run_status === "running" ? `:read${String(historyReads)}` : "";
      return `${String(id)}:${run.run_status}:${counts}${going}`;
    })
    .join("|");
}
