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
 * comparison does not pre-compute at attribute level -- is taken here, and the raw view's bar
 * borrows its sign, since the scores are what say which side is better. A `.tsx` under
 * `routes/` may not call `Number`, which is why even that subtraction lives in a module.
 */

import { formatSigned } from "../../format/display";
import { EURO } from "../../format/figure";
import { maxAbsDelta } from "./divergingBar";
import { rankInPillar } from "./ordering";

/** Where a figure came from, already in words, and the mark it wears where it is shown. */
export interface Provenance {
  description: string;
  mark: string | null;
}

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
  /** Where the focus's figure came from, or null where it has none. */
  focusProvenance?: Provenance | null;
  /** The unit the server's raw gaps are in when it is not the figure's own: EUR for money,
   *  since the comparison subtracts euro equivalents. Null for every other type. */
  gapUnit: string | null;
  /** What this attribute counted for in the focus's total, as a percentage; absent is unknown. */
  weight?: number | null;
  comparators: readonly {
    candidate: string;
    score: number | null;
    /** Comparator minus focus, in the attribute's own unit (the server's own figure). */
    rawDelta: number | null;
    /** What the score gap is worth to the focus's total, as the server computed it. */
    worth?: number | null;
    figure: string;
    provenance?: Provenance | null;
  }[];
}

export interface AttributeCell {
  candidate: string;
  score: number | null;
  /** The comparator's score minus the focus's, in normalised points. Null where either absent. */
  scoreDelta: number | null;
  /** Comparator minus focus, in the attribute's own unit: the server's figure, printed as is. */
  rawDelta: number | null;
  /**
   * What the raw view's bar is drawn from: the raw gap's size, signed by `scoreDelta`.
   *
   * **A raw gap's sign says which figure is higher, not which is better** -- a higher cost of
   * living is worse, a longer coastline better, and a target band is better from neither side
   * (UI-19). The scores already know every goal, so they decide the direction. Null where
   * either score is missing, the scores tie, or there is no raw gap.
   */
  rawBar: number | null;
  /** What the gap is worth to the focus's total, comparator minus focus; null where unknown. */
  worth: number | null;
  figure: string;
  provenance: Provenance | null;
}

export interface AttributeRow {
  attribute: string;
  pillar: string;
  focusScore: number | null;
  focusRaw: number | null;
  focusFigure: string;
  focusProvenance: Provenance | null;
  gapUnit: string | null;
  /** What the attribute counted for in the focus's total, as a percentage, or null. */
  weight: number | null;
  /** Its place among the pillar's heaviest (0 for the heaviest), or undefined outside them. */
  place: number | undefined;
  cells: AttributeCell[];
  /** The ruler the score-view bars are drawn against, shared across the whole pillar. */
  scoreScale: number;
  /** The ruler the raw-view bars are drawn against, this row's own because units differ. */
  rawScale: number;
  /** The ruler the worth bars are drawn against: the pillar's largest worth. */
  worthScale: number;
}

/**
 * A number buried in a value's payload, whatever shape the type gives it.
 *
 * Used only to judge how large a raw gap is *relative to the figure* -- a 13-point gap on a
 * cost index near 100 is small, on a coastline of 20km it is not. The non-numeric types (a
 * label set, a boolean, free text) have no magnitude to divide by and answer null, which leaves
 * their cells untinted rather than wrongly coloured.
 *
 * **The same number the server subtracts** (`evaluation/magnitudes.py`), or the gap is divided
 * by a figure in another unit. For money that is `amount_eur`, never `amount`: the server's
 * gap is euros, and sizing it against 150,000 forint drew a 130-euro gap on a 380-euro rent as
 * noise (UIR-A2). A payload with no euro amount answers null -- untinted, not wrongly tinted.
 */
export function payloadMagnitude(
  value: { payload?: unknown } | null | undefined,
): number | null {
  const record = payloadOf(value);
  if (record === null) return null;
  for (const key of ["magnitude", "amount_eur", "value", "count"]) {
    const found = record[key];
    if (typeof found === "number" && Number.isFinite(found)) return found;
  }
  return null;
}

/** EUR for a monetary figure, whose raw gap is in euros whatever its own currency; else null. */
export function rawGapUnit(value: { payload?: unknown } | null | undefined): string | null {
  const euros = payloadOf(value)?.["amount_eur"];
  return typeof euros === "number" && Number.isFinite(euros) ? EURO : null;
}

/**
 * A raw gap as printed: signed, at the figures' own precision (PL-093), with its unit where it
 * has one, and absent as absent.
 */
export function rawGapText(delta: number | null, unit: string | null): string {
  const text = formatSigned(delta, "figure");
  return unit === null || delta === null || !Number.isFinite(delta) ? text : `${text} ${unit}`;
}

function payloadOf(value: { payload?: unknown } | null | undefined): Record<string, unknown> | null {
  const payload = value?.payload;
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
}

function scoreDeltaOf(
  score: number | null,
  focusScore: number | null,
): number | null {
  // **Null, not zero, when either side is missing** -- the same rule the pillar matrix keeps.
  // A zero reads as "the same", which is a measurement nobody made.
  return score === null || focusScore === null ? null : score - focusScore;
}

function rawBarOf(
  rawDelta: number | null,
  scoreDelta: number | null,
): number | null {
  if (rawDelta === null || scoreDelta === null || scoreDelta === 0) return null;
  return Math.sign(scoreDelta) * Math.abs(rawDelta);
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
      const scoreDelta = scoreDeltaOf(score, source.focusScore);
      const rawDelta = found?.rawDelta ?? null;
      return {
        candidate,
        score,
        scoreDelta,
        rawDelta,
        rawBar: rawBarOf(rawDelta, scoreDelta),
        worth: found?.worth ?? null,
        figure: found?.figure ?? "",
        provenance: found?.provenance ?? null,
      };
    });

    const row: AttributeRow = {
      attribute: source.attribute,
      pillar: source.pillar,
      focusScore: source.focusScore,
      focusRaw: source.focusRaw,
      focusFigure: source.focusFigure,
      focusProvenance: source.focusProvenance ?? null,
      gapUnit: source.gapUnit,
      weight: source.weight ?? null,
      // Filled once the pillar's rows are all in, as are the rulers shared across them.
      place: undefined,
      cells,
      scoreScale: 0,
      worthScale: 0,
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
    const worthScale = Math.max(
      0,
      ...rows.map((row) => maxAbsDelta(row.cells.map((cell) => ({ delta: cell.worth })))),
    );
    const places = rankInPillar(rows);
    for (const row of rows) {
      row.scoreScale = scoreScale;
      row.worthScale = worthScale;
      row.place = places.get(row.attribute);
    }
  }

  return byPillar;
}
