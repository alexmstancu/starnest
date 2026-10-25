import { useCallback, useState } from "react";
import {
  type EvaluationSummary,
  type Ranking,
  fetchEvaluation,
  fetchEvaluations,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import {
  criteriaSetName,
  formatDateTime,
  formatIdentifier,
  formatScore,
} from "../../format/display";
import { isScale } from "../../format/scoreScale";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";
import { type OpenCandidate, type OpenRow, toggleRow } from "./openRows";
import { RankingTable } from "./RankingTable";
import { SavedCandidateDetail } from "./SavedCandidateDetail";
import type { HomeRead } from "./rankTable";

/**
 * One saved ranking, exactly as it was when it was saved.
 *
 * It renders through the same `RankingTable` as the live ranking, because `GET
 * /evaluations/{id}` answers in the same shape -- carrying the scale it froze, which the table
 * draws against rather than today's setting, its pillars, and Δ home against the household's
 * current home (PL-144). **Its rows open the saved evidence**, never today's: each figure a
 * contribution scored and each answer a rule read were kept with it (D46), so the drill-down
 * shows one moment rather than two.
 */
export function SavedRankingView({
  evaluationId,
  home,
}: {
  evaluationId: number;
  /** The household's current home, read once by the screen for both tables. */
  home: HomeRead;
}) {
  const { resource, reload } = useResource(
    useCallback(
      (signal: AbortSignal): Promise<Ranking> =>
        fetchEvaluation(evaluationId, { signal }),
      [evaluationId],
    ),
  );
  const [open, setOpen] = useState<readonly OpenRow[]>([]);
  const toggle = useCallback(
    (row: OpenCandidate) => setOpen((already) => toggleRow(already, row)),
    [],
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
          <SavedIdentity evaluationId={evaluationId} ranking={resource.data} />
          <RankingTable
            ranking={resource.data}
            open={open}
            onToggle={toggle}
            household={home}
            detail={(row) => (
              <SavedCandidateDetail
                evaluationId={evaluationId}
                candidate={row.candidate}
                name={row.name}
              />
            )}
          />
        </>
      )}
    </div>
  );
}

/**
 * What this ranking is: why it was kept, which set at which level, when, and on what scale.
 *
 * The note is the summary's, not the ranking's, so it is a read of its own -- and one that
 * fails says so rather than reading as a ranking kept without a reason.
 */
function SavedIdentity({
  evaluationId,
  ranking,
}: {
  evaluationId: number;
  ranking: Ranking;
}) {
  const { criteriaSets } = useSelection();
  const sets = new Map(criteriaSets.map((set) => [set.id, set.name]));
  const list = useResource(
    useCallback(
      (signal: AbortSignal): Promise<{ items: EvaluationSummary[] }> =>
        fetchEvaluations({ signal }),
      [],
    ),
  );
  const summary =
    list.resource.status === "ready"
      ? list.resource.data.items.find((each) => each.id === evaluationId)
      : undefined;
  const note = summary?.note?.trim();

  return (
    <>
      {list.resource.status === "ready" && (
        <p className="saved__note">
          {note ? `“${note}”` : "Kept without a note."}
        </p>
      )}
      {list.resource.status === "error" && (
        <p className="screen__note">Its note could not be read.</p>
      )}
      <dl className="meta-row">
        <SavedFact label="Criteria set" value={criteriaSetName(sets, ranking.criteria_set)} />
        <SavedFact label="Level" value={formatIdentifier(ranking.level)} />
        <SavedFact label="Saved" value={formatDateTime(ranking.computed_at)} />
        {isScale(ranking.score_scale_max) && (
          <SavedFact label="Scored out of" value={formatScore(ranking.score_scale_max)} />
        )}
      </dl>
      {/* The frozen scale, said in words (PL-062): today's setting may have moved, and every
          bar below is drawn against this one. */}
      <p className="screen__note">
        As it was when it was saved. The criteria, the score range and every
        figure behind a score are frozen with it; Δ home is against where the
        household lives now.
      </p>
    </>
  );
}

function SavedFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-row__item">
      <dt className="meta-row__label">{label}</dt>
      <dd className="meta-row__value">{value}</dd>
    </div>
  );
}
