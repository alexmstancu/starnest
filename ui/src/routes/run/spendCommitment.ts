import { formatCount, formatMoney } from "../../format/display";

/**
 * What a reader is committing to before anything is fetched.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number` and friends, so the sentence
 * is composed here and the strip renders what it is given.
 *
 * **The point is the commitment, not the number.** The estimate panel already showed items,
 * paid calls and a cost ceiling; what was missing was a step between reading that and it
 * happening. A run is the only thing in this application that spends money, and the only one
 * that cannot be undone by changing a weight.
 */
export interface Commitment {
  /** What the act will do, in one sentence. */
  sentence: string;
  /** True when a paid source is in scope, which is what makes a cap matter. */
  spends: boolean;
  /**
   * True when it can spend and no cap is set. The backend refuses this outright
   * (`409 spend_cap_not_set`) unless the request accepts going uncapped, so the strip has to
   * say which of those is about to happen.
   */
  uncapped: boolean;
}

export interface CommitmentFacts {
  /** What the act is called, e.g. "Start this run". */
  act: string;
  itemsTotal?: number | null;
  llmCallCount?: number | null;
  estimatedCostEur?: number | null;
  /** `settings.run_spend_cap_eur`, which is nullable and null by default. */
  capEur?: number | null;
}

export function describeCommitment(facts: CommitmentFacts): Commitment {
  const paidCalls = facts.llmCallCount ?? 0;
  const spends = paidCalls > 0;
  const items = formatCount(facts.itemsTotal ?? 0);

  if (!spends) {
    // **Free by construction, and worth saying so.** A paid source is asked only when a run
    // names its attributes, so a sweep over a level costs nothing -- and a confirmation that
    // implied otherwise would train the reader to click past the ones that matter.
    return {
      sentence: `${facts.act} over ${items} values. No paid source is in scope, so this costs nothing.`,
      spends: false,
      uncapped: false,
    };
  }

  const ceiling = formatMoney(facts.estimatedCostEur ?? 0, "EUR");
  const opening = `${facts.act} over ${items} values, and can spend up to ${ceiling} across ${formatCount(paidCalls)} paid calls.`;

  if (facts.capEur === null || facts.capEur === undefined) {
    return {
      sentence: `${opening} No spend cap is set, so this asks to go uncapped.`,
      spends: true,
      uncapped: true,
    };
  }

  return {
    sentence: `${opening} It halts at the ${formatMoney(facts.capEur, "EUR")} cap and keeps whatever completed.`,
    spends: true,
    uncapped: false,
  };
}

/**
 * What a run actually cost, once it has run.
 *
 * **Spelled out even when it is nothing.** Every source shipped today is free, so the honest
 * line is almost always "nothing was charged" -- and a spend line that appears only when money
 * moved would leave a reader unable to tell "free" from "not reported".
 */
export function describeSpend(
  llmCallCount: number | null | undefined,
  costEur: number | null | undefined,
): string {
  const calls = llmCallCount ?? 0;
  const cost = costEur ?? 0;
  if (calls <= 0 && cost <= 0) return "No paid call, nothing charged";
  return `${formatCount(calls)} paid ${calls === 1 ? "call" : "calls"}, ${formatMoney(cost, "EUR")}`;
}

/**
 * Why an estimate's money is the figure it is.
 *
 * **"At most" is a ceiling, not a forecast**, and the reason belongs on the figure rather than
 * in a paragraph under it -- a cost with no stated assumptions can only be trusted, never
 * judged. The assumptions themselves are the server's: it priced the run and it knows what it
 * assumed.
 */
export function describeCeiling(basis: string | null | undefined): string | null {
  if (basis === null || basis === undefined || basis === "") return null;
  return `A ceiling, not a forecast: ${basis}`;
}
