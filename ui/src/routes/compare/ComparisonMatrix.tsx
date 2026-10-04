import { useState } from "react";
import type { Comparison } from "../../api/endpoints";
import {
  ABSENT,
  attributeName,
  formatPercentage,
  formatScore,
  formatSigned,
  pillarName,
} from "../../format/display";
import { describeFigure } from "../../format/figure";
import { formatDelta } from "../rank/rankTable";
import { useAttributeNames } from "../../api/useAttributeNames";
import { usePillarNames } from "../../api/usePillarNames";
import { divergingBar, maxAbsDelta, type Divergence } from "./divergingBar";
import { pillarMatrix, pillarPriority, type MatrixCell } from "./pillarMatrix";
import {
  attributeGroups,
  payloadMagnitude,
  type AttributeRow,
} from "./attributeRows";
import type { Measure } from "./pillarMatrix";

/**
 * The focus against its comparators, pillar by pillar, with each pillar opening to its figures.
 *
 * **Differences are per pillar, in score points, never averaged into one verdict**
 * (`reqs.md`). A candidate can be ahead on housing and behind on career, and a single number
 * for "better" would be the application deciding what this household values.
 *
 * **Each cell is a bar that grows both ways from a centre line.** "Better or worse, and by how
 * much" has a sign and a size; a bar anchored at the left can only show size, so the sign has
 * to be read off a minus one cell at a time. Anchored in the middle, a column of them reads as
 * a shape -- which is the whole reason to draw the number twice.
 *
 * **A pillar row opens in place, rather than onto a second table below.** The pillars are the
 * answer; opening one shows the evidence under it, in the same columns, so a reader does not
 * lose the line they were reading. One at a time, because two open pillars is a table no longer
 * about the pillar either of them belongs to.
 */
