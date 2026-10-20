import { useCallback, useRef, useState } from "react";
import {
  fetchMatchRuleResults,
  planMatchRuleResearch,
  putMatchRuleResult,
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
 * verb (`reqs.md` 6.3). The pass itself is the screen's (`useResearchPass.ts`), and **it spends
 * the estimate** -- the next pass needs a fresh one.
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
  /**
   * Whether the list on screen was read before the answers were last written -- by a confirm or
   * a research pass -- so a newer one is on its way (NEW-45). **Confirm is held while it is**: a
   * row just confirmed, or one a pass has since replaced, is still listed, and confirming it
   * would write the person's answer from an outdated row.
   */
  stale: boolean;
  /** What a pass would ask and cost. Null until asked for, and once a pass has spent it. */
  plan: ResearchPlan | null;
  busy: "estimating" | "confirming" | null;
  /** The last refusal from an estimate or a confirmation. Shown, never swallowed. */
  failure: unknown;
  estimate: (level: string) => void;
  /** The pass the estimate allowed has started, so it allows no other (UI-14). */
  forgetPlan: () => void;
  confirm: (proposal: MatchRuleResult) => void;
  reload: () => void;
}

export function useProposals(
  /** Told after a confirm has written an answer, so everything describing the answers re-reads. */
  onAnswered: () => void,
  /**
   * Changes when the answers have been written -- by a confirm here or by a research pass -- so
   * the proposals are read again with everything else that describes them (UI-12).
   */
  answersFreshness: number,
): Proposals {
  const fetcher = useCallback(
    async (signal: AbortSignal) => fetchMatchRuleResults({ signal }),
    [],
  );
  const { resource, reload } = useResource(fetcher, true, answersFreshness);

  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [busy, setBusy] = useState<Proposals["busy"]>(null);
  const [failure, setFailure] = useState<unknown>(null);

  // A ref, because two presses in one tick would both pass a check on state that has not
  // re-rendered yet.
  const inFlight = useRef(false);

  // **The answers as last read, kept while they are read again** (NEW-45). A re-read has no list
  // until it answers, so the table left the screen for each one -- after a confirm, and at the
  // end of a research pass -- and took the Confirm a keyboard user was on with it. The list read
  // last stays on screen until the next lands, as the run history's does (NEW-11), **with the
  // write it was read after**: from the moment the answers are written again it is outdated, so
  // `stale` says so in that same render, before the re-read has even been sent.
  const read = resource.status === "ready" ? resource.data.items : null;
  const [lastRead, setLastRead] = useState<{
    items: MatchRuleResult[];
    after: number;
  } | null>(null);
  if (read !== null && read !== lastRead?.items) {
    setLastRead({ items: read, after: answersFreshness });
  }
  const answers = read ?? lastRead?.items ?? [];
  const rereading = resource.status === "loading" && lastRead !== null;
  const stale =
    rereading || (lastRead !== null && lastRead.after !== answersFreshness);

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
    status: rereading ? "ready" : resource.status,
    error: resource.error,
    proposals: answers.filter((answer) => answer.is_proposal === true),
    confirmedCount: answers.filter((answer) => answer.is_proposal !== true)
      .length,
    stale,
    plan,
    busy,
    failure,
    estimate: (level) =>
      attempt("estimating", async () => {
        setPlan(await planMatchRuleResearch({ level }));
      }),
    forgetPlan: () => setPlan(null),
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
        // The answers are read again through `answersFreshness`, which this moves -- the list
        // here with the gates' sentences, in one read each.
        onAnswered();
      }),
    reload,
  };
}
