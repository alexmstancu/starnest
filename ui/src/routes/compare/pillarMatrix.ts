/**
 * The comparison matrix: one row per pillar, one column per candidate, and the total on top.
 *
 * **Every number here came from the server.** A candidate's pillar scores and its total arrive
 * with the comparison; this pairs them up and subtracts, which is the one arithmetic the
 * design asks the interface to do -- and doing it here rather than in the markup is what the
 * `Number` rule in `CLAUDE.md` is for.
 *
 * **Differences are per pillar, in score points, never averaged into one verdict.** That is
 * the screen's whole claim: a candidate can be ahead on housing and behind on career, and a
 * single number for "better" would be the application deciding what the household values.
 */

/** One pillar's part in a candidate's total, as the comparison serves it. */
export interface PillarScore {
  pillar: string;
  score?: number | null;
  weight: number;
  /** score x weight / 100: what this pillar actually put into the total. */
  contribution?: number | null;
}

/** A candidate as the comparison serves it: a total and its pillars. */
export interface Compared {
  candidate: string;
  name: string;
  score?: number | null;
  pillar_scores?: readonly PillarScore[] | null;
}

export interface MatrixCell {
  candidate: string;
  score: number | null;
  /** Against the focus, in score points. Null for the focus itself and where either is absent. */
  delta: number | null;
}

export interface MatrixRow {
  /** The pillar's own id, used to group its attributes under it. Null for the total row. */
  pillar: string | null;
  /** The pillar, or "Total score" for the row the design puts first. */
  label: string;
  /** What this row is worth, as a percentage. The total row is the whole 100. */
  weight: number | null;
  /** Whether this is the summary row, which the design separates from the rest. */
  total: boolean;
  focus: number | null;
  cells: MatrixCell[];
}

function scoreOf(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cellsFor(
  comparators: readonly Compared[],
  focusScore: number | null,
  scoreIn: (candidate: Compared) => number | null,
): MatrixCell[] {
  return comparators.map((comparator) => {
    const score = scoreIn(comparator);
    return {
      candidate: comparator.candidate,
      score,
      // **Null, not zero, when either side is missing.** A zero delta reads as "the same",
      // which is a measurement nobody made.
      delta: score === null || focusScore === null ? null : score - focusScore,
    };
  });
}

/**
 * The matrix, total first.
 *
 * The pillars are taken from the focus, in the order the server sent them, so every row is a
 * pillar the focus was actually scored on and the order is the catalog's rather than
 * whichever candidate happened to be read first.
 */
/**
 * What a cell reads, and therefore what a difference between two cells means.
 *
 * **Points and impact answer different questions.** A pillar can be 30 points better and
 * barely move the total because it is weighted at 4%, and a reader deciding between two
 * places needs both answers -- which is why the design makes it a choice rather than picking
 * one.
 */
export type Measure = "points" | "impact";

export function pillarMatrix(
  focus: Compared,
  comparators: readonly Compared[],
  measure: Measure = "points",
  /**
   * What to call each pillar. Passed in rather than looked up, so this module stays a pure
   * function of its arguments -- it has no React in it and must not grow any.
   */
  name: (pillar: string) => string = (pillar) => pillar,
): MatrixRow[] {
  const focusTotal = scoreOf(focus.score);
  const total: MatrixRow = {
    pillar: null,
    label: "Total score",
    weight: 100,
    total: true,
    focus: focusTotal,
    cells: cellsFor(comparators, focusTotal, (each) => scoreOf(each.score)),
  };

  // Which number each cell carries. **The server's either way**: `contribution` is
  // `score x weight / 100`, computed by `evaluation/` and sent with the comparison, so
  // switching the measure changes which figure is read rather than doing arithmetic here.
  const readingOf = (pillar: PillarScore | undefined): number | null =>
    pillar === undefined
      ? null
      : measure === "impact"
        ? scoreOf(pillar.contribution)
        : scoreOf(pillar.score);

  const rows = (focus.pillar_scores ?? []).map((pillar) => {
    const here = readingOf(pillar);
    return {
      pillar: pillar.pillar,
      label: name(pillar.pillar),
      weight: pillar.weight,
      total: false,
      focus: here,
      cells: cellsFor(comparators, here, (each) =>
        readingOf(
          (each.pillar_scores ?? []).find(
            (theirs) => theirs.pillar === pillar.pillar,
          ),
        ),
      ),
    };
  });

  return [total, ...rows];
}

/** How many pillars the design marks as priorities, by weight. */
const PRIORITY_COUNT = 3;

/**
 * The heaviest pillars, ranked, so the matrix can mark the few the household weighted most.
 *
 * **Weight is the one number the reader set most deliberately** (`reqs.md` Q82), so the rows
 * carrying the most of it are the ones to foreground. Returns a map from pillar id to its place
 * (0 for the heaviest), holding only the top few; everything else is absent rather than ranked.
 * Ties are broken by the order the pillars arrived, which is the catalog's.
 */
export function pillarPriority(
  focus: Compared,
  count: number = PRIORITY_COUNT,
): ReadonlyMap<string, number> {
  const ranked = (focus.pillar_scores ?? [])
    .map((pillar) => ({ pillar: pillar.pillar, weight: pillar.weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, count);
  return new Map(ranked.map((entry, place) => [entry.pillar, place]));
}
