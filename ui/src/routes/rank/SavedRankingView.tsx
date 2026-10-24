import { useCallback } from "react";
import { type Ranking, fetchEvaluation } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { formatScore } from "../../format/display";
import { isScale } from "../../format/scoreScale";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { RankingTable } from "./RankingTable";

/**
 * One saved ranking, exactly as it was when it was saved.
 *
 * It renders through the same `RankingTable` as the live ranking, because `GET
 * /evaluations/{id}` answers in the same shape -- carrying the scale it froze, which the table
 * draws against rather than today's setting. **No drill-down**: an evaluation freezes the
 * criteria and the score scale it used, but the stored values behind it have gone on moving,
 * so opening today's evidence under yesterday's score would put two moments in one panel and
 * call the result provenance.
 */
export function SavedRankingView({ evaluationId }: { evaluationId: number }) {
  const { resource, reload } = useResource(
    useCallback(
      (signal: AbortSignal): Promise<Ranking> =>
        fetchEvaluation(evaluationId, { signal }),
      [evaluationId],
    ),
  );

  return (
    <div className="saved__view">
      {resource.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}
      {resource.status === "error" && (
        <ErrorNotice error={resource.error} onRetry={reload} />
      )}
      {resource.status === "ready" && (
        <>
          {/* The frozen scale, said in words (PL-062): today's setting may have moved, and
              every bar below is drawn against this one. */}
          <p className="screen__note">
            As it was when it was saved
            {isScale(resource.data.score_scale_max) &&
              `, scored out of ${formatScore(resource.data.score_scale_max)}`}
            . The criteria and the score range are frozen with it, so this
            keeps meaning what it meant.
          </p>
          <RankingTable ranking={resource.data} />
        </>
      )}
    </div>
  );
}
