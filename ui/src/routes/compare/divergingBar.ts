/**
 * The geometry and the strength of a comparison cell: how far ahead or behind, drawn from a
 * centre line.
 *
 * **A bar that grows both ways is the shape of the question.** "Is Denmark better or worse
 * than Portugal on housing, and by how much" has a sign and a size, and a bar anchored at the
 * left can only show size -- the sign has to be read off a minus in the text, one cell at a
 * time. Anchored in the middle, a column of them reads as a shape.
 *
 * **Two denominators, two jobs.** The bar's reach is measured against the largest gap *on the
 * screen* (`scale`), so a column of bars shows which differences are big relative to the rest
 * -- the same five-point gap looks large in a table of small gaps and small in a table of large
 * ones, which is what a reader comparing places actually wants. The tint, in contrast, is
 * measured against the *focus's own value* (`focusValue`): a five-point gap on a figure of ten
 * is half of it, on a figure of ninety it is noise, and only the first is worth colouring.
 *
 * A `.tsx` under `routes/` may not call `Number` (`CLAUDE.md`), so the arithmetic is here.
 */

/** Which way a cell goes, and how it is drawn, for the bar and the tint layers. */
export interface Divergence {
  /** Ahead of the focus, behind it, or level -- which is also the colour. */
  direction: "ahead" | "behind" | "level";
  /**
   * The bar's drawn width, as a percentage of the track (0 to 50).
   *
   * At least `MIN_WIDTH` whenever there is any gap at all, so a real but tiny difference still
   * shows a stub rather than vanishing; zero only when the two sides are exactly level.
   */
  width: number;
  /** The bar's left edge on a 100-wide track: the centre going right, back from it going left. */
  left: number;
  /**
   * How opaque the tint is, 0 to 1, ramping with the size of the difference.
   *
   * **Continuous, and still not a style.** The hue is a class on the tint layer; only the
   * alpha is data, carried as SVG's `fill-opacity` attribute -- so design stays in
   * `styles.css` and the cell can still say "slightly" rather than only "somewhat".
   */
  alpha: number;
  /** A border, in the top of the range only, where the cell is making a real claim. */
  edge: boolean;
  /**
   * The gap is real but below the threshold worth colouring, so the delta text is muted and
   * nothing is tinted. Distinct from `level`: level is "the same", faint is "barely apart".
   */
  faint: boolean;
  /**
   * The bar's own opacity: a short reach is drawn softer, so a near-level column does not read
   * as a row of confident claims. Geometry, not hue, so it stays a datum on the rect.
   */
  barOpacity: number;
}

/** Below this share of the focus's value a difference is noise, and a tint would claim it is not. */
const NOTICEABLE = 0.05;
/** Where the tint stops getting stronger, as a share of the focus's value. */
const FULL = 0.3;
/** The faintest tint worth drawing, and the span it ramps across to the strongest. */
const FAINT_ALPHA = 0.09;
const RAMP_ALPHA = 0.33;
/** Past this much of the tint's ramp the cell takes a border as well. */
const EMPHATIC = 0.6;
/** The smallest bar drawn for a non-zero gap, so a real difference is never invisible. */
const MIN_WIDTH = 1.5;
/** A reach below this share of the scale is drawn softer. */
const SHORT = 0.22;
const SHORT_OPACITY = 0.62;

const LEVEL: Divergence = {
  direction: "level",
  width: 0,
  left: 50,
  alpha: 0,
  edge: false,
  faint: true,
  barOpacity: 1,
};

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A cell's divergence from the focus.
 *
 * `scale` is the largest absolute delta the whole set of cells carries, so every bar is drawn
 * against the same ruler and one column is comparable with the next. `focusValue` is what the
 * focus itself reads on this row, against which the gap's *relative* size -- and so the tint --
 * is judged.
 */
export function divergingBar(
  delta: number | null | undefined,
  scale: number,
  focusValue: number | null | undefined,
): Divergence {
  if (!isFiniteNumber(delta) || delta === 0) return LEVEL;

  const size = Math.abs(delta);
  const direction = delta > 0 ? "ahead" : "behind";

  const reach = scale > 0 ? Math.min(1, size / scale) : 0;
  const width = Math.max(MIN_WIDTH, reach * 50);
  const left = direction === "behind" ? 50 - width : 50;
  const barOpacity = reach < SHORT ? SHORT_OPACITY : 1;

  const anchor = isFiniteNumber(focusValue) ? Math.abs(focusValue) : 0;
  const relative = anchor > 0 ? size / anchor : 0;
  const lit = relative >= NOTICEABLE;
  const ramp = lit ? Math.min(1, (relative - NOTICEABLE) / (FULL - NOTICEABLE)) : 0;

  return {
    direction,
    width,
    left,
    barOpacity,
    alpha: lit ? FAINT_ALPHA + ramp * RAMP_ALPHA : 0,
    edge: lit && ramp >= EMPHATIC,
    faint: !lit,
  };
}

/** The largest absolute delta across a set of cells: the ruler every bar in it is drawn against. */
export function maxAbsDelta(
  cells: readonly { delta: number | null }[],
): number {
  let largest = 0;
  for (const cell of cells) {
    if (isFiniteNumber(cell.delta)) largest = Math.max(largest, Math.abs(cell.delta));
  }
  return largest;
}
