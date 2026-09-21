import {
  type CandidateResult,
  type Ranking,
} from "../../api/endpoints";
import {
  ABSENT,
  formatDateTime,
  formatMatchStatus,
  formatPercentage,
  formatScore,
} from "../../format/display";
import {
  type ConfidenceSplit,
  type PillarScore,
  confidenceBands,
  confidenceLabel,
  coverageBar,
  deltaTone,
  formatDelta,
  pillarBars,
} from "./rankTable";
import { type OpenRow, isOpen } from "./openRows";

/**
 * The ranking table, and every cell in it.
 *
 * **One table renders both a live ranking and a saved one**, because `GET /evaluations/{id}`
 * answers in the same shape as `GET /rankings`. A frozen ranking and a live one are the same
 * thing seen at different moments, and a second table for the saved case would be two places
 * for one meaning to drift apart.
 *
 * `onToggle` is optional, and that is the only difference between the two uses: a live row
 * opens the candidate's current evidence, while a saved ranking is a snapshot whose evidence
 * has moved on, so it offers no drill-down rather than a misleading one.
 */
export function RankingTable({
  ranking,
  open = [],
  onToggle,
}: {
  ranking: Ranking;
  open?: readonly OpenRow[];
  onToggle?: (row: OpenRow) => void;
}) {
  return (
    <>
      <dl className="stat-list stat-list--inline">
        <Stat label="Criteria set" value={ranking.criteria_set} />
        <Stat label="Level" value={ranking.level} />
        <Stat label="Computed" value={formatDateTime(ranking.computed_at)} />
      </dl>

      {ranking.candidates.length === 0 ? (
        <p className="screen__note">
          No candidate has been evaluated under this criteria set at this level.
        </p>
      ) : (
        <div className="table-card">
          {/* Named, because it stops being the only table on the screen the moment a
              candidate's figures are opened -- and several can be open at once. */}
          <table className="table table--ranking" aria-label="Ranked candidates">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Candidate</th>
                <th scope="col" className="col--pillars">
                  Pillars
                </th>
                <th scope="col">Score</th>
                <th scope="col">Coverage</th>
                <th scope="col">Confidence</th>
                <th scope="col">Match status</th>
                <th scope="col">Reason</th>
                <th scope="col" className="col--delta">
                  &Delta; home
                </th>
                <th scope="col"> </th>
              </tr>
            </thead>
            <tbody>
              {ranking.candidates.map((result) => (
                <CandidateRow
                  key={result.candidate}
                  result={result}
                  open={isOpen(open, result.candidate)}
                  onToggle={onToggle}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * `reqs.md` 5.4: a non-matching candidate keeps its computed score, greyed out. The row stays
 * in the same table as the rest -- a separate "rejected" list would be a filter by another
 * name, and the ordering would stop meaning anything.
 */
function CandidateRow({
  result,
  open,
  onToggle,
}: {
  result: CandidateResult;
  open: boolean;
  onToggle?: (row: OpenRow) => void;
}) {
  const matching = result.match_status === "matching";

  return (
    <tr
      className={
        matching ? "table__row" : "table__row table__row--not-matching"
      }
    >
      {/* A candidate a gate ruled out has no rank, and an empty cell does not say that --
          it reads as a table that failed to render. The dash is what the rest of this screen
          prints where a number is genuinely absent. */}
      <td>{result.rank ?? ABSENT}</td>
      <th scope="row">{result.name}</th>
      <td className="col--pillars">
        <PillarChart pillars={result.pillar_scores} />
      </td>
      <ScoreCell result={result} />
      <td>
        <CoverageBar coverage={result.coverage} />
      </td>
      {/* A score is never discounted for resting on a weak figure (`reqs.md` 5.7), so the
          disclosure is here: an estimate and a measurement land in the same column otherwise.
          The bar shows the whole split rather than the low grade alone -- the column used to
          say "of it, low confidence", which answered only half the question it raised. */}
      <td>
        <ConfidenceBar split={result.coverage_by_confidence} />
      </td>
      <td>
        <span className={`chip chip--${result.match_status}`}>
          {formatMatchStatus(result.match_status)}
        </span>
      </td>
      <td>
        {/* Two kinds of reason, and they are not the same thing. `non_match_reasons` say why a
            candidate that COULD be scored does not match; `insufficient_reason` says why one
            could not be scored at all. A screen that showed only the first would leave every
            unscoreable candidate with an empty cell and no way to find out why. */}
        {(result.non_match_reasons ?? []).map((reason, index) => (
          <p key={index} className="table__reason">
            {reason.reason_detail}
          </p>
        ))}
        {result.insufficient_reason ? (
          <p className="table__reason">{result.insufficient_reason}</p>
        ) : null}
        {/* A warning rules nothing out and changes no score; it sits with the reasons because
            that is where a reader looks for what a rule had to say (`reqs.md` 3.7a). */}
        {(result.warnings ?? []).map((warning) => (
          <p key={warning.compound_rule} className="table__reason">
            <span className="chip chip--warning">warning</span>
            {warning.detail}
          </p>
        ))}
      </td>
      {/* Against staying put (`reqs.md` 1.2). Null for home itself and wherever a score is
          missing, and a dash says so -- a zero here would read as "the same", which is a
          measurement nobody made. */}
      <td
        className={`col--delta table__delta table__delta--${deltaTone(result.delta_vs_home)}`}
      >
        {formatDelta(result.delta_vs_home)}
      </td>
      <td>
        {/* A saved ranking is a snapshot; the stored values behind it have moved on since.
            Offering a drill-down there would open today's evidence under yesterday's score. */}
        {onToggle && (
          <button
            type="button"
            className={open ? "button button--current" : "button"}
            onClick={() =>
              onToggle({
                candidate: result.candidate,
                name: result.name,
                pillars: result.pillar_scores,
              })
            }
          >
            {open ? "Hide figures" : "Show figures"}
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * The eleven pillars as one small chart, so a score's shape is readable at a glance.
 *
 * **Bottom-aligned bars in a fixed coordinate space**, which is what makes an SVG right here:
 * the geometry is data and the tones are classes. A pillar with no score is a full-height flat
 * bar rather than a gap, because eleven bars are counted and a missing one silently renumbers
 * the rest.
 */
function PillarChart({ pillars }: { pillars?: readonly PillarScore[] | null }) {
  const bars = pillarBars(pillars);
  if (bars.length === 0) {
    return null;
  }

  return (
    <svg
      className="pillar-chart"
      viewBox="0 0 100 26"
      preserveAspectRatio="none"
    >
      {bars.map((bar) => (
        <rect
          key={bar.pillar}
          className={`pillar-chart__bar pillar-chart__bar--${bar.tone}`}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
        >
          <title>{bar.title}</title>
        </rect>
      ))}
    </svg>
  );
}

/**
 * Coverage as a track and a reading, the way the design draws it.
 *
 * The width and the tone are decided in `rankTable.ts`; this renders what it is handed.
 */
function CoverageBar({ coverage }: { coverage: number | null | undefined }) {
  const bar = coverageBar(coverage);

  return (
    <div className="meter">
      {/* **SVG, not a styled div.** A bar's width is a datum, and `styles.css` is where design
          lives (the lint rule says so). An SVG geometry attribute carries the number without a
          `style` attribute, and the colour still comes from a class -- so changing how a meter
          looks is still a change to one stylesheet. */}
      <svg
        className="meter__track"
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          className={`meter__fill meter__fill--${bar.tone}`}
          width={bar.width}
          height="6"
        />
      </svg>
      <span className="meter__reading">
        {formatPercentage(coverage)} covered
      </span>
    </div>
  );
}

/**
 * The confidence split as one stacked track.
 *
 * **Every band carries a `title`**, because a 6px stripe of colour is not self-explaining and
 * this is the disclosure `reqs.md` 5.7 requires rather than decoration. The reading beside it
 * says the same thing in text, for anyone who cannot hover.
 */
function ConfidenceBar({
  split,
}: {
  split: ConfidenceSplit | null | undefined;
}) {
  const bands = confidenceBands(split);

  return (
    <div className="meter">
      <svg
        className="meter__track"
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {bands.map((band) => (
          <rect
            key={band.grade}
            className={`meter__fill meter__fill--${band.tone}`}
            x={band.x}
            width={band.width}
            height="6"
          >
            <title>{band.title}</title>
          </rect>
        ))}
      </svg>
      <span className="meter__reading">{confidenceLabel(split)}</span>
    </div>
  );
}

/**
 * The cell that must not lie.
 *
 * With insufficient data there is no score, so the cell says there is no score. A zero would
 * read as "scored badly", and a bare dash reads as a rendered value that failed to arrive --
 * both of them claims the application cannot support (`reqs.md` 5.3).
 *
 * It says nothing about *why* the score is absent: the two causes are a coverage floor and a
 * `blocks_if_missing` criterion (`reqs.md` 5.3), and the ranking response does not say which.
 * The match status column reports what is known; guessing the cause would be the same fault
 * in prose that a fabricated number would be in figures.
 */
function ScoreCell({ result }: { result: CandidateResult }) {
  if (result.score === null || result.score === undefined) {
    return <td className="table__cell--absent">No score</td>;
  }

  return <td className="table__cell--numeric">{formatScore(result.score)}</td>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
    </div>
  );
}