export function ComparisonMatrix({
  comparison,
  measure,
  shownAs,
}: {
  comparison: Comparison;
  measure: Measure;
  /** How the attribute rows read: the normalised score, or the figure in its own unit. */
  shownAs: "score" | "raw";
}) {
  const comparators = comparison.comparators ?? [];
  const pillarNames = usePillarNames();
  const attributeNames = useAttributeNames();
  const [open, setOpen] = useState<string | null>(null);

  const rows = pillarMatrix(comparison.focus, comparators, measure, (pillar) =>
    pillarName(pillarNames, pillar),
  );
  const [totalRow, ...pillarRows] = rows;
  // One ruler for every pillar bar, so a column reads as a shape; the total keeps its own,
  // being a different quantity from the pillars that make it.
  const pillarScale = maxAbsDelta(pillarRows.flatMap((row) => row.cells));
  const totalScale = maxAbsDelta(totalRow?.cells ?? []);
  const priority = pillarPriority(comparison.focus);

  const groups = attributeGroups(
    comparison.attributes.map((row) => ({
      attribute: row.attribute,
      pillar: row.pillar ?? "",
      focusScore: row.focus?.normalised_score ?? null,
      focusRaw: payloadMagnitude(row.focus?.value),
      focusFigure: row.focus?.value ? describeFigure(row.focus.value) : ABSENT,
      comparators: (row.comparators ?? []).map((cell) => ({
        candidate: cell.candidate ?? "",
        score: cell.normalised_score ?? null,
        rawDelta: cell.delta ?? null,
        figure: cell.value ? describeFigure(cell.value) : ABSENT,
      })),
    })),
    comparators.map((each) => each.candidate),
  );

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
          {totalRow && (
            <tr className="matrix__row matrix__row--total">
              <th scope="row" className="matrix__label">
                {totalRow.label}
              </th>
              <td className="matrix__weight">
                {formatPercentage(totalRow.weight, 0)}
              </td>
              <FocusCell text={formatScore(totalRow.focus)} />
              {totalRow.cells.map((cell) => (
                <Cell
                  key={cell.candidate}
                  bar={divergingBar(cell.delta, totalScale, totalRow.focus)}
                  scoreText={formatScore(cell.score)}
                  deltaText={deltaText(cell)}
                />
              ))}
            </tr>
          )}

          {pillarRows.map((row) => {
            const place = row.pillar === null ? undefined : priority.get(row.pillar);
            const isOpen = open !== null && open === row.pillar;
            const attributes = row.pillar === null ? [] : (groups.get(row.pillar) ?? []);
            return (
              <PillarGroup
                key={row.label}
                label={row.label}
                weight={row.weight}
                focusText={formatScore(row.focus)}
                place={place}
                open={isOpen}
                canOpen={attributes.length > 0}
                onToggle={() =>
                  setOpen((current) => (current === row.pillar ? null : row.pillar))
                }
                cells={row.cells.map((cell) => ({
                  candidate: cell.candidate,
                  bar: divergingBar(cell.delta, pillarScale, row.focus),
                  scoreText: formatScore(cell.score),
                  deltaText: deltaText(cell),
                }))}
                attributes={attributes}
                shownAs={shownAs}
                naming={(attribute) => attributeName(attributeNames, attribute)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A pillar row, and -- when it is open -- the attribute rows beneath it. */
function PillarGroup({
  label,
  weight,
  focusText,
  place,
  open,
  canOpen,
  onToggle,
  cells,
  attributes,
  shownAs,
  naming,
}: {
  label: string;
  weight: number | null;
  focusText: string;
  place: number | undefined;
  open: boolean;
  canOpen: boolean;
  onToggle: () => void;
  cells: { candidate: string; bar: Divergence; scoreText: string; deltaText: string }[];
  attributes: readonly AttributeRow[];
  shownAs: "score" | "raw";
  naming: (attribute: string) => string;
}) {
  const rowClass =
    `matrix__row${place !== undefined ? " matrix__row--priority" : ""}` +
    (open ? " matrix__row--open" : "");
  return (
    <>
      <tr className={rowClass}>
        <th scope="row" className="matrix__label">
          {canOpen ? (
            <button
              type="button"
              className="matrix__toggle"
              aria-expanded={open}
              onClick={onToggle}
            >
              <span className="matrix__caret" aria-hidden="true">
                {open ? "▾" : "▸"}
              </span>
              <span>{label}</span>
            </button>
          ) : (
            <span className="matrix__toggle matrix__toggle--static">
              <span className="matrix__caret" aria-hidden="true" />
              <span>{label}</span>
            </span>
          )}
          {place !== undefined && (
            <span className="matrix__priority">
              #{place + 1} priority
            </span>
          )}
        </th>
        <td className="matrix__weight">{formatPercentage(weight, 0)}</td>
        <FocusCell text={focusText} />
        {cells.map((cell) => (
          <Cell
            key={cell.candidate}
            bar={cell.bar}
            scoreText={cell.scoreText}
            deltaText={cell.deltaText}
          />
        ))}
      </tr>
      {open &&
        attributes.map((attribute) => (
          <AttributeRowView
            key={attribute.attribute}
            row={attribute}
            shownAs={shownAs}
            name={naming(attribute.attribute)}
          />
        ))}
    </>
  );
}

/** One attribute, read either as a normalised score or as the figure in its own unit. */
function AttributeRowView({
  row,
  shownAs,
  name,
}: {
  row: AttributeRow;
  shownAs: "score" | "raw";
  name: string;
}) {
  const raw = shownAs === "raw";
  const note = raw
    ? row.focusRaw === null && row.focusScore === null
      ? "no figure"
      : "its own unit, as published"
    : "normalised 0–100";

  return (
    <tr className="matrix__row matrix__row--attr">
      <th scope="row" className="matrix__label matrix__label--attr">
        <span className="matrix__attr-name">{name}</span>
        <span className="matrix__attr-note">{note}</span>
      </th>
      <td className="matrix__weight" />
      <FocusCell
        text={raw ? row.focusFigure || ABSENT : formatScore(row.focusScore)}
        compact
      />
      {row.cells.map((cell) => {
        const bar = raw
          ? divergingBar(cell.rawDelta, row.rawScale, row.focusRaw)
          : divergingBar(cell.scoreDelta, row.scoreScale, row.focusScore);
        return (
          <Cell
            key={cell.candidate}
            bar={bar}
            compact
            scoreText={raw ? cell.figure || ABSENT : formatScore(cell.score)}
            deltaText={
              raw ? formatSigned(cell.rawDelta) : formatDelta(cell.scoreDelta)
            }
          />
        );
      })}
    </tr>
  );
}

/** The baseline column: the line everything else is measured from, so it carries no bar. */
function FocusCell({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <td className={compact ? "matrix__cell matrix__cell--focus matrix__cell--compact" : "matrix__cell matrix__cell--focus"}>
      <div className="matrix__cell-head">
        <span className="matrix__score">{text}</span>
        <span className="matrix__delta matrix__delta--faint">baseline</span>
      </div>
    </td>
  );
}

/**
 * One comparator cell: the figure, the signed gap, and the diverging bar beneath both.
 *
 * **The tint is a layer, not a background**, so it sits under the number without tinting the
 * text; its hue is a class and only its opacity is data. **The bar is SVG**, so its geometry --
 * where it starts and how far it reaches -- is an attribute rather than an inline style, which
 * is the one way `routes/` is allowed to carry a computed dimension.
 */
function Cell({
  bar,
  scoreText,
  deltaText,
  compact,
}: {
  bar: Divergence;
  scoreText: string;
  deltaText: string;
  compact?: boolean;
}) {
  const cellClass =
    `matrix__cell${compact ? " matrix__cell--compact" : ""}` +
    (bar.edge ? ` matrix__cell--${bar.direction}` : "");
  const deltaClass =
    `matrix__delta matrix__delta--${bar.direction}` +
    (bar.edge ? " matrix__delta--strong" : bar.faint ? " matrix__delta--faint" : "");

  return (
    <td className={cellClass}>
      {bar.alpha > 0 && (
        <svg
          className="matrix__tint"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect
            className={`matrix__tint-fill matrix__tint-fill--${bar.direction}`}
            width="1"
            height="1"
            fillOpacity={bar.alpha}
          />
        </svg>
      )}
      <div className="matrix__cell-head">
        <span className="matrix__score">{scoreText}</span>
        <span className={deltaClass}>{deltaText}</span>
      </div>
      <div className={compact ? "matrix__track matrix__track--compact" : "matrix__track"}>
        <span className="matrix__tick" />
        {bar.direction !== "level" && (
          <svg
            className="matrix__bar"
            viewBox="0 0 100 10"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect
              className={`matrix__bar-fill matrix__bar-fill--${bar.direction}`}
              x={bar.left}
              y="0"
              width={bar.width}
              height="10"
              rx="1.5"
              ry="1.5"
              fillOpacity={bar.barOpacity}
            />
          </svg>
        )}
      </div>
    </td>
  );
}

/** A comparator cell's delta text: a dash where there is nothing to compare, signed otherwise. */
function deltaText(cell: MatrixCell): string {
  return cell.delta === null ? ABSENT : formatDelta(cell.delta);
}
