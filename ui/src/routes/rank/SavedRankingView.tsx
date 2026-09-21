import { useCallback } from "react";
import { type Ranking, fetchEvaluation } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { RankingTable } from "./RankingTable";

/**
 * One saved ranking, exactly as it was when it was saved.
 *
 * It renders through the same `RankingTable` as the live ranking, because `GET
 * /evaluations/{id}` answers in the same shape. **No drill-down**: an evaluation freezes the
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
          <p className="screen__note">
            As it was when it was saved. The criteria and the score range are
            frozen with it, so this keeps meaning what it meant.
          </p>
          <RankingTable ranking={resource.data} />
        </>
      )}
    </div>
  );
}
