import type { Comparison } from "../../api/endpoints";
import { formatPercentage, formatScore } from "../../format/display";
import { barStart, divergingBar } from "./divergingBar";
import { pillarMatrix, type MatrixCell } from "./pillarMatrix";
import { formatDelta } from "../rank/rankTable";

/**
 * The focus against its comparators, pillar by pillar.
 *
 * **Differences are per pillar, in score points, never averaged into one verdict**
 * (`reqs.md`). A candidate can be ahead on housing and behind on career, and a single number
 * for "better" would be the application deciding what this household values.
 *
 * **Each cell is a bar that grows both ways from a centre line.** "Better or worse, and by
 * how much" has a sign and a size; a bar anchored at the left can only show size, so the sign
 * has to be read off a minus one cell at a time. Anchored in the middle, a column of them
 * reads as a shape -- which is the whole reason to draw the number twice.
 */
export function ComparisonMatrix({ comparison }: { comparison: Comparison }) {
  const comparators = comparison.comparators ?? [];
  const rows = pillarMatrix(comparison.focus, comparators);

  return (
    <div className="table-card table-card--matrix">
      {/* **The stylesheet never has to know how many candidates there are.** Two explicit
          tracks and then `grid-auto-columns` gives one equal track per candidate, however
          many there are -- which is the comparator limit staying configurable rather than
          being written into a rule here. */}
      <table
        className="table table--matrix"
        aria-label="Every pillar, focus against comparators"
      >
        <thead>
          <tr>
            <th scope="col">Pillar</th>
            <th scope="col">Weight</th>
            <th scope="col">{comparison.focus.name} (focus)</th>
            {comparators.map((each) => (
              <th key={each.candidate} scope="col">
                {each.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className={row.total ? "matrix__row matrix__row--total" : "matrix__row"}
            >
              <th scope="row" className="matrix__label">
                {row.label}
              </th>
              <td className="matrix__weight">
                {row.weight === null ? "—" : formatPercentage(row.weight, 0)}
              </td>
              {/* The focus is the line everything else is measured from, so it carries a
                  score and the word for zero rather than a bar. */}
              <td className="matrix__cell matrix__cell--focus">
                <span className="matrix__score">{formatScore(row.focus)}</span>
                <span className="matrix__delta">baseline</span>
              </td>
              {row.cells.map((cell) => (
                <Cell key={cell.candidate} cell={cell} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ cell }: { cell: MatrixCell }) {
  const bar = divergingBar(cell.delta);

  return (
    <td
      className={
        bar.strength === 0
          ? "matrix__cell"
          : `matrix__cell matrix__cell--${bar.direction}-${String(bar.strength)}`
      }
    >
      <span className="matrix__score">{formatScore(cell.score)}</span>
      <span className={`matrix__delta matrix__delta--${bar.direction}`}>
        {cell.delta === null ? "—" : formatDelta(cell.delta)}
      </span>
      {/* **SVG, so the geometry is a datum and the colour is still a class.** A 100-wide
          track with the centre marked: the tick is what makes a short bar readable as
          "barely ahead" rather than as "nearly nothing". */}
      <svg
        className="matrix__track"
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect className="matrix__tick" x="49.5" width="1" height="6" />
        {bar.direction !== "level" && (
          <rect
            className={`matrix__fill matrix__fill--${bar.direction}`}
            x={barStart(bar)}
            width={bar.reach}
            height="6"
          />
        )}
      </svg>
    </td>
  );
}
