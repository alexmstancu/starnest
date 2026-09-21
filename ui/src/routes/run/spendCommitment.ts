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
