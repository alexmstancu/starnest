import { useCallback, useId } from "react";
import {
  fetchCandidateScoreDetail,
  type CandidateScoreDetail,
} from "../../api/endpoints";
import { useRead } from "../../api/useRead";
import { useAttributeNames } from "../../api/useAttributeNames";
import { useSourceNames } from "../../api/useSourceNames";
import { useCandidateNames } from "../../api/useCandidateNames";
import { useMatchRuleClearing, useMatchRuleNames } from "../../api/useMatchRuleNames";
import { attributeName } from "../../format/display";
import { scoreRange } from "../../format/scoreScale";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { scoresByAttribute } from "./attributeScores";
import { citizenshipVerdict, decidedByCitizenship } from "./citizenshipVerdict";
import {
  NOT_RECORDED,
  savedFigure,
  savedGateAnswer,
  savedInputs,
  type Provenance,
} from "./savedEvidence";

/**
 * One candidate of a saved ranking: each figure it was scored on, as it was when it was saved
 * (PL-144, D46).
 *
 * **The saved rows, never today's.** The live drill-down reads the values stored now; this
 * reads the row each contribution scored and the evidence each rule read, frozen with the
 * ranking -- so a figure fetched since cannot sit under a score it did not produce. A ranking
 * saved before the evidence was kept says "not recorded" where it has none.
 */
export function SavedCandidateDetail({
  evaluationId,
  candidate,
  name,
}: {
  evaluationId: number;
  candidate: string;
  name: string;
}) {
  const headingId = useId();
  const { read, reload } = useRead(
    useCallback(
      (signal: AbortSignal): Promise<CandidateScoreDetail> =>
        fetchCandidateScoreDetail(evaluationId, candidate, { signal }),
      [evaluationId, candidate],
    ),
  );

  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel__head">
        <h2 id={headingId} className="panel__heading">
          {name}: every figure behind the saved score
        </h2>
        <span className="panel__count">As it was when it was saved.</span>
      </div>
      {read.state !== "idle" && (
        <LoadedRegion
          read={read}
          what="The saved figures"
          skeleton="rank-table"
          onRetry={reload}
        >
          {(detail) => <SavedEvidence detail={detail} />}
        </LoadedRegion>
      )}
    </section>
  );
}

