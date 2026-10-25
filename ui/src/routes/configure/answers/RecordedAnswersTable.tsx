import type { MatchRuleResult } from "../../../api/endpoints";
import { formatDate, formatMatchStatus, safeHttpUrl } from "../../../format/display";
import { describeAge, describePeriod, periodHasEnded } from "../gateAnswerReading";
import type { PendingProposal } from "./gateAnswerForm";

/**
 * The answers a person recorded, each with the period it holds for, how old it is, and -- when
 * that period has ended -- that it is **still applied** (BE-36 stage 1). Nothing expires an
 * answer (the household's policy, 2026-10-13); this is where a person sees which to look at
 * again. A re-check's proposal sits under the answer it is about, read-only until taken.
 */
export function RecordedAnswersTable({
  recorded,
  names,
  citizenshipName,
  today,
  now,
  held,
  onChange,
  onTake,
}: {
  /** In reading order already: ended periods first. */
  recorded: readonly MatchRuleResult[];
  names: (answer: MatchRuleResult) => [gate: string, candidate: string];
  /** A citizenship by its country's name, never its id. */
  citizenshipName: (candidate: string) => string;
  today: string;
  now: Date;
  /** A write is in flight or the list is outdated: the buttons keep focus and do nothing. */
  held: boolean;
  onChange: (answer: MatchRuleResult) => void;
  onTake: (answer: MatchRuleResult, proposal: PendingProposal) => void;
}) {
  if (recorded.length === 0) {
    return (
      <p className="screen__note">No gate answer has been recorded by hand at this level yet.</p>
    );
  }
  return (
    <table className="table">
      <caption>Recorded gate answers. Each applies until you change it.</caption>
      <thead>
        <tr>
          <th scope="col">Gate</th>
          <th scope="col">Candidate</th>
          <th scope="col">Answer</th>
          <th scope="col">Holds for</th>
          <th scope="col">Recorded</th>
          <th scope="col">Override</th>
          <th scope="col">Reason and pages</th>
          <th scope="col">
            <span className="visually-hidden">Change</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {recorded.map((answer) => {
          const [gate, candidate] = names(answer);
          const pending = answer.pending_proposal ?? null;
          return [
            <AnswerRow
              key={`${answer.match_rule} ${answer.candidate}`}
              answer={answer}
              gate={gate}
              candidate={candidate}
              ended={periodHasEnded(answer.reference_period, today)}
              citizenshipName={citizenshipName}
              now={now}
              held={held}
              onChange={() => onChange(answer)}
            />,
            pending !== null && (
              <PendingRow
                key={`${answer.match_rule} ${answer.candidate} pending`}
                proposal={pending}
                gate={gate}
                candidate={candidate}
                held={held}
                onTake={() => onTake(answer, pending)}
              />
            ),
          ];
        })}
      </tbody>
    </table>
  );
}

function AnswerRow({
  answer,
  gate,
  candidate,
  ended,
  citizenshipName,
  now,
  held,
  onChange,
}: {
  answer: MatchRuleResult;
  gate: string;
  candidate: string;
  ended: boolean;
  citizenshipName: (candidate: string) => string;
  now: Date;
  held: boolean;
  onChange: () => void;
}) {
  const recordedAt = answer.recorded_at ?? answer.retrieval_date;
  return (
    <tr className={ended ? "table__row answer-row--ended" : "table__row"}>
      <th scope="row">{gate}</th>
      <td>{candidate}</td>
      <td>{formatMatchStatus(answer.match_result)}</td>
      <td>
        {describePeriod(answer.reference_period)}
        {ended && answer.reference_period != null && (
          <p className="answer-row__ended">
            Ended, still applied: its period ended on {formatDate(answer.reference_period.end)},
            and it applies until you change it.
          </p>
        )}
      </td>
      <td>
        {recordedAt === undefined ? "Not known" : `${formatDate(recordedAt)}, ${describeAge(recordedAt, now)}`}
        <CitizenshipsAssumed answer={answer} citizenshipName={citizenshipName} />
      </td>
      <td>
        {answer.override_reason == null ? (
          "None"
        ) : (
          <>
            <p>{answer.override_reason}</p>
            <p className="screen__note">Overridden on {formatDate(answer.override_date)}</p>
          </>
        )}
      </td>
      <td>
        <ReasonAndPages reason={answer.reason} pages={answer.citations ?? []} />
      </td>
      <td>
        <button
          type="button"
          className="button"
          aria-disabled={held || undefined}
          onClick={() => {
            if (!held) onChange();
          }}
        >
          Change {gate} for {candidate}
        </button>
      </td>
    </tr>
  );
}

/**
 * Which citizenships the answer assumed when it was recorded, and whether it needs checking
 * again because the household's differ (Q239). A flag only: the answer still applies.
 */
function CitizenshipsAssumed({
  answer,
  citizenshipName,
}: {
  answer: MatchRuleResult;
  citizenshipName: (candidate: string) => string;
}) {
  const assumed = answer.assumed_citizenships;
  return (
    <>
      {assumed != null && (
        <p className="screen__note">
          {assumed.length === 0
            ? "Recorded with no household."
            : `Assumed citizenship of ${namesInASentence(assumed.map(citizenshipName))}.`}
        </p>
      )}
      {answer.needs_recheck === true && (
        <p className="answer-row__ended">
          {assumed == null
            ? "Recorded before citizenships were kept: check it again."
            : "Recorded for a different citizenship: check it again."}
        </p>
      )}
    </>
  );
}

function namesInASentence(names: readonly string[]): string {
  const sorted = [...names].sort();
  return sorted.length <= 1
    ? (sorted[0] ?? "")
    : `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

function PendingRow({
  proposal,
  gate,
  candidate,
  held,
  onTake,
}: {
  proposal: PendingProposal;
  gate: string;
  candidate: string;
  held: boolean;
  onTake: () => void;
}) {
  return (
    <tr className="table__row answer-row--pending">
      <td colSpan={7}>
        <p>
          A re-check proposes {formatMatchStatus(proposal.match_result)},{" "}
          {proposal.reference_period == null
            ? "with no period recorded"
            : `for ${describePeriod(proposal.reference_period)}`}
          . Read on {formatDate(proposal.retrieval_date)}. It changes nothing until you take it.
        </p>
        <ReasonAndPages reason={proposal.reason} pages={proposal.citations} />
      </td>
      <td>
        <button
          type="button"
          className="button"
          aria-disabled={held || undefined}
          onClick={() => {
            if (!held) onTake();
          }}
        >
          Take the proposal for {gate} and {candidate}
        </button>
      </td>
    </tr>
  );
}

function ReasonAndPages({ reason, pages }: { reason?: string | null; pages: readonly string[] }) {
  return (
    <>
      {reason != null && reason !== "" && <p>{reason}</p>}
      <ul className="lock-list">
        {pages.map((page) => (
          <li key={page}>
            <PageLink page={page} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * A page, as a link only when it is a web address. The server stores any string a caller sent
 * as a gate's page, and a `javascript:` one behind a click is a script.
 */
function PageLink({ page }: { page: string }) {
  const address = safeHttpUrl(page);
  if (address === null) return <>{page}</>;
  return (
    <a href={address} rel="noreferrer noopener" target="_blank">
      {page}
    </a>
  );
}
