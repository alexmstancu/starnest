/**
 * The geometry and the strength of a comparison cell: how far ahead or behind, drawn from a
 * centre line.
 *
 * **A bar that grows both ways is the shape of the question.** "Is Denmark better or worse
 * than Portugal on housing, and by how much" has a sign and a size, and a bar anchored at the
 * left can only show size -- the sign has to be read off a minus in the text, one cell at a
 * time. Anchored in the middle, a column of them reads as a shape.
 *
 * **One ruler for size, one floor for noise.** The bar's reach is measured against the largest
 * gap *on the screen* (`scale`), so a column of bars shows which differences are big relative to
 * the rest -- the same five-point gap looks large in a table of small gaps and small in a table
 * of large ones, which is what a reader comparing places actually wants. **The tint deepens with
 * that same reach**, across a range wide enough to see, so a longer bar is always a stronger
 * tint and two long gaps of different lengths never share one colour. That is a divergence from
 * the design, whose tint tops out at a gap of 30% of the focus's figure and so painted every
 * large gap alike (`docs/design-brief.md`). Whether a cell is tinted at all is still the
 * design's call, judged against the *focus's own value* (`focusValue`): a five-point gap on a
 * figure of ten is half of it, on a figure of ninety it is noise, and only the first is worth
 * colouring.
 *
 * A `.tsx` under `routes/` may not call `Number` (`CLAUDE.md`), so the arithmetic is here.
 */

/** The bar's three colours, from a short reach to a full one (the design's `RAMP`). */
export type Shade = "pale" | "mid" | "deep";

/**
 * The bar's colour as one shade over another: `over` at `amount` opacity on `base`, which is the
 * design's linear blend between two neighbouring stops, drawn as two rects so the colours stay in
 * `styles.css` and only the blend is data.
 */
export interface BarShade {
  base: Shade;
  over: Shade;
  amount: number;
}

/** Which way a cell goes, and how it is drawn, for the bar and the tint layers. */
export interface Divergence {
  /** Ahead of the focus, behind it, or level -- which is also the colour. */
  direction: "ahead" | "behind" | "level";
  /**
   * Whether there is a gap to read at all. False where either side has no figure, and then no
   * track is drawn, as the design draws none; an exact tie is gauged, on a track with no bar.
   */
  gauged: boolean;
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
   * How opaque the tint is, 0 to 1, deepening with the bar's reach.
   *
   * **Continuous, and still not a style.** The hue is a class on the tint layer; only the
   * alpha is data, carried as SVG's `fill-opacity` attribute -- so design stays in
   * `styles.css` and the cell can still say "slightly" rather than only "somewhat".
   */
  alpha: number;
  /** A border, in the top of the range only, where the cell is making a real claim. */
  edge: boolean;
  /** The border's opacity, in the tint's hue: 0 without one, deeper the stronger the claim. */
  borderAlpha: number;
  /** **The bar's colour deepens with its reach**, so a longer gap is also a darker one. */
  shade: BarShade;
  /**
   * The gap is below the threshold worth colouring, so the figure and its delta are muted and
   * nothing is tinted -- an exact tie included. Not where there is no gap to read: whether a
   * missing figure is muted depends on whose figure is missing, which the cell knows.
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
/**
 * The faintest tint worth drawing, and the span it deepens across with the bar to the strongest.
 * Wider than the design's 0.33: across that, bars a quarter of the scale apart drew tints the
 * eye could not tell apart.
 */
const FAINT_ALPHA = 0.09;
const RAMP_ALPHA = 0.45;
/** Past this share of the largest gap the cell takes a border as well. */
const EMPHATIC = 0.6;
/** The smallest bar drawn for a non-zero gap, so a real difference is never invisible. */
const MIN_WIDTH = 1.5;
/** A reach below this share of the scale is drawn softer. */
const SHORT = 0.22;
const SHORT_OPACITY = 0.62;
/** The border's opacity at the bottom of the top band, and the span it deepens across. */
const BORDER_ALPHA = 0.45;
const BORDER_RAMP = 0.35;
/** How the bar's colour follows its reach: `reach ** 0.7`, so short bars darken quickly. */
const SHADE_CURVE = 0.7;
const SHADES: readonly Shade[] = ["pale", "mid", "deep"];

const LEVEL: Divergence = {
  direction: "level",
  gauged: true,
  width: 0,
  left: 50,
  alpha: 0,
  edge: false,
  borderAlpha: 0,
  shade: { base: "pale", over: "mid", amount: 0 },
  faint: true,
  barOpacity: 1,
};

const NO_GAP: Divergence = { ...LEVEL, gauged: false, faint: false };

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
  if (!isFiniteNumber(delta)) return NO_GAP;
  if (delta === 0) return LEVEL;

  const size = Math.abs(delta);
  const direction = delta > 0 ? "ahead" : "behind";

  const reach = scale > 0 ? Math.min(1, size / scale) : 0;
  const width = Math.max(MIN_WIDTH, reach * 50);
  const left = direction === "behind" ? 50 - width : 50;
  const barOpacity = reach < SHORT ? SHORT_OPACITY : 1;

  const anchor = isFiniteNumber(focusValue) ? Math.abs(focusValue) : 0;
  const relative = anchor > 0 ? size / anchor : 0;
  const lit = relative >= NOTICEABLE;
  const emphatic = lit && reach >= EMPHATIC;

  return {
    direction,
    gauged: true,
    width,
    left,
    barOpacity,
    alpha: lit ? FAINT_ALPHA + reach * RAMP_ALPHA : 0,
    edge: emphatic,
    borderAlpha: emphatic ? BORDER_ALPHA + BORDER_RAMP * reach : 0,
    faint: !lit,
    shade: shadeOf(reach),
  };
}

/**
 * The bar's colour for a reach: the design's three stops, pale to deep, with `reach ** 0.7`
 * blended linearly between the two it falls between.
 */
function shadeOf(reach: number): BarShade {
  const position = Math.min(0.999, Math.max(0, reach ** SHADE_CURVE)) * 2;
  const step = Math.floor(position);
  return {
    base: SHADES[step] ?? "pale",
    over: SHADES[step + 1] ?? "deep",
    amount: position - step,
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
