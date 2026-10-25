import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { type CandidateResult, type Ranking } from "../../api/endpoints";
import { usePillarNames, type PillarNames } from "../../api/usePillarNames";
import { useCandidateNames } from "../../api/useCandidateNames";
import { useMatchRuleNames } from "../../api/useMatchRuleNames";
import {
  criteriaSetName,
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
  formatSigned,
} from "../../format/display";
import {
  type ConfidenceSplit,
  type PillarScore,
  PILLAR_CHART,
  confidenceBands,
  confidenceReadings,
  coverageBar,
  emptyDeltaNote,
  excludedBand,
  homeCandidates,
  pillarBars,
  type HomeRead,
} from "./rankTable";
import { type OpenCandidate, type OpenRow, chosenPillarOf, isOpen } from "./openRows";
import { barReachedBy, tabStopOf } from "./pillarChartFocus";
import { citizenshipVerdict, decidedByCitizenship } from "./citizenshipVerdict";

/**
 * The ranking table, and every cell in it.
 *
 * **One table renders both a live ranking and a saved one**, because `GET /evaluations/{id}`
 * answers in the same shape as `GET /rankings`. A frozen ranking and a live one are the same
 * thing seen at different moments, and a second table for the saved case would be two places
 * for one meaning to drift apart.
 *
 * What an open row shows is the only difference between the two uses: a live row opens the
 * candidate's current evidence, and a saved one the evidence frozen with it (PL-144).
 *
 * **The card scrolls, not the page.** The header is sticky inside it and the whole thing is
 * capped at the viewport, so the column a number sits under is still on screen at row 30 --
 * which is the difference between a table of 32 countries and a list of them.
 */
