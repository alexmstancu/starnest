import { useState } from "react";
import type { MatchRuleResult } from "../../../api/endpoints";
import { formatMoney } from "../../../format/display";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import {
  SPEND_NOT_KNOWN,
  describePass,
  describePeriod,
} from "./proposalReading";
import { useProposals } from "./useProposals";

/**
 * Gate answers a model proposed, and the one act that makes them count (`reqs.md` 6.10 use 3).
 *
 * **A proposal rules nothing out.** A model read the official pages about a visa route or a
 * quota and reported what they say, with the pages; nothing about a ranking changes until a
 * person writes the same answer themselves. That is the rule the whole permitted use rests on,
 * so the panel says it out loud rather than styling it as a warning nobody reads.
 *
 * **Researching costs money**, and this is the only screen in the application that can spend
 * any. So the estimate is a separate act with its own button: the household agrees to a figure,
 * not to a verb. The refusal when no spend cap is set is shown with the one thing that answers
 * it -- an explicit acceptance of an uncapped pass, per request and never remembered.
 *
 * **Markup only.** Reading, estimating, researching and confirming are `useProposals.ts`.
 */
export function ProposalsPanel({
  levelId,
  onAnswered,
}: {
  levelId: string;
  /** A gate answer has been written here, so anything else describing the answers re-reads. */
  onAnswered: () => void;
}) {
  const proposals = useProposals(onAnswered);
  const [acceptUncapped, setAcceptUncapped] = useState(false);
  // **Held while an estimate, a pass or a confirmation is in flight, never disabled** (NEW-44):
  // Chromium throws focus off a control the moment it is disabled and does not give it back, so
  // a keyboard user was put back on the page after each. Held, a button keeps focus and says
  // so, and the hook turns its press away.
  const held = proposals.busy !== null;

  return (
    <section className="panel" aria-labelledby="proposals-heading">
      <h3 id="proposals-heading" className="panel__heading">
        Gate proposals
      </h3>
      <p className="panel__hint">
        A model can read the official pages about each gate and propose an
        answer with the pages it read. A proposal rules nothing out: confirming
        one records it as your own answer, and only then does the gate act on
        it. Researching costs money.
      </p>

      {proposals.failure !== null && <ErrorNotice error={proposals.failure} />}

      <div className="rule-form__actions">
        <button
          type="button"
          className="button"
          aria-disabled={held || undefined}
          onClick={() => proposals.estimate(levelId)}
        >
          {proposals.busy === "estimating"
            ? "Estimating…"
            : "Estimate the research"}
        </button>
        {proposals.plan !== null && (
          <button
            type="button"
            className="button"
            aria-disabled={held || undefined}
            onClick={() => {
              // Turned away whole, the box included: a held press that cleared it would forget
              // an agreement given for the next pass.
              if (held) return;
              proposals.research(levelId, acceptUncapped);
              // **Per request, never remembered** -- which is what the comment below has
              // always said and what the state did not do: left ticked, it authorised every
              // later pass silently. The box is cleared as the pass is asked for, so agreeing
              // again is a deliberate act again.
              setAcceptUncapped(false);
            }}
          >
            {proposals.busy === "researching"
              ? "Researching…"
              : "Research the gates"}
          </button>
        )}
      </div>

      {/* Only offered once an estimate exists, because agreeing to an uncapped spend before
          seeing what it would cost is the decision this panel exists to prevent. */}
      {proposals.plan !== null && (
        <>
          <p className="screen__note">
            {proposals.plan.gates_total} gate answers to research,{" "}
            {proposals.plan.llm_call_count} calls, about{" "}
            {formatMoney(proposals.plan.estimated_cost_eur, "EUR")}.
          </p>
          {proposals.plan.estimate_basis != null && (
            <p className="screen__note">
              The cost is a ceiling, not a forecast:{" "}
              {proposals.plan.estimate_basis}
            </p>
          )}
          <label className="field field--inline" htmlFor="accept-uncapped">
            <input
              id="accept-uncapped"
              type="checkbox"
              checked={acceptUncapped}
              onChange={(event) => setAcceptUncapped(event.target.checked)}
            />
            Accept an uncapped spend for this pass
          </label>
        </>
      )}

      {/* Beside the estimate, so a ceiling and what was actually spent read together. A stop
          at the spend cap is a warning, because the gates after it were never asked. */}
      {proposals.lastPass !== null &&
        (proposals.lastPass.halted_on_spend_cap ? (
          <div className="notice notice--warning" role="status">
            <p className="notice__message">{describePass(proposals.lastPass)}</p>
          </div>
        ) : (
          <p className="screen__note" role="status">
            {describePass(proposals.lastPass)}
          </p>
        ))}
      {/* A warning, not a note: money may have been spent that nothing on screen accounts for. */}
      {proposals.spendNotKnown && (
        <div className="notice notice--warning" role="status">
          <p className="notice__message">{SPEND_NOT_KNOWN}</p>
        </div>
      )}

      {proposals.refusals.length > 0 && (
        <>
          <p className="screen__note" id="research-refusals">
            Answered without citing anything, so nothing was stored:
          </p>
          <ul className="lock-list" aria-labelledby="research-refusals">
            {proposals.refusals.map((refusal) => (
              <li key={refusal}>{refusal}</li>
            ))}
          </ul>
        </>
      )}

      {proposals.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}
      {proposals.status === "error" && (
        <ErrorNotice error={proposals.error} onRetry={proposals.reload} />
      )}

      {proposals.status === "ready" && (
        <>
          {proposals.proposals.length === 0 ? (
            <p className="screen__note">
              No proposal is waiting. {proposals.confirmedCount} gate answers
              have been recorded by hand.
            </p>
          ) : (
            <table className="table">
              <caption>
                Proposals. Each rules nothing out until it is confirmed.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Gate</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Proposed</th>
                  <th scope="col">Holds for</th>
                  <th scope="col">Reason and pages</th>
                  <th scope="col">
                    <span className="visually-hidden">Confirm</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {proposals.proposals.map((proposal) => (
                  <ProposalRow
                    key={`${proposal.match_rule}-${proposal.candidate}`}
                    proposal={proposal}
                    held={held}
                    onConfirm={() => proposals.confirm(proposal)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

function ProposalRow({
  proposal,
  held,
  onConfirm,
}: {
  proposal: MatchRuleResult;
  /** A write is in flight, this row's or another: the button keeps focus, the hook refuses it. */
  held: boolean;
  onConfirm: () => void;
}) {
  const pages = proposal.citations ?? [];

  return (
    <tr className="table__row">
      <th scope="row">{proposal.match_rule}</th>
      <td>{proposal.candidate}</td>
      <td>{proposal.match_result}</td>
      <td>{describePeriod(proposal.reference_period)}</td>
      <td>
        <p>{proposal.reason}</p>
        {/* The pages are the point of asking at all: a gate answered with no source is an
            opinion, and an opinion about a visa route is worth less than an open question. */}
        <ul className="lock-list">
          {pages.map((page) => (
            <li key={page}>
              <a href={page} rel="noreferrer noopener" target="_blank">
                {page}
              </a>
            </li>
          ))}
        </ul>
      </td>
      <td>
        <button
          type="button"
          className="button"
          aria-disabled={held || undefined}
          onClick={onConfirm}
        >
          Confirm {proposal.match_rule} for {proposal.candidate}
        </button>
      </td>
    </tr>
  );
}
