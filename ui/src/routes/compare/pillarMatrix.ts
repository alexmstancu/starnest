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
export function pillarMatrix(
  focus: Compared,
  comparators: readonly Compared[],
): MatrixRow[] {
  const focusTotal = scoreOf(focus.score);
  const total: MatrixRow = {
    label: "Total score",
    weight: 100,
    total: true,
    focus: focusTotal,
    cells: cellsFor(comparators, focusTotal, (each) => scoreOf(each.score)),
  };

  const rows = (focus.pillar_scores ?? []).map((pillar) => {
    const here = scoreOf(pillar.score);
    return {
      label: pillar.pillar,
      weight: pillar.weight,
      total: false,
      focus: here,
      cells: cellsFor(comparators, here, (each) =>
        scoreOf(
          (each.pillar_scores ?? []).find(
            (theirs) => theirs.pillar === pillar.pillar,
          )?.score,
        ),
      ),
    };
  });

  return [total, ...rows];
}