export function RankingTable({
  ranking,
  open = [],
  onToggle,
  onChoosePillar,
  detail,
  codes,
  household = { state: "unknown" },
}: {
  ranking: Ranking;
  open?: readonly OpenRow[];
  onToggle?: (row: OpenCandidate) => void;
  /**
   * Choose a pillar from the chart in the row, filtering the panel underneath it.
   *
   * **Omitted by a saved ranking**, whose panel lists every saved figure and has no pillar
   * filter, so the bars stay a picture.
   */
  onChoosePillar?: (row: OpenCandidate, pillar: string) => void;
  /**
   * What an open row shows underneath itself. **Passed in rather than imported**, because
   * the evidence behind a score is fetched, and a table that renders a live ranking and a
   * frozen one must not know the difference -- each supplies its own.
   */
  detail?: (row: OpenCandidate) => ReactNode;
  /**
   * Candidate id to ISO 3166-1 alpha-2, for the flag beside a name.
   *
   * **From the catalog, never from the name.** Mapping "Netherlands" to NL in the client
   * would be a second copy of something the database already holds, and wrong for every
   * candidate whose name is not a country's.
   */
  codes?: ReadonlyMap<string, string>;
  /**
   * What is known about the household's home (`reqs.md` 1.1): which rows are home, and why
   * the Δ home column may be empty. A saved ranking passes today's, which its Δ home is
   * taken against.
   */
  household?: HomeRead;
}) {
  const names = usePillarNames();
  const ruleNames: RuleNames = { gates: useMatchRuleNames(), candidates: useCandidateNames() };
  // Where the ranking stops and the set below it starts. Null when everything matches.
  const band = excludedBand(ranking.candidates);
  // **A set rather than one id**, because home is a candidate at every level and this table
  // draws one level at a time -- see `homeCandidates`.
  const home =
    household.state === "ready" ? homeCandidates(household.household) : NO_HOME;
  const deltaNote = emptyDeltaNote(ranking.candidates, household);

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
            <th scope="col" className="col--right col--delta">
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
                scaleMax={ranking.score_scale_max}
                open={isOpen(open, result.candidate)}
                chosenPillar={chosenPillarOf(open, result.candidate)}
                onToggle={onToggle}
                onChoosePillar={onChoosePillar}
                detail={detail}
                code={codes?.get(result.candidate)}
                atHome={home.has(result.candidate)}
                ruleNames={ruleNames}
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
      A candidate that does not match has no rank and keeps its score. One
      with insufficient data shows no score at all — never a zero.
    </p>
    {deltaNote !== null && <p className="table-note">{deltaNote}</p>}
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
export function RankingMeta({
  ranking,
  sets,
}: {
  ranking: Ranking;
  /** The set list's names by id, so the set reads as its current name (PL-070). */
  sets: ReadonlyMap<string, string>;
}) {
  return (
    <dl className="meta-row">
      <Meta label="Criteria set" value={criteriaSetName(sets, ranking.criteria_set)} />
      <Meta label="Level" value={formatIdentifier(ranking.level)} />
      <Meta label="Computed" value={formatDateTime(ranking.computed_at)} />
    </dl>
  );
}

const NO_HOME: ReadonlySet<string> = new Set();

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
  scaleMax,
  open,
  chosenPillar = null,
  onToggle,
  onChoosePillar,
  detail,
  code,
  atHome,
  ruleNames,
}: {
  names: PillarNames;
  result: CandidateResult;
  /** The top of the range the ranking's scores are on: live, or frozen with a saved one. */
  scaleMax: number | null | undefined;
  open: boolean;
  /** Which of this candidate's pillars the panel underneath is filtered to. */
  chosenPillar?: string | null;
  onToggle?: (row: OpenCandidate) => void;
  onChoosePillar?: (row: OpenCandidate, pillar: string) => void;
  detail?: (row: OpenCandidate) => ReactNode;
  /** This candidate's ISO 3166-1 alpha-2, where the catalog holds one. */
  code?: string;
  /** Whether the household lives here, which is what makes its delta column read as zero. */
  atHome: boolean;
  /** What a gate and a citizenship are called, for a reason said from its codes. */
  ruleNames: RuleNames;
}) {
  const matching = result.match_status === "matching";
  // **The chosen pillar travels on the row**, because this object is what `detail(row)` hands
  // to the panel underneath. Left off, the chart marked itself chosen and the panel it was
  // meant to filter never heard about it -- the two halves of one selection, disagreeing.
  //
  // **Rebuilt on every render, from the live result.** Nothing but `chosenPillar` is read back
  // out of the open rows: the name and the rollup are this render's, so a refetched ranking
  // reaches the panel underneath rather than the figures it was opened with.
  const row: OpenCandidate = {
    candidate: result.candidate,
    name: result.name,
    pillars: result.pillar_scores,
    chosenPillar,
  };
  const toggle = onToggle ? () => onToggle(row) : undefined;

  const classes = ["table__row"];
  // **Only a row that opens is marked as one** (PL-076): a table given no `onToggle` opens
  // nothing, so the pointer and the hover tint a row offers belong on this class.
  if (toggle) classes.push("table__row--toggle");
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
          code. Two letters in a bordered box is what the design's own placeholder is, and its
          title is the design's too: it says why a code stands where a flag belongs. */}
      <td className="flag-cell">
        {code !== undefined && (
          <span
            className="flag"
            title={`${result.name}. A flag replaces this code once the catalog carries flag images`}
          >
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
          <button type="button" className="name-cell__toggle" aria-expanded={open}>
            {result.name}
          </button>
        ) : (
          result.name
        )}
        {/* **Beside the name, not only in the delta column.** Home is the row every other row
            is measured against, and a reader who has not found it cannot read a single delta
            on the screen. */}
        {atHome && <span className="chip chip--home">home</span>}
      </th>
      <ScoreCell result={result} />
      {/* Against staying put (`reqs.md` 1.2). Home itself is the baseline (PL-081); a
          missing score is a dash -- a zero here would read as "the same", which is a
          measurement nobody made. */}
      {atHome && result.delta_vs_home == null ? (
        <td className="col--right col--delta table__delta table__delta--baseline">
          baseline
        </td>
      ) : (
        <td
          className={`col--right col--delta table__delta table__delta--${deltaTone(result.delta_vs_home)}`}
        >
          {formatSigned(result.delta_vs_home, 0)}
        </td>
      )}
      <td className="col--pillars">
        <PillarChart
          names={names}
          candidate={result.name}
          pillars={result.pillar_scores}
          scaleMax={scaleMax}
          chosen={chosenPillar}
          onChoose={
            onChoosePillar && ((pillar) => onChoosePillar(row, pillar))
          }
        />
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
      <ReasonCell result={result} names={ruleNames} />
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
 *
 * **Selectable, it is a toolbar** (PL-076): one tab stop for the whole chart, the arrow keys
 * moving along the bars and Enter or Space choosing one -- `pillarChartFocus.ts` says where.
 */
function PillarChart({
  names,
  candidate,
  pillars,
  scaleMax,
  chosen = null,
  onChoose,
}: {
  names: PillarNames;
  /** The candidate's name, which is what a selectable chart is announced as. */
  candidate: string;
  pillars?: readonly PillarScore[] | null;
  scaleMax: number | null | undefined;
  /** The pillar whose values the panel below is filtered to, drawn as the chosen bar. */
  chosen?: string | null;
  /**
   * Choose this pillar, or undefined to leave the chart as a picture.
   *
   * **A saved ranking passes nothing**, and the bars stay inert: its panel has no pillar
   * filter for a click to set.
   */
  onChoose?: (pillar: string) => void;
}) {
  const bars = pillarBars(pillars, scaleMax, (pillar) => pillarName(names, pillar));
  const hatch = useId();
  // The bar the keyboard is on while it is inside the chart, and null once it has left.
  const [focused, setFocused] = useState<string | null>(null);
  const slots = useRef<(SVGGElement | null)[]>([]);
  const pillarIds = bars.map((bar) => bar.pillar);
  const stop = tabStopOf(pillarIds, focused, chosen);
  // The bar the keyboard was last on, kept past a blur its own removal caused.
  const held = useRef<string | null>(null);

  // **A re-read can draw the chart without the bar the keyboard is on**, and a browser answers
  // by putting focus on the page. So the chart hands it to its new stop -- but only when it was
  // lost: focus the reader moved somewhere else stays where they put it (NEW-45's rule).
  useEffect(() => {
    const was = held.current;
    if (was === null || pillarIds.includes(was)) return;
    held.current = null;
    if (document.activeElement !== document.body || stop === undefined) return;
    slots.current[pillarIds.indexOf(stop)]?.focus();
  });

  if (bars.length === 0) return null;

  return (
    <svg
      className="pillar-chart"
      viewBox={`0 0 ${PILLAR_CHART.width} ${PILLAR_CHART.height}`}
      width={PILLAR_CHART.width}
      height={PILLAR_CHART.height}
      role={onChoose ? "toolbar" : undefined}
      aria-label={onChoose ? `Pillar scores for ${candidate}` : undefined}
      onBlur={
        onChoose &&
        ((event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          setFocused(null);
          // A bar still on the page was left on purpose; one that is gone was taken away.
          const left = event.target;
          queueMicrotask(() => {
            if (left.isConnected) held.current = null;
          });
        })
      }
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
        <g
          key={bar.pillar}
          ref={(slot) => {
            slots.current[index] = slot;
          }}
          className={
            chosen === bar.pillar
              ? "pillar-chart__slot pillar-chart__slot--chosen"
              : "pillar-chart__slot"
          }
          role={onChoose ? "button" : undefined}
          // **One stop per chart** (PL-076): Tab reaches one bar, and the arrows move along.
          tabIndex={onChoose ? (bar.pillar === stop ? 0 : -1) : undefined}
          aria-pressed={onChoose ? chosen === bar.pillar : undefined}
          aria-label={onChoose ? bar.title : undefined}
          onFocus={
            onChoose &&
            (() => {
              setFocused(bar.pillar);
              held.current = bar.pillar;
            })
          }
          onClick={
            onChoose &&
            ((event) => {
              // **The row underneath is itself a click target** -- clicking it opens or closes
              // the evidence. Without this, choosing a pillar on an open row would close the
              // panel the choice was meant to filter.
              event.stopPropagation();
              onChoose(bar.pillar);
            })
          }
          onKeyDown={
            onChoose &&
            ((event) => {
              const reached = barReachedBy(event.key, index, bars.length);
              if (reached !== null) {
                // The ranking card scrolls sideways, and an arrow that moves along the chart
                // must not move the card as well.
                event.preventDefault();
                slots.current[reached]?.focus();
                return;
              }
              if (event.key !== "Enter" && event.key !== " ") return;
              // Space scrolls the page otherwise, and a `g` is not a button to the browser.
              event.preventDefault();
              event.stopPropagation();
              onChoose(bar.pillar);
            })
          }
        >
          {/* **A target the full height of the chart**, transparent and drawn first. A pillar
              scoring 19 is a few pixels tall, and a control you have to aim at is one the
              reader gives up on. It also gives the focus ring a constant shape. */}
          {onChoose && (
            <rect
              className="pillar-chart__target"
              x={bar.x}
              y="0"
              width={bar.width}
              height={PILLAR_CHART.height}
            />
          )}
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

type RuleNames = Parameters<typeof citizenshipVerdict>[1];

/**
 * Why a candidate stands where it does: what ruled it out, why it could not be scored, and
 * what a rule warned of.
 *
 * Two kinds of reason, and they are not the same thing. `non_match_reasons` say why a candidate
 * that COULD be scored does not match; `insufficient_reason` says why one could not be scored at
 * all. A screen that showed only the first would leave every unscoreable candidate with an empty
 * cell and no way to find out why. A warning rules nothing out and changes no score; it sits
 * with the reasons because that is where a reader looks for what a rule had to say
 * (`reqs.md` 3.7a).
 *
 * **A gate the household's citizenships decided is said here, from its codes** (PL-164): it
 * read no answer, so it must not read like one.
 */
function ReasonCell({ result, names }: { result: CandidateResult; names: RuleNames }) {
  const reasons = result.non_match_reasons ?? [];
  const warnings = result.warnings ?? [];
  return (
    <td className="reason-cell">
      {reasons.map((reason, index) => (
        <p key={index} className="table__reason">
          {decidedByCitizenship(reason)
            ? citizenshipVerdict(reason, names)
            : reason.reason_detail}
        </p>
      ))}
      {result.insufficient_reason ? (
        <p className="table__reason">{result.insufficient_reason}</p>
      ) : null}
      {warnings.map((warning, index) => (
        <p key={`warning-${String(index)}`} className="table__reason">
          <span className="chip chip--warning">warning</span>
          {decidedByCitizenship(warning) ? citizenshipVerdict(warning, names) : warning.detail}
        </p>
      ))}
      {reasons.length === 0 && warnings.length === 0 && !result.insufficient_reason && (
        <span className="table__reason table__reason--quiet">Passed every rule</span>
      )}
    </td>
  );
}
