/**
 * The attributes under a pillar, as the inline drill-down needs them.
 *
 * **The matrix row is the shape of the answer; its attributes are the evidence for it**
 * (`reqs.md` 8.5). Opening a pillar shows the figures that made its score, in the same columns
 * as the pillar row above -- so the pure work here is grouping the server's attributes under
 * their pillar, pairing each comparator with the focus, and working out the two deltas a cell
 * can read: the gap in normalised points, and the gap in the figure's own unit.
 *
 * **No arithmetic the server already did is redone.** The raw-unit delta arrives on the wire
 * (`ComparisonAttributeRow.comparators[].delta`); only the score delta -- a subtraction the
 * comparison does not pre-compute at attribute level -- is taken here. A `.tsx` under `routes/`
 * may not call `Number`, which is why even that subtraction lives in a module.
 */

import { maxAbsDelta } from "./divergingBar";

/**
 * One attribute as the drill-down receives it, already reduced to numbers and display strings
 * by the caller.
 *
 * **The figure strings are passed through, not built here.** Turning a `Value` into words is
 * `format/figure`'s job and needs the contract's types; this module stays a pure function of
 * plain data with no imports from `api/`, so the strings travel as opaque text.
 */
export interface AttributeSource {
  attribute: string;
  pillar: string;
  /** The focus's normalised score for this attribute, or null where it has no figure. */
  focusScore: number | null;
  /** The focus's figure as a bare magnitude, for judging a gap's relative size. Null when it
   *  has no numeric magnitude (a label set, a boolean) or no figure at all. */
  focusRaw: number | null;
  /** The focus's figure in words, already formatted. */
  focusFigure: string;
  comparators: readonly {
    candidate: string;
    score: number | null;
    /** Focus minus comparator, in the attribute's own unit (the server's own figure). */
    rawDelta: number | null;
    figure: string;
  }[];
}

export interface AttributeCell {
  candidate: string;
  score: number | null;
  /** The comparator's score minus the focus's, in normalised points. Null where either absent. */
  scoreDelta: number | null;
  rawDelta: number | null;
  figure: string;
}

export interface AttributeRow {
  attribute: string;
  pillar: string;
  focusScore: number | null;
  focusRaw: number | null;
  focusFigure: string;
  cells: AttributeCell[];
  /** The ruler the score-view bars are drawn against, shared across the whole pillar. */
  scoreScale: number;
  /** The ruler the raw-view bars are drawn against, this row's own because units differ. */
  rawScale: number;
}

/**
 * A number buried in a value's payload, whatever shape the type gives it.
 *
 * Used only to judge how large a raw gap is *relative to the figure* -- a 13-point gap on a
 * cost index near 100 is small, on a coastline of 20km it is not. The non-numeric types (a
 * label set, a boolean, free text) have no magnitude to divide by and answer null, which leaves
 * their cells untinted rather than wrongly coloured.
 */
export function payloadMagnitude(
  value: { payload?: unknown } | null | undefined,
): number | null {
  const payload = value?.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["magnitude", "amount", "value", "count"]) {
    const found = record[key];
    if (typeof found === "number" && Number.isFinite(found)) return found;
  }
  return null;
}

function scoreDeltaOf(
  score: number | null,
  focusScore: number | null,
): number | null {
  // **Null, not zero, when either side is missing** -- the same rule the pillar matrix keeps.
  // A zero reads as "the same", which is a measurement nobody made.
  return score === null || focusScore === null ? null : score - focusScore;
}

/**
 * The attributes grouped under their pillar, in the column order the matrix header sets.
 *
 * `comparatorOrder` is the list of comparator ids the matrix draws left to right; cells are
 * emitted in that order so an attribute row lines up under the pillar row above it, whatever
 * order the server happened to send the comparators in.
 */
export function attributeGroups(
  sources: readonly AttributeSource[],
  comparatorOrder: readonly string[],
): ReadonlyMap<string, AttributeRow[]> {
  const byPillar = new Map<string, AttributeRow[]>();

  for (const source of sources) {
    const cells: AttributeCell[] = comparatorOrder.map((candidate) => {
      const found = source.comparators.find(
        (each) => each.candidate === candidate,
      );
      const score = found?.score ?? null;
      return {
        candidate,
        score,
        scoreDelta: scoreDeltaOf(score, source.focusScore),
        rawDelta: found?.rawDelta ?? null,
        figure: found?.figure ?? "",
      };
    });

    const row: AttributeRow = {
      attribute: source.attribute,
      pillar: source.pillar,
      focusScore: source.focusScore,
      focusRaw: source.focusRaw,
      focusFigure: source.focusFigure,
      cells,
      // Filled once the pillar's rows are all in, since the score ruler is shared across them.
      scoreScale: 0,
      rawScale: maxAbsDelta(cells.map((cell) => ({ delta: cell.rawDelta }))),
    };

    byPillar.set(source.pillar, [...(byPillar.get(source.pillar) ?? []), row]);
  }

  for (const rows of byPillar.values()) {
    const scoreScale = Math.max(
      0,
      ...rows.map((row) =>
        maxAbsDelta(row.cells.map((cell) => ({ delta: cell.scoreDelta }))),
      ),
    );
    for (const row of rows) row.scoreScale = scoreScale;
  }

  return byPillar;
}
