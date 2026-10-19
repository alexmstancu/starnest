import { useCallback, useRef, useState } from "react";
import {
  fetchMatchRuleResults,
  planMatchRuleResearch,
  putMatchRuleResult,
  researchMatchRules,
  type MatchRuleResult,
  type ResearchPlan,
} from "../../../api/endpoints";
import { useResource, type Resource } from "../../../api/useResource";
import { type ResearchPass } from "./proposalReading";
import { spendIsKnown } from "./researchPass";

/**
 * The gate answers a model proposed, and what confirming one does.
 *
 * **A proposal rules nothing out** (`reqs.md` 6.10 use 3, Q218). A model read the official
 * pages and reported what they say, with the pages; until a person writes the same answer as
 * `manual` it is something to check rather than something decided, and the ranking ignores it
 * entirely. **Confirming replaces it** -- one row, so a proposal and a finding can never
 * disagree about the same gate.
 *
 * **Researching spends money**, so the estimate comes first and separately: the plan is asked
 * instead of the pass, not before it, and the household agrees to a figure rather than to a
 * verb (`reqs.md` 6.3).
 *
 * **One act at a time, and a press during one is turned away here** (NEW-44). The panel holds
 * its buttons rather than disabling them, so they keep a keyboard's focus -- which means a press
 * still arrives, and is refused before it changes anything.
 */

export interface Proposals {
  status: Resource<{ items: MatchRuleResult[] }>["status"];
  error: unknown;
  /** The unconfirmed answers, which are the only ones this panel acts on. */
  proposals: MatchRuleResult[];
  /** How many answers a person has already settled, for context beside the proposals. */
  confirmedCount: number;
  /** What a pass would ask and cost. Null until asked for. */
  plan: ResearchPlan | null;
  busy: "estimating" | "researching" | "confirming" | null;
  /** The last refusal from any of the three writes. Shown, never swallowed. */
  failure: unknown;
  /** Gates the model answered without citing anything, so nothing was stored. */
  refusals: string[];
  /**
   * What the last pass actually spent and whether the spend cap stopped it (UI-14). Null until
   * a pass has answered, and again from the moment another starts: a spend belongs to its pass.
   */
  lastPass: ResearchPass | null;
  /** The last pass failed in a way that may have come after billed calls, and said nothing. */
  spendNotKnown: boolean;
  estimate: (level: string) => void;
  research: (level: string, acceptUncapped: boolean) => void;
  confirm: (proposal: MatchRuleResult) => void;
  reload: () => void;
}

export function useProposals(
  /** Told after a confirm or a research pass has written answers, so others can re-read them. */
  onAnswered: () => void,
): Proposals {
  const fetcher = useCallback(
    async (signal: AbortSignal) => fetchMatchRuleResults({ signal }),
    [],
  );
  const { resource, reload } = useResource(fetcher, true);

  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [busy, setBusy] = useState<Proposals["busy"]>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [lastPass, setLastPass] = useState<ResearchPass | null>(null);
  const [spendNotKnown, setSpendNotKnown] = useState(false);

  // A ref, because two presses in one tick would both pass a check on state that has not
  // re-rendered yet.
  const inFlight = useRef(false);

  const answers = resource.data?.items ?? [];

  function attempt(act: Proposals["busy"], work: () => Promise<unknown>): void {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(act);
    setFailure(null);
    void work()
      .catch((error: unknown) => setFailure(error))
      .finally(() => {
        inFlight.current = false;
        setBusy(null);
      });
  }

  return {
    status: resource.status,
    error: resource.error,
    proposals: answers.filter((answer) => answer.is_proposal === true),
    confirmedCount: answers.filter((answer) => answer.is_proposal !== true)
      .length,
    plan,
    busy,
    failure,
    refusals,
    lastPass,
    spendNotKnown,
    estimate: (level) =>
      attempt("estimating", async () => {
        setPlan(await planMatchRuleResearch({ level }));
      }),
    research: (level, acceptUncapped) =>
      attempt("researching", async () => {
        // **The last pass's outcome goes as this one starts** (UI-14): left standing, it read as
        // this pass's spend beside this pass's failure, on the one screen that spends money.
        // Inside the attempt, so a press turned away clears nothing.
        setLastPass(null);
        setRefusals([]);
        setSpendNotKnown(false);
        const outcome = await researchMatchRules({
          level,
          accept_uncapped_spend: acceptUncapped,
        }).catch((failure: unknown) => {
          const mayHaveStored = !spendIsKnown(failure);
          setSpendNotKnown(mayHaveStored);
          // **A pass that failed part way may already have stored proposals**, one per
          // question it got through: read again, as after a success, so they are seen rather
          // than paid for a second time. A refusal stored nothing, so it reads nothing.
          if (mayHaveStored) {
            reload();
            onAnswered();
          }
          throw failure;
        });
        setRefusals(outcome.refusals ?? []);
        // The spend is a fact and the estimate a ceiling; a pass the cap stopped half way
        // must not look finished.
        setLastPass({
          cost_eur: outcome.cost_eur,
          calls: outcome.calls,
          halted_on_spend_cap: outcome.halted_on_spend_cap,
        });
        // Re-read rather than appending the response: a pass can replace an earlier proposal
        // for the same gate, and the stored answers are the only account of what now stands.
        reload();
        onAnswered();
      }),
    confirm: (proposal) =>
      attempt("confirming", async () => {
        await putMatchRuleResult(proposal.match_rule, proposal.candidate, {
          match_result: proposal.match_result,
          // **The model's own reason and pages, written as the person's answer.** What
          // confirming means is that somebody read those pages and agrees -- so the citations
          // travel, and a reader of the confirmed answer can still check them.
          reason: proposal.reason ?? null,
          citations: proposal.citations ?? [],
          // **The period it holds for travels too** (UI-13), and null is sent rather than
          // omitted: the answer replaces the proposal, so leaving it out would drop it unseen.
          reference_period: proposal.reference_period ?? null,
          data_source: "manual",
          // No retrieval date: the server stamps the moment of confirmation, which is when a
          // person checked the pages -- the household's choice (2026-10-15).
        });
        reload();
        onAnswered();
      }),
    reload,
  };
}
