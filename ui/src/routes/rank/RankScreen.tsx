import { useCallback, useState } from "react";
import {
  fetchRanking,
  type CandidateResult,
  type Ranking,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import type { RouteDefinition } from "../../navigation/routes";
import {
  ABSENT,
  formatDateTime,
  formatMatchStatus,
  formatPercentage,
  formatScore,
} from "../../format/display";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { CandidateDetail } from "./CandidateDetail";
import {
  type ConfidenceSplit,
  confidenceBands,
  confidenceLabel,
  coverageBar,
} from "./rankTable";
import { useSelection } from "../../shell/SelectionContext";

/**
 * The ranking table: every candidate the selected criteria set was run against, with its
 * score, its coverage and its match status.
 *
 * **Every figure on this screen came from `GET /v1/rankings`.** Nothing is computed here, not
 * even a re-sort: the order, the ranks, the scores and the coverage percentages are the
 * server's, and the interface's whole job is to print them without changing what they mean.
 *
 * Two rules from `reqs.md` shape what it shows, and they are the reason the screen exists:
 *
 * 1. **Non-matching candidates stay visible, keeping their score, with the reason shown**
 *    (5.4). Filtering them out would hide exactly what a rule is costing you.
 * 2. **A candidate with insufficient data shows no number** (5.3). Not a zero, not a rounded
 *    guess -- its coverage is shown instead, because coverage is what explains the status.
 */
export function RankScreen({ route }: { route: RouteDefinition }) {
  const { criteriaSetId, levelId } = useSelection();

  return (
    <section className="screen" aria-labelledby="screen-heading">
      <h2 id="screen-heading" className="screen__heading">
        {route.label}
      </h2>

      {/* Keyed by the selection, the way `ConfigureScreen` keys its panels: the open
          drill-down is state about *this* ranking, and a switch of level or criteria set
          makes it state about a ranking nobody is looking at (P53). It used to survive the
          switch -- a provenance panel for Portugal sitting under a table of cities, with no
          row matching it, so no button read "Hide figures" and nothing could close it. A
          key rather than an effect, because React resets state on identity and clearing it
          from an effect is a render the screen does not need. */}
      <TheRanking
        key={`${criteriaSetId}-${levelId}`}
        criteriaSetId={criteriaSetId}
        levelId={levelId}
      />
    </section>
  );
}

function TheRanking({
  criteriaSetId,
  levelId,
}: {
  criteriaSetId: string | null;
  levelId: string | null;
}) {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<Ranking> => {
      // Not reachable while disabled; the guard is here so the type is honest.
      if (!criteriaSetId || !levelId) throw new Error("no selection");
      return fetchRanking(criteriaSetId, levelId, { signal });
    },
    [criteriaSetId, levelId],
  );

  const { resource, reload } = useResource(
    fetcher,
    criteriaSetId !== null && levelId !== null,
  );
  // Which candidate's evidence is open. Client state in the sense `arch.md` 8.1 permits: it
  // decides nothing, and the evidence itself is fetched.
  const [chosen, setChosen] = useState<{
    candidate: string;
    name: string;
  } | null>(null);

  return (
    <>
      {resource.status === "idle" && (
        <p className="screen__note">
          Choose a criteria set and a level to see the ranking.
        </p>
      )}
      {resource.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}
      {resource.status === "error" && (
        <ErrorNotice error={resource.error} onRetry={reload} />
      )}
      {resource.status === "ready" && (
        <RankingTable
          ranking={resource.data}
          chosen={chosen}
          onChoose={setChosen}
        />
      )}

      {chosen && (
        <CandidateDetail candidate={chosen.candidate} name={chosen.name} />
      )}
    </>
  );
}

function RankingTable({
  ranking,
  chosen,
  onChoose,
}: {
  ranking: Ranking;
  chosen: { candidate: string; name: string } | null;
  onChoose: (chosen: { candidate: string; name: string } | null) => void;
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
          <table className="table table--ranking">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Candidate</th>
                <th scope="col">Score</th>
                <th scope="col">Coverage</th>
                <th scope="col">Confidence</th>
                <th scope="col">Match status</th>
                <th scope="col">Reason</th>
                <th scope="col"> </th>
              </tr>
            </thead>
            <tbody>
              {ranking.candidates.map((result) => (
                <CandidateRow
                  key={result.candidate}
                  result={result}
                  open={chosen?.candidate === result.candidate}
                  onChoose={onChoose}
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
  onChoose,
}: {
  result: CandidateResult;
  open: boolean;
  onChoose: (chosen: { candidate: string; name: string } | null) => void;
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
      <td>
        <button
          type="button"
          className={open ? "button button--current" : "button"}
          onClick={() =>
            onChoose(
              open ? null : { candidate: result.candidate, name: result.name },
            )
          }
        >
          {open ? "Hide figures" : "Show figures"}
        </button>
      </td>
    </tr>
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
      <svg className="meter__track" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
        <rect className={`meter__fill meter__fill--${bar.tone}`} width={bar.width} height="6" />
      </svg>
      <span className="meter__reading">{formatPercentage(coverage)} covered</span>
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
function ConfidenceBar({ split }: { split: ConfidenceSplit | null | undefined }) {
  const bands = confidenceBands(split);

  return (
    <div className="meter">
      <svg className="meter__track" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
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
