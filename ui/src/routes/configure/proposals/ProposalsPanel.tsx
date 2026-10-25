import { useEffect, useRef, useState } from "react";
import type { MatchRuleResult } from "../../../api/endpoints";
import { useCandidateNames } from "../../../api/useCandidateNames";
import { useMatchRuleNames } from "../../../api/useMatchRuleNames";
import {
  candidateName,
  formatMatchStatus,
  formatDate,
  formatMoney,
  matchRuleName,
  safeHttpUrl,
} from "../../../format/display";
import { ActRefusal } from "../../../shell/ActRefusal";
import { CheckboxField } from "../../../shell/CheckboxField";
import { LoadedRegion } from "../../../shell/LoadedRegion";
import { refocusIfLost } from "../../../shell/focusReturn";
import { describePeriod } from "./proposalReading";
import { leavesEstimateUnspent } from "./researchPass";
import { proposalKey, useFocusAfterConfirm } from "./useFocusAfterConfirm";
import { useFocusAfterPass } from "./useFocusAfterPass";
import { useProposals } from "./useProposals";
import type { ResearchPass } from "./useResearchPass";

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
 * it -- an explicit acceptance of an uncapped pass, per pass and never remembered.
 *
 * **A pass asks one gate at a time, and says so as it goes** (UI-01, UI-14): which gate, the
 * calls and the spend beside the estimate's ceiling, a Stop that takes effect after the question
 * in flight, and how it ended. The pass is the screen's, handed in, so switching the criteria
 * set -- which draws this panel again -- does not end it.
 *
 * **Markup only.** Reading, estimating and confirming are `useProposals.ts`; the pass is
 * `useResearchPass.ts`.
 */
