import { type RunDetail, fetchRun } from "../../api/endpoints";
import type { Proposal } from "./runScope";

/**
 * A retry proposal checked against the run it goes back to, before it is estimated.
 *
 * **A gap is not always its run's own item.** The holdings count a pair failed when its figure
 * became unusable after the run -- rejected since, or from a source switched off since -- and
 * say so only in words, which the screen never branches on. A retry names only the run's own
 * failure rows (or its unanswered and not-reached items), and refuses the whole selection for
 * one pair outside them. So the run is read, and unless every pair is one of its own, the list
 * goes out whole as a run scoped to its pairs, which the server accepts.
 */
export async function settleProposal(
  proposal: Proposal,
  read: (runId: number) => Promise<RunDetail> = fetchRun,
): Promise<Proposal> {
  if (proposal.via !== "retry") return proposal;
  const run = await read(proposal.runId);
  const held =
    proposal.items === "failed"
      ? (run.failures ?? [])
      : [...(run.unanswered ?? []), ...(run.not_reached ?? [])];
  const own = new Set(held.map((item) => `${item.candidate}|${item.attribute}`));
  return proposal.pairs.every((pair) => own.has(`${pair.candidate}|${pair.attribute}`))
    ? proposal
    : { via: "scoped", scope: { level: proposal.level, pairs: proposal.pairs } };
}
