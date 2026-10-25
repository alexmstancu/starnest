import { useCallback } from "react";
import { fetchMatchRuleResults, type MatchRuleResult } from "../../api/endpoints";
import { useMatchRuleNames } from "../../api/useMatchRuleNames";
import { useRead } from "../../api/useRead";
import type { SourceNames } from "../../api/useSourceNames";
import { formatDate, matchRuleName, safeHttpUrl, sourceName } from "../../format/display";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { dayOf, describeAge, periodHasEnded } from "../configure/gateAnswerReading";
import { describePeriod } from "../configure/proposals/proposalReading";
import { answerInWords, answersAbout } from "./candidateGates";

/**
 * The gates answered about one candidate (PL-154, `reqs.md` 8.4): the answer, the period it
 * holds for, how old it is, who answered and from which pages -- so a candidate a gate ruled
 * out can be traced to the answer that did it, and one a gate let through leaves a trace too.
 *
 * **An ended period expires nothing** (the household's policy, 2026-10-13): it is said, as
 * "Ended, still applied", and the answer still counts until a person changes it.
 */
export function CandidateGatesPanel({
  candidate,
  name,
  sources,
}: {
  candidate: string;
  name: string;
  sources: SourceNames;
}) {
  const gates = useMatchRuleNames();
  const answers = useRead(
    useCallback((signal: AbortSignal) => fetchMatchRuleResults({ signal }), []),
  );
  const now = new Date();
  const today = dayOf(now);

  return (
    <>
      <h3 className="panel__heading">Gates</h3>
      <LoadedRegion
        read={answers.read.state === "idle" ? PENDING : answers.read}
        what="The gate answers"
        skeleton="lines"
        onRetry={answers.reload}
      >
        {(read) => {
          const about = answersAbout(read.items, candidate, today, gates);
          if (about.length === 0) {
            return (
              <p className="screen__note">No gate has been answered about {name}.</p>
            );
          }
          return (
            <div className="table-card">
              <table className="table" aria-label={`Gates answered about ${name}`}>
                <thead>
                  <tr>
                    <th scope="col">Gate</th>
                    <th scope="col">Answer</th>
                    <th scope="col">Holds for</th>
                    <th scope="col">Recorded</th>
                    <th scope="col">Source and pages</th>
                  </tr>
                </thead>
                <tbody>
                  {about.map((answer) => (
                    <GateRow
                      key={`${answer.match_rule} ${String(answer.is_proposal === true)}`}
                      answer={answer}
                      gate={matchRuleName(gates, answer.match_rule)}
                      source={sourceName(sources, answer.data_source)}
                      ended={periodHasEnded(answer.reference_period, today)}
                      now={now}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </LoadedRegion>
    </>
  );
}

const PENDING = { state: "pending" } as const;

function GateRow({
  answer,
  gate,
  source,
  ended,
  now,
}: {
  answer: MatchRuleResult;
  gate: string;
  source: string;
  ended: boolean;
  now: Date;
}) {
  const recordedAt = answer.recorded_at ?? answer.retrieval_date;
  return (
    <tr className={ended ? "table__row answer-row--ended" : "table__row"}>
      <th scope="row">{gate}</th>
      <td>
        {answerInWords(answer)}
        {answer.override_reason != null && (
          <p className="screen__note">
            Overridden on {formatDate(answer.override_date)}: {answer.override_reason}
          </p>
        )}
      </td>
      <td>
        {describePeriod(answer.reference_period)}
        {ended && answer.reference_period != null && (
          <p className="answer-row__ended">
            Ended, still applied: its period ended on {formatDate(answer.reference_period.end)},
            and it applies until a person changes it.
          </p>
        )}
      </td>
      <td>
        {recordedAt == null
          ? "Not known"
          : `${formatDate(recordedAt)}, ${describeAge(recordedAt, now)}`}
      </td>
      <td>
        {source}
        {answer.reason != null && answer.reason !== "" && <p>{answer.reason}</p>}
        <ul className="lock-list">
          {(answer.citations ?? []).map((page) => (
            <li key={page}>
              <Page page={page} />
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

/** A page, as a link only when it is a web address: a `javascript:` one behind a click runs. */
function Page({ page }: { page: string }) {
  const address = safeHttpUrl(page);
  if (address === null) return <>{page}</>;
  return (
    <a href={address} rel="noreferrer noopener" target="_blank">
      {page}
    </a>
  );
}
