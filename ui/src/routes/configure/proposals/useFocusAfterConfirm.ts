import { useEffect, useRef, type RefObject } from "react";
import type { MatchRuleResult } from "../../../api/endpoints";
import { refocusIfLost } from "../focusReturn";
import type { Proposals } from "./useProposals";

/** The key a proposal's row is drawn under, and its Confirm button is found by. */
export function proposalKey(proposal: MatchRuleResult): string {
  return `${proposal.match_rule}-${proposal.candidate}`;
}

/**
 * Where a keyboard goes once a confirmed proposal has left the table (NEW-45).
 *
 * **Confirming takes the pressed button away**: the answer is a person's from then on, so the
 * next read lists it no longer, and a keyboard user was put back on the page. Focus goes to the
 * proposal that takes its place -- so a review goes on where it was -- or to `fallback`, the
 * panel's next act, once none is left. It waits for the read that drops the confirmed row, and
 * a refused confirmation leaves its button, and focus with it, where they were.
 */
export function useFocusAfterConfirm(
  proposals: Proposals,
  fallback: RefObject<HTMLElement | null>,
) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const confirmed = useRef<{ key: string; index: number } | null>(null);

  useEffect(() => {
    const done = confirmed.current;
    if (done === null) return;
    if (proposals.failure !== null) {
      confirmed.current = null;
      return;
    }
    const listed = proposals.proposals;
    const stillListed = listed.some((proposal) => proposalKey(proposal) === done.key);
    // Still listed, and no read has failed: the read that drops it is on its way.
    const read = proposals.read;
    if (read.state === "ready" && typeof read.refresh !== "object" && stillListed) return;
    confirmed.current = null;
    const next = listed[Math.min(done.index, listed.length - 1)];
    refocusIfLost(
      next === undefined ? null : buttons.current.get(proposalKey(next)),
      fallback.current,
    );
  }, [proposals.proposals, proposals.read, proposals.failure, fallback]);

  return {
    /** A ref for one proposal's Confirm button. */
    buttonRef:
      (proposal: MatchRuleResult) =>
      (element: HTMLButtonElement | null): void => {
        if (element === null) buttons.current.delete(proposalKey(proposal));
        else buttons.current.set(proposalKey(proposal), element);
      },
    /** Notes the proposal a reader confirmed, and where it stood in the table. */
    pressed: (proposal: MatchRuleResult, index: number): void => {
      confirmed.current = { key: proposalKey(proposal), index };
    },
  };
}
