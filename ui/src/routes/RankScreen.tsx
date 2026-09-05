import { useCallback } from "react";
import { fetchRanking, type CandidateResult, type Ranking } from "../api/endpoints";
import { useResource } from "../api/useResource";
import type { RouteDefinition } from "../app/routes";
import { formatDateTime, formatMatchStatus, formatPercentage, formatScore } from "../format/display";
import { ErrorNotice } from "../shell/ErrorNotice";
import { useSelection } from "../shell/SelectionContext";

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

  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<Ranking> => {
      // Not reachable while disabled; the guard is here so the type is honest.
      if (!criteriaSetId || !levelId) throw new Error("no selection");
      return fetchRanking(criteriaSetId, levelId, { signal });
    },
    [criteriaSetId, levelId],
  );

  const { resource, reload } = useResource(fetcher, criteriaSetId !== null && levelId !== null);

  return (
    <section className="screen" aria-labelledby="screen-heading">
      <h2 id="screen-heading" className="screen__heading">
        {route.label}
      </h2>

      {resource.status === "idle" && (
        <p className="screen__note">Choose a criteria set and a level to see the ranking.</p>
      )}
      {resource.status === "loading" && <p className="screen__note">Loading…</p>}
      {resource.status === "error" && <ErrorNotice error={resource.error} onRetry={reload} />}
      {resource.status === "ready" && <RankingTable ranking={resource.data} />}
    </section>
  );
}

function RankingTable({ ranking }: { ranking: Ranking }) {
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
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Candidate</th>
              <th scope="col">Score</th>
              <th scope="col">Coverage</th>
              <th scope="col">Match status</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {ranking.candidates.map((result) => (
              <CandidateRow key={result.candidate} result={result} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * `reqs.md` 5.4: a non-matching candidate keeps its computed score, greyed out. The row stays
 * in the same table as the rest -- a separate "rejected" list would be a filter by another
 * name, and the ordering would stop meaning anything.
 */
function CandidateRow({ result }: { result: CandidateResult }) {
  const matching = result.match_status === "matching";

  return (
    <tr className={matching ? "table__row" : "table__row table__row--not-matching"}>
      <td>{result.rank ?? ""}</td>
      <th scope="row">{result.name}</th>
      <ScoreCell result={result} />
      <td className="table__cell--numeric">{formatPercentage(result.coverage)}</td>
      <td>{formatMatchStatus(result.match_status)}</td>
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
      </td>
    </tr>
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
