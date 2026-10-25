/**
 * What changed between two acquisitions.
 *
 * **It compares what the two runs produced, not what the store holds**: the figures each stored
 * and the ones it re-confirmed (PL-049), over the values the later one asked for (PL-060). So
 * "went missing" means the later run asked and produced no usable figure for that pair, never
 * that the figure is gone. The earlier value is still stored, still visible in the drill-down,
 * and may well still be the active one. Saying otherwise would be the screen claiming a deletion
 * this application never performs (`reqs.md` 3.6).
 */

import { describeFigure, type FigureOptions } from "../../format/figure";

export interface Pair {
  candidate: string;
  attribute: string;
}

export interface ProducedValue extends Pair {
  id?: number;
  data_source?: string;
  payload?: unknown;
  rejection_reason?: string | null;
}

/** A figure a run re-read and found already on record. `value` is null where it is not known. */
export interface Reconfirmation extends Pair {
  data_source: string;
  value: number | null;
}

/** What one run produced, as the server serves it: its value rows and its re-confirmations. */
export interface RunRecord {
  stored: readonly ProducedValue[];
  reconfirmed: readonly Reconfirmation[];
  /** The rows `reconfirmed` names, as `GET /values?reconfirmed_by_run=` lists them. */
  reconfirmedValues: readonly ProducedValue[];
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
  data_source?: string | undefined;
  /** The figure as each run produced it, "rejected" where it was. Null where it produced none. */
  earlier: string | null;
  later: string | null;
}

export interface Diff {
  rows: DiffRow[];
  newlyAcquired: number;
  refreshed: number;
  unchanged: number;
  wentMissing: number;
  /** Earlier figures from a source the later run is not recorded as asking for that value. */
  leftOut: number;
}

/**
 * Everything a run produced. **A re-confirmation is a figure the run produced**, restated rather
 * than stored again; where the server does not know which figure it restated, its payload stays
 * unknown, and an unknown figure is never called unchanged (`samePayload`).
 */
export function producedBy(run: RunRecord): ProducedValue[] {
  const restated = new Map(run.reconfirmedValues.map((value) => [value.id, value]));
  return [
    ...run.stored,
    ...run.reconfirmed.map((reconfirmation): ProducedValue => {
      const { candidate, attribute, data_source } = reconfirmation;
      const figure = reconfirmation.value === null ? undefined : restated.get(reconfirmation.value);
      return { ...figure, candidate, attribute, data_source };
    }),
  ];
}

/**
 * What the later run asked each source, as far as its record names a source: a figure it
 * produced (stored, re-confirmed or rejected) and a failure. **A pair and source the record does
 * not name is never called missing** -- another source may have answered the pair, a selective
 * retry may have asked one source alone, and an unanswered or unreached item names no source.
 */
export function askedOfSources(
  produced: readonly ProducedValue[],
  failures: readonly ProducedValue[],
): ProducedValue[] {
  const asked = new Map<string, ProducedValue>();
  for (const each of [...produced, ...failures]) {
    const { candidate, attribute, data_source } = each;
    if (!asked.has(keyOf(each))) asked.set(keyOf(each), { candidate, attribute, data_source });
  }
  return [...asked.values()];
}

/**
 * How many of its items a run's record accounts for: produced, failed on, left unanswered or
 * never reached. Once they partition its items, this is `items_total` (`describeRecord`).
 */
export function accountedFor(
  produced: readonly Pair[],
  run: {
    failures?: readonly Pair[];
    unanswered?: readonly Pair[];
    not_reached?: readonly Pair[];
  },
): number {
  return new Set(
    [
      ...produced,
      ...(run.failures ?? []),
      ...(run.unanswered ?? []),
      ...(run.not_reached ?? []),
    ].map(pairKey),
  ).size;
}

function pairKey(pair: Pair): string {
  return `${pair.candidate}|${pair.attribute}`;
}

/** C04-N8. **The unit is a pair and its source**: two sources answering one pair are two rows. */
function keyOf(value: ProducedValue): string {
  return `${pairKey(value)}|${value.data_source ?? ""}`;
}

/** A rejected figure is no usable figure (C04-N8). */
function usable(value: ProducedValue | undefined): value is ProducedValue {
  return value !== undefined && !value.rejection_reason;
}