function SavedEvidence({ detail }: { detail: CandidateScoreDetail }) {
  const names = useAttributeNames();
  const sources = useSourceNames();
  const scores = detail.attribute_scores ?? [];
  const readings = scoresByAttribute(scores);
  const range = scoreRange(detail.score_scale_max);

  return (
    <>
      <RuleEvidence detail={detail} sources={sources} />
      {scores.length === 0 ? (
        <p className="screen__note">No figure was scored for this candidate.</p>
      ) : (
        <div className="table-card table-card--values">
          <table className="table table--values" aria-label="Saved figures">
            <thead>
              <tr>
                <th scope="col">Attribute</th>
                <th scope="col">Figure scored</th>
                <th scope="col" className="col--right">
                  {range === "" ? "Score" : `Score ${range}`}
                </th>
                <th scope="col" className="col--right">
                  Weight used
                </th>
                <th scope="col" className="col--right">
                  Contribution
                </th>
              </tr>
            </thead>
            <tbody>
              {scores.map((row) => {
                const reading = readings.get(row.attribute);
                const figure = savedFigure(row.value, reading?.placed === true, sources);
                return (
                  <tr key={row.attribute} className="table__row">
                    <th scope="row" className="value-cell">
                      <span className="value-cell__name">
                        {attributeName(names, row.attribute)}
                      </span>
                      {figure.kind === "recorded" && (
                        <ProvenanceFacts provenance={figure.provenance} />
                      )}
                    </th>
                    <td className="figure-cell">
                      {figure.kind === "recorded" && (
                        <span className="figure-cell__figure">
                          {figure.provenance.figure}
                        </span>
                      )}
                      {figure.kind === "not_recorded" && (
                        <span className="saved-evidence__unrecorded">{NOT_RECORDED}</span>
                      )}
                      {figure.kind === "no_figure" && (
                        <span className="saved-evidence__unrecorded">No figure</span>
                      )}
                    </td>
                    <td className="col--right value-weight">{reading?.score}</td>
                    <td className="col--right value-weight">{reading?.weightUsed}</td>
                    <td className="col--right value-weight">{reading?.pointsAdded}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Why the candidate stands where it does: each refusal and warning, with what it read. */
function RuleEvidence({
  detail,
  sources,
}: {
  detail: CandidateScoreDetail;
  sources: ReadonlyMap<string, string>;
}) {
  const names = {
    gates: useMatchRuleNames(),
    candidates: useCandidateNames(),
    clearing: useMatchRuleClearing(),
  };
  const reasons = detail.non_match_reasons ?? [];
  const warnings = detail.warnings ?? [];
  if (reasons.length === 0 && warnings.length === 0) return null;

  return (
    <ul className="saved-evidence" aria-label="What the rules read">
      {reasons.map((reason, index) => {
        const gate = reason.match_rule != null;
        const answer = savedGateAnswer(reason.gate_answer, sources);
        const inputs = savedInputs(reason.inputs, sources);
        // PL-164: the citizenships it read stand where an answer would, and none is claimed.
        if (decidedByCitizenship(reason)) {
          return (
            <li key={`reason-${index}`} className="saved-evidence__item">
              <span className="saved-evidence__what">{citizenshipVerdict(reason, names)}</span>
            </li>
          );
        }
        return (
          <li key={`reason-${index}`} className="saved-evidence__item">
            <span className="saved-evidence__what">{reason.reason_detail}</span>
            {gate &&
              (answer === null ? (
                <span className="saved-evidence__unrecorded">
                  Gate answer {NOT_RECORDED}
                </span>
              ) : (
                <dl className="value-cell__meta">
                  <dt className="value-cell__label">Gate answer</dt>
                  <dd className="value-cell__fact">{answer.answer}</dd>
                  {answer.reason !== null && (
                    <>
                      <dt className="value-cell__label">Why</dt>
                      <dd className="value-cell__fact">{answer.reason}</dd>
                    </>
                  )}
                  <dt className="value-cell__label">Source</dt>
                  <dd className="value-cell__fact">{answer.source}</dd>
                  {answer.describes !== null && (
                    <>
                      <dt className="value-cell__label">Describes</dt>
                      <dd className="value-cell__fact">{answer.describes}</dd>
                    </>
                  )}
                  <dt className="value-cell__label">Checked</dt>
                  <dd className="value-cell__fact">{answer.fetched}</dd>
                </dl>
              ))}
            {!gate && <Inputs inputs={inputs} />}
          </li>
        );
      })}
      {warnings.map((warning, index) => (
        <li key={`warning-${String(index)}`} className="saved-evidence__item">
          <span className="saved-evidence__what">
            <span className="chip chip--warning">warning</span>
            {decidedByCitizenship(warning) ? citizenshipVerdict(warning, names) : warning.detail}
          </span>
          {!decidedByCitizenship(warning) && (
            <Inputs inputs={savedInputs(warning.inputs, sources)} />
          )}
        </li>
      ))}
    </ul>
  );
}

function Inputs({ inputs }: { inputs: Provenance[] | null }) {
  if (inputs === null) {
    return (
      <span className="saved-evidence__unrecorded">Figures read {NOT_RECORDED}</span>
    );
  }
  return (
    <>
      {inputs.map((input, index) => (
        <span key={index} className="saved-evidence__input">
          <span className="figure-cell__figure">{input.figure}</span>
          <ProvenanceFacts provenance={input} />
        </span>
      ))}
    </>
  );
}

function ProvenanceFacts({ provenance }: { provenance: Provenance }) {
  return (
    <span className="value-cell__meta">
      <span className="value-cell__label">Source</span>
      <span className="value-cell__fact">{provenance.source}</span>
      <span className="value-cell__label">Describes</span>
      <span className="value-cell__fact">{provenance.describes}</span>
      <span className="value-cell__label">Fetched</span>
      <span className="value-cell__fact">{provenance.fetched}</span>
    </span>
  );
}
