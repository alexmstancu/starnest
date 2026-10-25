import type { Comparison } from "../../api/endpoints";
import {
  attributeName,
  formatDecimal,
  formatPercentage,
  formatScore,
  formatSigned,
  pillarName,
} from "../../format/display";
import { describeFigure } from "../../format/figure";
import { isScale } from "../../format/scoreScale";
import { useAttributeNames } from "../../api/useAttributeNames";
import { usePillarNames } from "../../api/usePillarNames";
import { divergingBar, maxAbsDelta, type Divergence } from "./divergingBar";
import { pillarMatrix, type MatrixCell } from "./pillarMatrix";
import {
  attributeGroups,
  attributeNote,
  hasFigure,
  payloadMagnitude,
  publishedUnit,
  rawGapText,
  rawGapUnit,
  type AttributeRow,
  type Provenance,
} from "./attributeRows";
import type { Measure } from "./pillarMatrix";
import { StatusChip } from "./StatusChip";
import { describeProvenance, provenanceMark } from "./provenance";
import { useSourceNames } from "../../api/useSourceNames";

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
  pillarWeights,
  priority,
  open,
  onOpen,
}: {
  comparison: Comparison;
  measure: Measure;
  /** How the attribute rows read: the normalised score, or the figure in its own unit. */
  shownAs: "score" | "raw";
  /** The set's configured weight for each pillar at this level (PL-104). */
  pillarWeights: ReadonlyMap<string, number>;
  /** Each priority pillar's place, from `pillarPriority`, shared with the cards. */
  priority: ReadonlyMap<string, number>;
  /**
   * The one pillar open to its attributes, kept with the selection so it survives a tab change:
   * null when the reader closed it, undefined until anyone chose -- then the first (PL-102).
   */
  open: string | null | undefined;
  /** Opens a pillar, or closes every one with null. */
  onOpen: (pillar: string | null) => void;
}) {
  const comparators = comparison.comparators ?? [];
  const pillarNames = usePillarNames();
  const attributeNames = useAttributeNames();
  const sourceNames = useSourceNames();
  const provenanceOf = (value: Parameters<typeof describeProvenance>[0] | undefined) =>
    value === undefined
      ? null
      : { description: describeProvenance(value, sourceNames), mark: provenanceMark(value) };

  const rows = pillarMatrix(comparison.focus, comparators, measure, (pillar) =>
    pillarName(pillarNames, pillar),
  );
  const [totalRow, ...pillarRows] = rows;
  // One ruler for every pillar bar, so a column reads as a shape; the total keeps its own,
  // being a different quantity from the pillars that make it.
  const pillarScale = maxAbsDelta(pillarRows.flatMap((row) => row.cells));
  const totalScale = maxAbsDelta(totalRow?.cells ?? []);
  // On the comparison's own scale (PL-062), which is the live setting and not always 100.
  // **No scale, no bar**: the scores print, and nothing is drawn or tinted against a top
  // nobody sent.
  const scale: ScaleReading = {
    drawn: isScale(comparison.score_scale_max),
    max: isScale(comparison.score_scale_max) ? comparison.score_scale_max : null,
  };

  const groups = attributeGroups(
    comparison.attributes.map((row) => ({
      attribute: row.attribute,
      pillar: row.pillar ?? "",
      focusScore: row.focus?.normalised_score ?? null,
      focusRaw: payloadMagnitude(row.focus?.value),
      focusFigure: row.focus?.value ? describeFigure(row.focus.value) : "",
      unitWords: publishedUnit(row.focus?.value),
      focusProvenance: provenanceOf(row.focus?.value),
      gapUnit: rawGapUnit(row.focus?.value),
      // The server sends 0 where the focus has no figure; that is no weight, not a light one.
      weight:
        typeof row.focus?.normalised_score === "number" ? (row.effective_weight ?? null) : null,
      comparators: (row.comparators ?? []).map((cell) => ({
        candidate: cell.candidate ?? "",
        score: cell.normalised_score ?? null,
        rawDelta: cell.delta ?? null,
        worth: cell.weighted_contribution ?? null,
        figure: cell.value ? describeFigure(cell.value) : "",
        provenance: provenanceOf(cell.value),
      })),
    })),
    comparators.map((each) => each.candidate),
  );
  // **The first pillar opens with the first drawing** (PL-102), until the reader opens or closes
  // one themselves.
  const firstOpenable =
    pillarRows.find((row) => row.pillar !== null && (groups.get(row.pillar)?.length ?? 0) > 0)
      ?.pillar ?? null;
  const shownOpen = open === undefined ? firstOpenable : open;

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
            <th
              scope="col"
              title="The criteria set's weight for each pillar. A candidate missing data has that weight moved to its other pillars, so what a pillar adds to its total can differ."
            >
              Weight
            </th>
            <th scope="col" className="matrix__head matrix__head--focus">
              {comparison.focus.name} (focus)
              <StatusChip result={comparison.focus} />
            </th>
            {comparators.map((each) => (
              <th key={each.candidate} scope="col" className="matrix__head">
                {each.name}
                <StatusChip result={each} />
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
                {formatPercentage(totalRow.weight, 1)}
              </td>
              <FocusCell text={scoreText(totalRow.focus)} />
              {totalRow.cells.map((cell) => (
                <Cell
                  key={cell.candidate}
                  bar={scale.drawn ? divergingBar(cell.delta, totalScale, totalRow.focus) : null}
                  scoreText={scoreText(cell.score)}
                  deltaText={deltaText(cell)}
                />
              ))}
            </tr>
          )}

          {pillarRows.map((row) => {
            const place = row.pillar === null ? undefined : priority.get(row.pillar);
            const isOpen = shownOpen !== null && shownOpen === row.pillar;
            const attributes = row.pillar === null ? [] : (groups.get(row.pillar) ?? []);
            return (
              <PillarGroup
                key={row.label}
                label={row.label}
                weight={row.pillar === null ? null : (pillarWeights.get(row.pillar) ?? null)}
                focusText={readingText(row.focus, measure)}
                place={place}
                open={isOpen}
                canOpen={attributes.length > 0}
                onToggle={() => onOpen(isOpen ? null : row.pillar)}
                cells={row.cells.map((cell) => ({
                  candidate: cell.candidate,
                  bar: scale.drawn ? divergingBar(cell.delta, pillarScale, row.focus) : null,
                  scoreText: readingText(cell.score, measure),
                  deltaText: deltaText(cell, measure),
                }))}
                attributes={attributes}
                shownAs={shownAs}
                scale={scale}
                measure={measure}
                pillarFocus={row.focus}
                focusName={comparison.focus.name}
                naming={(attribute) => attributeName(attributeNames, attribute)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** How the matrix reads its scores: whether there is a scale to draw against, and its top. */
interface ScaleReading {
  drawn: boolean;
  /** The scale's top, or null when the comparison carried none. */
  max: number | null;
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
  scale,
  measure,
  pillarFocus,
  focusName,
  naming,
}: {
  label: string;
  weight: number | null;
  focusText: string;
  place: number | undefined;
  open: boolean;
  canOpen: boolean;
  onToggle: () => void;
  cells: { candidate: string; bar: Divergence | null; scoreText: string; deltaText: string }[];
  attributes: readonly AttributeRow[];
  shownAs: "score" | "raw";
  scale: ScaleReading;
  measure: Measure;
  /** The focus's reading on this pillar, which an impact's tint is measured against. */
  pillarFocus: number | null;
  focusName: string;
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
        <td className="matrix__weight">{formatPercentage(weight, 1)}</td>
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
            scale={scale}
            measure={measure}
            pillarFocus={pillarFocus}
            note={attributeNote(attribute, shownAs, focusName, scale.max)}
            name={naming(attribute.attribute)}
          />
        ))}
    </>
  );
}

/**
 * One attribute, read either as a normalised score or as the figure in its own unit.
 *
 * **Under "Weighted impact" the gap slot is what the gap is worth** (PL-097, C07-D): the
 * server's number, drawn against the pillar's largest worth, while the figure above it stays
 * the score or the raw figure the other toggle chose.
 */
function AttributeRowView({
  row,
  shownAs,
  scale,
  measure,
  pillarFocus,
  note,
  name,
}: {
  row: AttributeRow;
  shownAs: "score" | "raw";
  scale: ScaleReading;
  measure: Measure;
  pillarFocus: number | null;
  /** How the row reads, from `attributeNote`. */
  note: string;
  name: string;
}) {
  const raw = shownAs === "raw";
  const impact = measure === "impact";

  return (
    <tr className="matrix__row matrix__row--attr">
      <th scope="row" className="matrix__label matrix__label--attr">
        <span className="matrix__attr-name">
          {name}
          {row.place !== undefined && (
            <span className="matrix__priority">#{row.place + 1} in pillar</span>
          )}
        </span>
        <span className="matrix__attr-note">{note}</span>
      </th>
      <td className="matrix__weight">{formatPercentage(row.weight, 1)}</td>
      <FocusCell
        text={raw ? figureText(row.focusFigure) : scoreText(row.focusScore)}
        provenance={row.focusProvenance}
        compact
      />
      {row.cells.map((cell) => {
        const bar = !scale.drawn
          ? null
          : impact
            ? divergingBar(cell.worth, row.worthScale, pillarFocus)
            : raw
              ? divergingBar(cell.rawBar, row.rawScale, row.focusRaw)
              : divergingBar(cell.scoreDelta, row.scoreScale, row.focusScore);
        return (
          <Cell
            key={cell.candidate}
            bar={bar}
            compact
            provenance={cell.provenance}
            scoreText={raw ? figureText(cell.figure) : scoreText(cell.score)}
            deltaText={
              impact
                ? formatSigned(cell.worth, decimalsFor(measure))
                : raw
                  ? rawGapText(cell.rawDelta, row.gapUnit)
                  : formatSigned(cell.scoreDelta, 0)
            }
          />
        );
      })}
    </tr>
  );
}

/**
 * A score as a cell prints it: "No score" where there is none (PL-101). A dash is kept for the
 * gap slot, where it means "no difference to read" rather than "nothing here".
 */
function scoreText(value: number | null): string {
  return value === null ? "No score" : formatScore(value);
}

/** A figure as a cell prints it, or "No value" where the candidate has none (PL-101). */
function figureText(figure: string): string {
  return hasFigure(figure) ? figure : "No value";
}

/** The baseline column: the line everything else is measured from, so it carries no bar. */
function FocusCell({
  text,
  compact,
  provenance,
}: {
  text: string;
  compact?: boolean;
  provenance?: Provenance | null;
}) {
  return (
    <td
      className={compact ? "matrix__cell matrix__cell--focus matrix__cell--compact" : "matrix__cell matrix__cell--focus"}
      title={provenance?.description}
    >
      <ProvenanceNote provenance={provenance} />
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
  provenance,
}: {
  /** Null when the comparison carried no scale: the figures print, with no track, tint or bar. */
  bar: Divergence | null;
  scoreText: string;
  deltaText: string;
  compact?: boolean;
  /** Where the figure came from; absent on a pillar row, null where there is no figure. */
  provenance?: Provenance | null;
}) {
  const cellClass =
    `matrix__cell${compact ? " matrix__cell--compact" : ""}` +
    (bar?.edge ? ` matrix__cell--${bar.direction}` : "");
  const deltaClass = bar
    ? `matrix__delta matrix__delta--${bar.direction}` +
      (bar.edge ? " matrix__delta--strong" : bar.faint ? " matrix__delta--faint" : "")
    : "matrix__delta";

  return (
    <td className={cellClass} title={provenance?.description}>
      <ProvenanceNote provenance={provenance} />
      {bar && bar.alpha > 0 && (
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
      {/* No scale, no gauge: an empty track and its tick would still imply a top. */}
      {bar && (
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
      )}
    </td>
  );
}

/**
 * A figure's provenance where it is shown (PL-096): read in full by a screen reader, and marked
 * in sight when the figure is borrowed or of low confidence. The cell's title carries the same
 * sentence for a mouse.
 */
function ProvenanceNote({ provenance }: { provenance?: Provenance | null }) {
  if (!provenance) return null;
  return (
    <>
      <span className="visually-hidden">{provenance.description}</span>
      {provenance.mark !== null && <span className="matrix__mark">{provenance.mark}</span>}
    </>
  );
}

/**
 * How many decimals a matrix reading takes. Scores are whole points; an impact is a pillar's
 * share of the total, often under one point, so rounding it whole printed real gaps as "+0"
 * beside a coloured bar (PL-093).
 */
function decimalsFor(measure: Measure): number {
  return measure === "impact" ? 1 : 0;
}

/** A pillar reading: a score, or an impact on the total to one decimal. */
function readingText(value: number | null, measure: Measure): string {
  if (value === null) return "No score";
  return measure === "impact" ? formatDecimal(value, decimalsFor(measure)) : formatScore(value);
}

/** A comparator cell's delta text: a dash where there is nothing to compare, signed otherwise. */
function deltaText(cell: MatrixCell, measure: Measure = "points"): string {
  return formatSigned(cell.delta, decimalsFor(measure));
}
