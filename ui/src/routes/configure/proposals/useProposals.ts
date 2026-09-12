import { useCallback, useState } from "react";
import {
  fetchMatchRuleResults,
  planMatchRuleResearch,
  putMatchRuleResult,
  researchMatchRules,
  type MatchRuleResult,
  type ResearchPlan,
} from "../../../api/endpoints";
import { useResource, type Resource } from "../../../api/useResource";

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
  estimate: (level: string) => void;
  research: (level: string, acceptUncapped: boolean) => void;
  confirm: (proposal: MatchRuleResult) => void;
  reload: () => void;
}

export function useProposals(): Proposals {
  const fetcher = useCallback(
    async (signal: AbortSignal) => fetchMatchRuleResults({ signal }),
    [],
  );
  const { resource, reload } = useResource(fetcher, true);

  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [busy, setBusy] = useState<Proposals["busy"]>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [refusals, setRefusals] = useState<string[]>([]);

  const answers = resource.data?.items ?? [];

  function attempt(act: Proposals["busy"], work: () => Promise<unknown>): void {
    setBusy(act);
    setFailure(null);
    void work()
      .catch((error: unknown) => setFailure(error))
      .finally(() => setBusy(null));
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
    estimate: (level) =>
      attempt("estimating", async () => {
        setPlan(await planMatchRuleResearch({ level }));
      }),
    research: (level, acceptUncapped) =>
      attempt("researching", async () => {
        const outcome = await researchMatchRules({
          level,
          accept_uncapped_spend: acceptUncapped,
        });
        setRefusals(outcome.refusals ?? []);
        // Re-read rather than appending the response: a pass can replace an earlier proposal
        // for the same gate, and the stored answers are the only account of what now stands.
        reload();
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
          data_source: "manual",
        });
        reload();
      }),
    reload,
  };
}