function byKey(values: readonly ProducedValue[]): Map<string, ProducedValue> {
  const keyed = new Map<string, ProducedValue>();
  for (const value of values) {
    // A usable figure is never hidden behind a rejected one from the same run.
    if (!usable(value) && usable(keyed.get(keyOf(value)))) continue;
    keyed.set(keyOf(value), value);
  }
  return keyed;
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
  askedOf: readonly ProducedValue[],
): Diff {
  const askedFor = new Set(askedOf.map(keyOf));
  const before = byKey(earlier);
  const after = byKey(later);

  const rows: DiffRow[] = [];
  for (const key of new Set([...after.keys(), ...before.keys()])) {
    const one = before.get(key);
    const other = after.get(key);
    const pair = other ?? one;
    if (pair === undefined || !askedFor.has(key)) continue;
    const change = changeOf(one, other);
    if (change === null) continue;
    rows.push({
      candidate: pair.candidate,
      attribute: pair.attribute,
      data_source: pair.data_source,
      ...change,
    });
  }

  rows.sort(
    (one, other) =>
      ORDER[one.change] - ORDER[other.change] ||
      one.candidate.localeCompare(other.candidate) ||
      one.attribute.localeCompare(other.attribute) ||
      (one.data_source ?? "").localeCompare(other.data_source ?? ""),
  );

  return {
    rows,
    newlyAcquired: rows.filter((row) => row.change === "newly acquired").length,
    refreshed: rows.filter((row) => row.change === "refreshed").length,
    unchanged: rows.filter((row) => row.change === "unchanged").length,
    wentMissing: rows.filter((row) => row.change === "went missing").length,
    leftOut: [...before.values()].filter(
      (value) => usable(value) && !askedFor.has(keyOf(value)),
    ).length,
  };
}

/** What became of one pair and source, or nothing where neither run produced a usable figure. */
function changeOf(
  earlier: ProducedValue | undefined,
  later: ProducedValue | undefined,
): Pick<DiffRow, "change" | "earlier" | "later"> | null {
  if (usable(later)) {
    return usable(earlier)
      ? compared(earlier, later)
      : { change: "newly acquired", earlier: cellOf(earlier), later: figureOf(later) };
  }
  if (usable(earlier)) {
    return { change: "went missing", earlier: figureOf(earlier), later: cellOf(later) };
  }
  return null;
}

/** A side that produced no usable figure: "rejected" where it produced one, else nothing. */
function cellOf(value: ProducedValue | undefined): string | null {
  return value === undefined ? null : "rejected";
}

/** The line under the counts for figures that were not compared, or nothing when none were. */
export function describeLeftOut(leftOut: number): string | null {
  if (leftOut === 0) return null;
  return leftOut === 1
    ? "1 figure from the earlier acquisition is from a source the later one is not recorded as asking for that value, so it is not compared."
    : `${String(leftOut)} figures from the earlier acquisition are from sources the later one is not recorded as asking for those values, so they are not compared.`;
}

/**
 * The values the later run never reached, which are not asked and so not compared. **A run that
 * recorded no plan cannot say it planned them** (`plan_recorded`), only that they are empty.
 */
export function describeNotReached(run: {
  id: number;
  not_reached?: readonly Pair[];
  plan_recorded?: boolean;
}): string | null {
  const count = run.not_reached?.length ?? 0;
  if (count === 0) return null;
  const one = count === 1;
  const values = `${String(count)} ${one ? "value" : "values"} acquisition ${String(run.id)}`;
  if (run.plan_recorded === true) {
    return `${values} planned ${one ? "was" : "were"} never reached, so ${one ? "it is" : "they are"} not compared.`;
  }
  return (
    `${values} was to ask about ${one ? "has" : "have"} neither a figure nor a failure. ` +
    `It started before acquisitions recorded their plan, so whether ${one ? "it was" : "they were"} asked is not known, and ${one ? "it is" : "they are"} not compared.`
  );
}

/**
 * What the later run's record does not account for: still running, or what it accounts for
 * (`accountedFor`) disagreeing with the items it planned. Nothing where they agree.
 */
export function describeRecord(
  accounted: number,
  run: { id: number; run_status: string; progress?: { items_total?: number } },
): string | null {
  if (run.run_status === "running") {
    return `Acquisition ${String(run.id)} is still running, so this compares what it has settled so far.`;
  }
  const total = run.progress?.items_total;
  if (total === undefined || total === accounted) return null;
  return `Acquisition ${String(run.id)}'s record accounts for ${String(accounted)} of the ${String(total)} values it asked for, so this comparison may be incomplete.`;
}

/** Whether the earlier pick started after the later one. Drawn all the same, with a warning. */
export function readsBackwards(
  runs: readonly { id: number; started_at: string }[],
  earlier: number,
  later: number,
): boolean {
  const startOf = (id: number) => runs.find((run) => run.id === id)?.started_at;
  const [from, to] = [startOf(earlier), startOf(later)];
  return from !== undefined && to !== undefined && Date.parse(from) > Date.parse(to);
}

/** The table's first heading: the level the later run covered, as a word. */
export function levelHeading(level: string | undefined): string {
  if (level === undefined || level === "") return "Candidate";
  return level.charAt(0).toUpperCase() + level.slice(1);
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
 * The figure a run produced, as one line, or "not recorded" where its payload is not known -- a
 * re-confirmation the server could not tie to one stored figure.
 *
 * **What a reader sees, not what decides.** Whether a pair moved is the payloads' question
 * (`samePayload`); this only fills the Earlier and Later cells.
 */
function figureOf(value: ProducedValue, options?: FigureOptions): string {
  return value.payload === undefined || value.payload === null
    ? "not recorded"
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
