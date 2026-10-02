import { Fragment, useId, type ReactNode } from "react";
import { type CandidateResult, type Ranking } from "../../api/endpoints";
import { usePillarNames, type PillarNames } from "../../api/usePillarNames";
import {
  deltaTone,
  pillarName,
} from "../../format/display";
import {
  ABSENT,
  formatDateTime,
  formatIdentifier,
  formatMatchStatus,
  formatPercentage,
  formatScore,
} from "../../format/display";
import {
  type ConfidenceSplit,
  type PillarScore,
  PILLAR_CHART,
  confidenceBands,
  confidenceReadings,
  coverageBar,
  excludedBand,
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
 *
 * **The card scrolls, not the page.** The header is sticky inside it and the whole thing is
 * capped at the viewport, so the column a number sits under is still on screen at row 30 --
 * which is the difference between a table of 32 countries and a list of them.
 */
export function RankingTable({
  ranking,
  open = [],
  onToggle,
  detail,
  codes,
  home,
}: {
  ranking: Ranking;
  open?: readonly OpenRow[];
  onToggle?: (row: OpenRow) => void;
  /**
   * What an open row shows underneath itself. **Passed in rather than imported**, because
   * the evidence behind a score is fetched, and a table that renders a live ranking and a
   * frozen one must not know the difference -- a saved ranking supplies none.
   */
  detail?: (row: OpenRow) => ReactNode;
  /**
   * Candidate id to ISO 3166-1 alpha-2, for the flag beside a name.
   *
   * **From the catalog, never from the name.** Mapping "Netherlands" to NL in the client
   * would be a second copy of something the database already holds, and wrong for every
   * candidate whose name is not a country's.
   */
  codes?: ReadonlyMap<string, string>;
  /**
   * The candidates the household already lives in (`reqs.md` 1.1).
   *
   * **A set rather than one id**, because home is a candidate at every level and this table
   * draws one level at a time -- see `homeCandidates`.
   */
  home?: ReadonlySet<string>;
}) {
  const names = usePillarNames();
  // Where the ranking stops and the set below it starts. Null when everything matches.
  const band = excludedBand(ranking.candidates);

  if (ranking.candidates.length === 0) {
    return (
      <p className="screen__note">
        No candidate has been evaluated under this criteria set at this level.
      </p>
    );
  }

  return (
    <>
    <div className="table-card">
      {/* Named, because it stops being the only table on the screen the moment a candidate's
          figures are opened -- and several can be open at once. */}
      <table className="table table--ranking" aria-label="Ranked candidates">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">
              <span className="visually-hidden">Country</span>
            </th>
            <th scope="col">Candidate</th>
            <th scope="col" className="col--right">
              Score
            </th>
            <th scope="col" className="col--right">
              &Delta; home
            </th>
            <th scope="col" className="col--pillars">
              Pillars
              <PillarKey
                names={names}
                pillars={ranking.candidates[0]?.pillar_scores}
              />
            </th>
            <th scope="col">Coverage</th>
            <th scope="col">Confidence</th>
            <th scope="col">Match status</th>
            <th scope="col">Why this status</th>
          </tr>
        </thead>
        <tbody>
          {ranking.candidates.map((result, at) => (
            <Fragment key={result.candidate}>
              {/* **The list changes meaning here.** Above the band it is an order; below it
                  is a set, because a candidate with no rank cannot be in an order. Leaving
                  them in with nothing between makes the ranking look as though it simply
                  continues (`reqs.md` 5.4 keeps them visible; this says what they are). */}
              {band?.at === at && (
                <tr className="table__band">
                  <td>
                    <span className="table__band-label">Not in the ranking</span>
                    <span className="table__band-reading">{band.reading}</span>
                  </td>
                </tr>
              )}
              <CandidateRow
                names={names}
                result={result}
                open={isOpen(open, result.candidate)}
                onToggle={onToggle}
                detail={detail}
                code={codes?.get(result.candidate)}
                atHome={home?.has(result.candidate) === true}
              />
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
    {/* **Under the table, not over it.** It answers two things a reader only wonders about
        once they have met a row that has them -- an empty rank cell, and a score cell that
        says "No score" -- and neither is a caveat about the ranking as a whole. */}
    <p className="table-note">
      A candidate a gate ruled out has no rank and keeps its score. One with
      insufficient data shows no score at all — never a zero.
    </p>
    </>
  );
}

/**
 * The three facts that say which ranking this is, as the design sets them: a small upright
 * label over the value, in a row beside the screen's own title.
 *
 * Exported because the design puts them in the page header rather than above the table, and
 * the header belongs to the screen.
 */
export function RankingMeta({ ranking }: { ranking: Ranking }) {
  return (
    <dl className="meta-row">
      <Meta label="Criteria set" value={ranking.criteria_set} />
      <Meta label="Level" value={formatIdentifier(ranking.level)} />
      <Meta label="Computed" value={formatDateTime(ranking.computed_at)} />
    </dl>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-row__item">
      <dt className="meta-row__label">{label}</dt>
      <dd className="meta-row__value">{value}</dd>
    </div>
  );
}

/**
 * The pillar names, rotated, above the bars they name.
 *
 * **Rotated rather than abbreviated or dropped.** Eleven columns in 522px leaves 45px each,
 * which holds neither "governance" nor a legible abbreviation of it -- and a chart whose axis
 * is unlabelled is decoration. Minus 45 degrees is the angle at which a word reads with the
 * least head-tilt while still fitting a narrow column.
 */
function PillarKey({
  names,
  pillars,
}: {
  names: PillarNames;
  pillars?: readonly PillarScore[] | null;
}) {
  const roster = pillars ?? [];
  if (roster.length === 0) return null;

  return (
    <span className="pillar-key" aria-hidden="true">
      {roster.map((pillar) => (
        <span key={pillar.pillar} className="pillar-key__slot">
          {/* The catalog's name. A ranking carries pillar *ids*, and title-casing one gives
              "Economics" where the catalog says "Economy" -- a screen guessing where somebody
              had already decided. */}
          <span className="pillar-key__name">
            {pillarName(names, pillar.pillar)}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * `reqs.md` 5.4: a non-matching candidate keeps its computed score, greyed out. The row stays
 * in the same table as the rest -- a separate "rejected" list would be a filter by another
 * name, and the ordering would stop meaning anything.
 *
 * **The whole row is the toggle.** A button in the last column made opening a candidate's
 * evidence a thing you had to travel 1,500px to reach; the row itself is the target the eye
 * is already on. The button in the rank cell is what a keyboard reaches, so the row being
 * clickable never becomes the only way in.
 */
function CandidateRow({
  names,
  result,
  open,
  onToggle,
  detail,
  code,
  atHome,
}: {
  names: PillarNames;
  result: CandidateResult;
  open: boolean;
  onToggle?: (row: OpenRow) => void;
  detail?: (row: OpenRow) => ReactNode;
  /** This candidate's ISO 3166-1 alpha-2, where the catalog holds one. */
  code?: string;
  /** Whether the household lives here, which is what makes its delta column read as zero. */
  atHome: boolean;
}) {
  const matching = result.match_status === "matching";
  const row: OpenRow = {
    candidate: result.candidate,
    name: result.name,
    pillars: result.pillar_scores,
  };
  const toggle = onToggle ? () => onToggle(row) : undefined;

  const classes = ["table__row"];
  if (!matching) classes.push("table__row--not-matching");
  if (open) classes.push("table__row--open");

  return (
    <>
    <tr
      className={classes.join(" ")}
      onClick={toggle}
      title={
        toggle
          ? open
            ? `Hide the values behind ${result.name}’s score`
            : `Show the values behind ${result.name}’s score`
          : undefined
      }
    >
      {/* A candidate a gate ruled out has no rank, and an empty cell does not say that -- it
          reads as a table that failed to render. The dash is what the rest of this screen
          prints where a number is genuinely absent. */}
      <td className="rank-cell">
        {toggle && (
          <span className="rank-cell__caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
        )}
        {result.rank ?? ABSENT}
      </td>
      {/* **The code, not a flag image.** There is no flag asset here and inventing one for 32
          countries would be 32 files to keep in step with a catalog that already carries the
          code. Two letters in a bordered box is what the design's own placeholder is. */}
      <td className="flag-cell">
        {code !== undefined && (
          <span className="flag" title={`${result.name} — ${code}`}>
            {code}
          </span>
        )}
      </td>
      <th scope="row" className="name-cell">
        {/* **No handler of its own.** The row listens, and a button activated by mouse or
            keyboard fires a click that bubbles to it -- so the keyboard path and the click
            path are the same path. Giving the button its own handler toggled the row twice
            and left it exactly as it was. */}
        {toggle ? (
          <button type="button" className="name-cell__toggle">
            {result.name}
          </button>
        ) : (
          result.name
        )}
        {/* **Beside the name, not in the delta column.** Home is the row every other row is
            measured against, and a reader who has not found it cannot read a single delta on
            the screen. The dash in its own delta cell says what it is, only after you know
            which row it is. */}
        {atHome && <span className="chip chip--home">home</span>}
      </th>
      <ScoreCell result={result} />
      {/* Against staying put (`reqs.md` 1.2). Null for home itself and wherever a score is
          missing, and a dash says so -- a zero here would read as "the same", which is a
          measurement nobody made. */}
      <td className={`col--right table__delta table__delta--${deltaTone(result.delta_vs_home)}`}>
        {formatDelta(result.delta_vs_home)}
      </td>
      <td className="col--pillars">
        <PillarChart names={names} pillars={result.pillar_scores} />
      </td>
      <td>
        <CoverageBar coverage={result.coverage} />
      </td>
      {/* A score is never discounted for resting on a weak figure (`reqs.md` 5.7), so the
          disclosure is here: an estimate and a measurement land in the same column otherwise. */}
      <td>
        <ConfidenceBar split={result.coverage_by_confidence} />
      </td>
      <td>
        <span className={`chip chip--${result.match_status}`}>
          {formatMatchStatus(result.match_status)}
        </span>
      </td>
      <td className="reason-cell">
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
        {(result.non_match_reasons ?? []).length === 0 &&
          (result.warnings ?? []).length === 0 &&
          !result.insufficient_reason && (
            <span className="table__reason table__reason--quiet">
              Passed every rule
            </span>
          )}
      </td>
    </tr>
    {/* **Underneath the row it belongs to, not under the whole table.** The evidence behind
        a score is about one candidate, and a panel that appears a screenful below the row
        that opened it makes the reader hold the connection in their head. */}
    {open && detail !== undefined && (
      <tr className="table__detail">
        <td>{detail(row)}</td>
      </tr>
    )}
    </>
  );
}

/**
 * The eleven pillars as one chart, with each score printed inside its own bar.
 *
 * **SVG, not styled divs.** A bar's height and its ramp colour are both data, and
 * `styles.css` is where design lives -- the lint rule says so. An SVG carries a number in a
 * geometry attribute and a colour in `fill`, so nothing here is an inline style, and the
 * reader still gets the figure as well as the shape.
 */
function PillarChart({
  names,
  pillars,
}: {
  names: PillarNames;
  pillars?: readonly PillarScore[] | null;
}) {
  const bars = pillarBars(pillars, (pillar) => pillarName(names, pillar));
  const hatch = useId();
  if (bars.length === 0) return null;

  return (
    <svg
      className="pillar-chart"
      viewBox={`0 0 ${PILLAR_CHART.width} ${PILLAR_CHART.height}`}
      width={PILLAR_CHART.width}
      height={PILLAR_CHART.height}
    >
      <defs>
        {/* One hatch for the whole chart, and one ramp per bar. The ids are scoped by
            `useId`, because several rows render this and duplicate ids in one document make
            every later reference resolve to the first. */}
        <pattern
          id={hatch}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" fill="#ffffff" />
          <rect width="2" height="4" fill="#e4e7ec" />
        </pattern>
        {bars.map((bar, index) =>
          bar.fill ? (
            <linearGradient
              key={bar.pillar}
              id={`${hatch}-${index}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0" stopColor={bar.fill.top} />
              <stop offset="1" stopColor={bar.fill.bottom} />
            </linearGradient>
          ) : null,
        )}
      </defs>
      {bars.map((bar, index) => (
        <g key={bar.pillar}>
          <rect
            className="pillar-chart__bar"
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx="2"
            fill={bar.fill ? `url(#${hatch}-${index})` : `url(#${hatch})`}
          >
            <title>{bar.title}</title>
          </rect>
          {bar.label !== "" && (
            <text
              className="pillar-chart__value"
              x={bar.x + bar.width / 2}
              y={PILLAR_CHART.height - 4}
              textAnchor="middle"
            >
              {bar.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Coverage as a track and a reading, the way the design draws it. */
function CoverageBar({ coverage }: { coverage: number | null | undefined }) {
  const bar = coverageBar(coverage);

  return (
    <div className="meter">
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
 * The confidence split as one stacked track and all three shares in words.
 *
 * **Every band carries a `title`**, because a 6px stripe of colour is not self-explaining and
 * this is the disclosure `reqs.md` 5.7 requires rather than decoration.
 */
function ConfidenceBar({
  split,
}: {
  split: ConfidenceSplit | null | undefined;
}) {
  const bands = confidenceBands(split);
  const readings = confidenceReadings(split);

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
      <span className="meter__readings">
        {readings.map((reading) => (
          <span
            key={reading.grade}
            className={
              reading.loud
                ? "meter__reading meter__reading--loud"
                : "meter__reading"
            }
          >
            {reading.reading}
          </span>
        ))}
      </span>
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
    return <td className="col--right score-cell score-cell--absent">No score</td>;
  }

  return (
    <td className="col--right score-cell">{formatScore(result.score)}</td>
  );
}