export function ProposalsPanel({
  levelId,
  onAnswered,
  answersFreshness,
  pass,
  standsAlone = false,
}: {
  levelId: string;
  /** A gate answer has been written here, so anything else describing the answers re-reads. */
  onAnswered: () => void;
  /** Changes when a gate answer has been written anywhere, so the proposals are read again. */
  answersFreshness: number;
  /** The research pass the screen holds: running, or how the last one ended. */
  pass: ResearchPass;
  /**
   * Drawn for the pass alone, beside a set that is not read: dismissing its outcome removes the
   * panel, Estimate included.
   */
  standsAlone?: boolean;
}) {
  const proposals = useProposals(onAnswered, answersFreshness, levelId);
  // Gates and candidates by name, never by id (PL-150). Either read failing leaves the id read
  // as words, and the proposals are listed all the same.
  const gateNames = useMatchRuleNames();
  const candidateNames = useCandidateNames();
  const [acceptUncapped, setAcceptUncapped] = useState(false);
  const estimateButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useFocusAfterPass(pass.end, estimateButton);
  const confirmFocus = useFocusAfterConfirm(proposals, estimateButton);
  // **Held while an estimate, a pass or a confirmation is in flight, never disabled** (NEW-44):
  // Chromium throws focus off a control the moment it is disabled and does not give it back, so
  // a keyboard user was put back on the page after each. Held, a button keeps focus and says so,
  // and its press is turned away -- here, before it changes anything, and by the hooks behind.
  const held = proposals.busy !== null || pass.running;
  // **A Confirm is held as well while the list is outdated** (NEW-45): kept on screen while the
  // answers are read again, it still lists a row just confirmed, or one a pass has replaced.
  const confirmHeld = held || proposals.stale;
  const plan = proposals.plan;
  // **A refusal that spent nothing keeps the estimate** (PL-160): a pass refused for want of a
  // cap is answered by ticking the box below and pressing Research again, not by a new estimate.
  const { end } = pass;
  const { restorePlan } = proposals;
  useEffect(() => {
    if (end !== null && end.pass.level === levelId && leavesEstimateUnspent(end)) {
      restorePlan();
    }
  }, [end, levelId, restorePlan]);

  return (
    <section ref={panel} className="panel" aria-labelledby="proposals-heading">
      {/* An h3 under the rules stage's h2, a sibling of Gates and Compound rules (PL-162) --
          and still an h3 when the panel is drawn alone in that stage, beside an unread set. */}
      <h3 id="proposals-heading" className="panel__heading">
        Gate proposals
      </h3>
      <p className="panel__hint">
        A model can read the official pages about each gate and propose an
        answer with the pages it read. A proposal rules nothing out: confirming
        one records it as your own answer, and only then does the gate act on
        it. Researching costs money.
      </p>

      <ActRefusal act={proposals.failedAct} error={proposals.failure} onResend={proposals.resend ?? undefined} />

      <div className="rule-form__actions">
        <button
          ref={estimateButton}
          type="button"
          className="button"
          aria-disabled={held || undefined}
          onClick={() => {
            if (!held) proposals.estimate(levelId);
          }}
        >
          {proposals.busy === "estimating"
            ? "Estimating…"
            : "Estimate the research"}
        </button>
        {(plan !== null || pass.running) && (
          <button
            type="button"
            className="button"
            aria-disabled={held || undefined}
            onClick={() => {
              // Turned away whole, the box included: a held press that cleared it would forget
              // an agreement given for the next pass.
              if (held || plan === null) return;
              pass.start({
                level: levelId,
                questionsTotal: plan.gates_total,
                acceptUncapped,
                ceilingEur: plan.estimated_cost_eur,
              });
              // **An estimate allows one pass**, and this is it: the next needs a fresh one.
              proposals.forgetPlan();
              // **Per pass, never remembered.** Left ticked, it authorised every later pass
              // silently; cleared as the pass starts, agreeing again is a deliberate act again.
              setAcceptUncapped(false);
            }}
          >
            {pass.running ? "Researching…" : "Research the gates"}
          </button>
        )}
        {pass.running && (
          // Held once pressed, as the run's Stop is (NEW-52): the first press is the one that
          // counts, and a live button after it invites the thought that it did not work.
          <button
            type="button"
            className="button"
            aria-disabled={pass.stopAsked || undefined}
            onClick={pass.stop}
          >
            {pass.stopAsked
              ? "Stopping after this question…"
              : "Stop after this question"}
          </button>
        )}
      </div>

      {/* Only offered once an estimate exists, because agreeing to an uncapped spend before
          seeing what it would cost is the decision this panel exists to prevent. */}
      {plan !== null && (
        <>
          <p className="screen__note">
            {plan.gates_total} questions to research (a gate about one candidate
            each), {plan.llm_call_count} calls, at most{" "}
            {formatMoney(plan.estimated_cost_eur, "EUR")}.
          </p>
          {plan.estimate_basis != null && (
            <p className="screen__note">
              The cost is a ceiling, not a forecast: {plan.estimate_basis}
            </p>
          )}
          {proposals.capEur !== null ? (
            <p className="screen__note">
              Halts at the {formatMoney(proposals.capEur, "EUR")} spend cap.
            </p>
          ) : (
            <CheckboxField
              id="accept-uncapped"
              checked={acceptUncapped}
              onChange={setAcceptUncapped}
            >
              No spend cap is set. Accept an uncapped spend for this pass
            </CheckboxField>
          )}
        </>
      )}

      {/* **A live region, always there** (NEW-42): a screen reader announces a change to a region
          it already knows, so the pass's progress and its end are read out as they happen. An end
          the reader did not ask for -- the cap, a refusal, a failure -- is a warning, because the
          gates after it were never asked or what it spent is not known. */}
      <p
        className={
          pass.statusLine?.warning === true
            ? "panel__hint notice notice--warning"
            : "panel__hint"
        }
        role="status"
      >
        {pass.statusLine?.text}
      </p>
      {/* **Kept until put away** (PL-052): what a pass spent is said here through a visit to
          another tab and a reload, and only the reader's Dismiss removes it. Focus goes to
          Estimate, the act the next pass needs, as the button leaves with the line -- or, when
          the panel leaves with it, to what stays in its stage. */}
      {pass.end !== null && !pass.running && (
        <div className="rule-form__actions">
          <button
            type="button"
            className="button"
            aria-label="Dismiss the last pass"
            onClick={() => {
              if (standsAlone) handFocusToStage(panel.current);
              else estimateButton.current?.focus();
              pass.dismiss();
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <ActRefusal act="The research pass" error={pass.failure} />

      {pass.refusals.length > 0 && (
        <>
          <p className="screen__note" id="research-refusals">
            Asked, but nothing was stored:
          </p>
          <ul className="lock-list" aria-labelledby="research-refusals">
            {pass.refusals.map((refusal, index) => (
              // By position as well: the server names each pair it refused, but a list built
              // across a pass's requests must not lose a line to a repeated sentence.
              <li key={`${index}-${refusal}`}>{refusal}</li>
            ))}
          </ul>
        </>
      )}

      <LoadedRegion
        read={proposals.read}
        what="The gate proposals"
        skeleton="lines"
        onRetry={proposals.reload}
        prominence="region"
      >
        {() => (
        <>
          {/* **Unknown is not this level's** (PL-151): until the candidates are read, nothing
              says which level a proposal is about, so none is listed or confirmable yet. */}
          {proposals.levels === "pending" && (
            <p className="screen__note">Reading which level each proposal is about…</p>
          )}
          {proposals.levels === "failed" && (
            <div className="rule-form__actions">
              <p className="screen__note">
                The candidates could not be read, so which level each proposal
                is about is not known: every level&apos;s proposals are listed.
              </p>
              <button type="button" className="button" onClick={proposals.rereadLevels}>
                Read the candidates again
              </button>
            </div>
          )}
          {proposals.levels === "pending" ? null : proposals.proposals.length === 0 ? (
            <p className="screen__note">No proposal is waiting.</p>
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
                  <th scope="col">Read on</th>
                  <th scope="col">Reason and pages</th>
                  <th scope="col">
                    <span className="visually-hidden">Confirm</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {proposals.proposals.map((proposal, index) => (
                  <ProposalRow
                    key={proposalKey(proposal)}
                    proposal={proposal}
                    gate={matchRuleName(gateNames, proposal.match_rule)}
                    candidate={candidateName(candidateNames, proposal.candidate)}
                    held={confirmHeld}
                    confirmRef={confirmFocus.buttonRef(proposal)}
                    onConfirm={() => {
                      if (confirmHeld) return;
                      confirmFocus.pressed(proposal, index);
                      proposals.confirm(proposal);
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </>
        )}
      </LoadedRegion>
    </section>
  );
}

/**
 * Before a panel drawn for the pass alone leaves with its outcome: focus goes to the set's
 * failure card when that is what the stage shows, else to the stage's heading -- never to the
 * page (RULES "Focus").
 */
function handFocusToStage(panel: HTMLElement | null): void {
  const stage = panel?.parentElement?.closest("section");
  if (!stage) return;
  const failureCard = Array.from(stage.children).find(
    (child) => child.matches('[tabindex="-1"]') && child.querySelector(".failure-card") !== null,
  );
  const heading = stage.querySelector(":scope > header h2");
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  refocusIfLost(
    failureCard instanceof HTMLElement ? failureCard : null,
    heading instanceof HTMLElement ? heading : null,
  );
}

function ProposalRow({
  proposal,
  gate,
  candidate,
  held,
  confirmRef,
  onConfirm,
}: {
  proposal: MatchRuleResult;
  /** The gate's name, which the row and its Confirm say instead of the id. */
  gate: string;
  candidate: string;
  /**
   * A write or a pass is in flight, or the list predates the last write to the answers: the
   * button keeps focus, and its press is turned away.
   */
  held: boolean;
  /** Its Confirm button, so focus can be handed to it once a row above has gone (NEW-45). */
  confirmRef: (element: HTMLButtonElement | null) => void;
  onConfirm: () => void;
}) {
  const pages = proposal.citations ?? [];

  return (
    <tr className="table__row">
      <th scope="row">{gate}</th>
      <td>{candidate}</td>
      <td>{formatMatchStatus(proposal.match_result)}</td>
      <td>{describePeriod(proposal.reference_period)}</td>
      {/* When the model read the pages (PL-161): a period says what the answer is about, and
          this says how old the reading is. */}
      <td>{formatDate(proposal.retrieval_date)}</td>
      <td>
        <p>{proposal.reason}</p>
        {/* The pages are the point of asking at all: a gate answered with no source is an
            opinion, and an opinion about a visa route is worth less than an open question. */}
        <ul className="lock-list">
          {pages.map((page) => (
            <li key={page}>
              <PageLink page={page} />
            </li>
          ))}
        </ul>
      </td>
      <td>
        <button
          ref={confirmRef}
          type="button"
          className="button"
          aria-disabled={held || undefined}
          onClick={onConfirm}
        >
          Confirm {gate} for {candidate}
        </button>
      </td>
    </tr>
  );
}

/**
 * A page the model read, as a link only when it is a web address (PL-150). The server stores
 * any string a caller sends as a page, and a `javascript:` one behind a click is a script.
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
