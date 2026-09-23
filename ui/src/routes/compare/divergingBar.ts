/**
 * The geometry and the strength of a comparison cell: how far ahead or behind, drawn from a
 * centre line.
 *
 * **A bar that grows both ways is the shape of the question.** "Is Denmark better or worse
 * than Portugal on housing, and by how much" has a sign and a size, and a bar anchored at the
 * left can only show size -- the sign has to be read off a minus in the text, one cell at a
 * time. Anchored in the middle, a column of them reads as a shape.
 *
 * A `.tsx` under `routes/` may not call `Number` (`CLAUDE.md`), so the arithmetic is here.
 */

/** Which way a cell goes, and how strongly, for the layer that tints it. */
export interface Divergence {
  /** Ahead of the focus, behind it, or level -- which is also the colour. */
  direction: "ahead" | "behind" | "level";
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
  /** Half-width of the bar as a percentage of the track, 0 to 50. */
  reach: number;
}

/** Below this the difference is noise, and a tint would claim it is not. */
const NOISE = 5;
/** Where the tint stops getting stronger, and where the bar reaches the end of its half. */
const FULL = 30;

/** The faintest tint worth drawing, and the strongest the design goes to. */
const FAINT = 0.09;
const STRONGEST = 0.42;

/** Past this share of the range the cell takes a border as well as a tint. */
const EMPHATIC = 0.66;

const LEVEL: Divergence = {
  direction: "level",
  alpha: 0,
  edge: false,
  reach: 0,
};

/**
 * A cell's divergence from the focus.
 *
 * `delta` is in score points, so it is already on the same scale for every attribute --
 * which is what makes one column of bars comparable with the next.
 */
export function divergingBar(delta: number | null | undefined): Divergence {
  if (typeof delta !== "number" || !Number.isFinite(delta) || delta === 0) {
    return LEVEL;
  }
  const size = Math.abs(delta);
  const direction = delta > 0 ? "ahead" : "behind";
  // The bar is drawn for any difference at all; only the tint waits for one worth noticing.
  const reach = Math.min(50, (size / FULL) * 50);
  if (size < NOISE) return { direction, alpha: 0, edge: false, reach };
  const share = Math.min(1, (size - NOISE) / (FULL - NOISE));
  return {
    direction,
    alpha: FAINT + share * (STRONGEST - FAINT),
    edge: share > EMPHATIC,
    reach,
  };
}

/** Where the bar starts on a 100-wide track, given which way it goes. */
export function barStart(bar: Divergence): number {
  return bar.direction === "behind" ? 50 - bar.reach : 50;
}
