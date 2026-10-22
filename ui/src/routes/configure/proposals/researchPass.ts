/**
 * A research pass, as figures and sentences (UI-01, UI-14). No React and no markup.
 *
 * **One gate per request, asked in the order the catalog lists them.** The whole level in one
 * request grew with the gates and the roster until no proxy ceiling was safe; one gate is one
 * slow question at most. The server asks only the gates research can answer, so a request for
 * any other gate answers having asked nothing and spent nothing -- which is why the page can
 * ask about every gate without knowing which ones those are.
 *
 * **And the page holds the pass to the spend cap.** The server's meter starts again with every
 * request, so across a pass the only meter is this one: what each answer says it spent, summed,
 * and compared with the cap before the next gate is asked -- by the server's own rule, that a
 * cap is reached once the spend is at or past it. A request already in flight may take the pass
 * past the cap by what one question costs, the same bound the server's meter gives a request.
 */

import { isApiError } from "../../../api/ApiError";
import type { MatchRule } from "../../../api/endpoints";
import { formatMoney } from "../../../format/display";

/** A gate as a pass asks it: its id goes in the request, its name on the screen. */
export type Gate = Pick<MatchRule, "id" | "name">;

/** What one research request answers with about itself. */
export interface ResearchAnswer {
  proposals: readonly unknown[];
  refusals?: readonly string[];
  cost_eur: number;
  calls: number;
  halted_on_spend_cap: boolean;
}

/** What a pass has done so far: the server's own figures, summed over its answers. */
export interface PassTally {
  /** Gates whose question was asked: their request answered, and the cap did not cut it. */
  asked: number;
  calls: number;
  /**
   * **Integer micro-euros, never a float of euros.** Ten answers of €0.10 sum to
   * 0.9999999999999999 in floating point, and a sum a hair under the cap asks one gate more
   * than the cap allows.
   */
  spentMicroEur: number;
  proposed: number;
  /** Gates asked but not stored: the model cited nothing, or a person answered first (NEW-63). */
  refusals: readonly string[];
  /** The last answer said the server's own meter stopped it at the cap. */
  haltedOnSpendCap: boolean;
}

export interface Pass {
  /** Every gate at the level, in the order they are asked. */
  gates: readonly Gate[];
  /** `run_spend_cap_eur` as the pass read it at its start. Null when none is set. */
  capEur: number | null;
  /** The estimate's ceiling, which the spend is read beside: "at most" this. */
  ceilingEur: number;
  tally: PassTally;
}

/**
 * How a pass ended. Five ways, because each is a different fact about what was asked and what
 * it cost -- and a sixth, `unread`, for a pass that could not learn its cap or its gates and so
 * asked nothing at all.
 */
export type PassEnd =
  | { kind: "finished" | "cap" | "stopped"; pass: Pass }
  | { kind: "refused" | "failed" | "unread"; pass: Pass; failure: unknown };

/** The gate to ask next, or the end the pass has come to. */
export type NextStep = { ask: Gate } | { end: PassEnd };

const MICRO_EUR_PER_EUR = 1_000_000;

const NOTHING_YET: PassTally = {
  asked: 0,
  calls: 0,
  spentMicroEur: 0,
  proposed: 0,
  refusals: [],
  haltedOnSpendCap: false,
};

export function beginPass(scope: {
  gates: readonly Gate[];
  capEur: number | null;
  ceilingEur: number;
}): Pass {
  return { ...scope, tally: NOTHING_YET };
}

/**
 * Whether to ask the next gate, decided before each one.
 *
 * **Nothing left is finished**, whatever else holds: a stop pressed during the last question, or
 * a cap reached by it, cut nothing short. The reader's stop comes before the cap because it is
 * the act they are waiting to see confirmed; the spend is said either way.
 */
export function nextStep(pass: Pass, stopAsked: boolean): NextStep {
  const { tally } = pass;
  if (tally.haltedOnSpendCap) return { end: { kind: "cap", pass } };
  const gate = pass.gates[tally.asked];
  if (gate === undefined) return { end: { kind: "finished", pass } };
  if (stopAsked) return { end: { kind: "stopped", pass } };
  if (reachedCap(tally, pass.capEur)) return { end: { kind: "cap", pass } };
  return { ask: gate };
}

/**
 * The pass after one more answer. **A gate the server halted is not counted as asked**: its
 * meter stopped before the question, though what it did spend is kept.
 */
export function withAnswer(pass: Pass, answer: ResearchAnswer): Pass {
  const { tally } = pass;
  return {
    ...pass,
    tally: {
      asked: tally.asked + (answer.halted_on_spend_cap ? 0 : 1),
      calls: tally.calls + answer.calls,
      spentMicroEur: tally.spentMicroEur + toMicroEur(answer.cost_eur),
      proposed: tally.proposed + answer.proposals.length,
      refusals: [...tally.refusals, ...(answer.refusals ?? [])],
      haltedOnSpendCap: answer.halted_on_spend_cap,
    },
  };
}

/** The server's own rule (`CostMeter.is_exhausted`): reached at or past the cap, never unset. */
export function reachedCap(tally: PassTally, capEur: number | null): boolean {
  return capEur !== null && tally.spentMicroEur >= toMicroEur(capEur);
}

export function spentEur(tally: PassTally): number {
  return tally.spentMicroEur / MICRO_EUR_PER_EUR;
}

function toMicroEur(eur: number): number {
  return Math.round(eur * MICRO_EUR_PER_EUR);
}

/** A request that failed ends the pass: refused if it is known to have spent nothing. */
export function failedOn(pass: Pass, failure: unknown): PassEnd {
  return { kind: spendIsKnown(failure) ? "refused" : "failed", pass, failure };
}

/** The spend cap or the gates could not be read, so nothing was asked. */
export function couldNotStart(ceilingEur: number, failure: unknown): PassEnd {
  return {
    kind: "unread",
    pass: beginPass({ gates: [], capEur: null, ceilingEur }),
    failure,
  };
}

/**
 * Whether the screen should read the answers again once a pass has ended (UIC-A2, RD-1).
 *
 * **After any answer the server sent**, not only one that stored a proposal: the server declines
 * a model's proposal when a person answered the gate while the pass ran, so the answers can move
 * under a pass that stored nothing; and an answer the cap cut short is not counted as asked, yet
 * may have stored a proposal before the meter stopped it. Also after a failure, which may come
 * after a write the response never got to report. Not when no request was answered or failed:
 * then nothing on the server moved because of this pass.
 */
export function shouldReadAnswersAgain(end: PassEnd): boolean {
  const { tally } = end.pass;
  return tally.asked > 0 || tally.haltedOnSpendCap || end.kind === "failed";
}

/** Said while the pass reads its cap and its gates, before the first question. */
export const STARTING =
  "Reading the spend cap and the gates before asking anything.";

/** A running pass: what it has done so far, and the gate whose question is in flight. */
export interface Asking {
  pass: Pass;
  gate: Gate;
}

/** How far a running pass has got: the gate in flight, and the spend beside the estimate. */
export function describeProgress({ pass, gate }: Asking, stopAsked: boolean): string {
  const { tally } = pass;
  const position = `gate ${tally.asked + 1} of ${pass.gates.length}`;
  const doing = stopAsked
    ? `Stopping once ${position} is answered`
    : `Asking ${position}`;
  return (
    `${doing}: ${gate.name}. So far ${callCount(tally.calls)}, ` +
    `${euros(spentEur(tally))} spent of at most ${euros(pass.ceilingEur)}.`
  );
}

/**
 * What the last pass did and why it ended (UI-14). **A pass that stopped part way must not look
 * finished**: the spend is a fact and the estimate a ceiling, so the two are said together, and
 * every early end says how many gates it left unasked.
 */
export function describeEnd(end: PassEnd): string {
  const { pass } = end;
  const { tally } = pass;
  const total = pass.gates.length;
  const did = whatItDid(pass);
  const notAsked = total - tally.asked;
  const atGate = `gate ${tally.asked + 1} of ${total}`;
  switch (end.kind) {
    case "finished":
      return total === 0
        ? "The last pass found no gate to ask, so it made no calls and spent nothing."
        : `The last pass asked every gate, ${total} of ${total}: it ${did}.`;
    case "cap":
      return (
        `The last pass stopped at the spend cap${capOf(pass)}: ` +
        `it ${did}${leftUnasked(notAsked)}.`
      );
    case "stopped":
      return (
        `You stopped the last pass after ${tally.asked} of ${total} gates: ` +
        `it ${did}${leftUnasked(notAsked)}.`
      );
    case "refused":
      return (
        `The last pass was refused at ${atGate}, which spent nothing: ` +
        `it ${did}${leftUnasked(notAsked)}.`
      );
    case "failed":
      return (
        `The last pass failed at ${atGate}, and what that request spent is not known: ` +
        `before it, the pass ${did}${leftAfterIt(notAsked - 1)}.`
      );
    case "unread":
      return (
        "The last pass did not start, because the spend cap and the gates could not be " +
        "read: it asked nothing and spent nothing."
      );
  }
}

/** An end the reader did not ask for, which left gates unasked or money unaccounted for. */
export function endIsWarning(end: PassEnd): boolean {
  return end.kind !== "finished" && end.kind !== "stopped";
}

function whatItDid(pass: Pass): string {
  const { tally } = pass;
  if (tally.calls === 0 && tally.spentMicroEur === 0) {
    return "made no calls and spent nothing";
  }
  return (
    `made ${callCount(tally.calls)} and spent ${euros(spentEur(tally))} ` +
    `of at most ${euros(pass.ceilingEur)}`
  );
}

function capOf(pass: Pass): string {
  return pass.capEur === null ? "" : ` of ${euros(pass.capEur)}`;
}

function leftUnasked(gates: number): string {
  return `, and ${gateCount(gates)} ${gates === 1 ? "was" : "were"} not asked`;
}

function leftAfterIt(gates: number): string {
  if (gates === 0) return "";
  return `, and the ${gateCount(gates)} after it ${gates === 1 ? "was" : "were"} not asked`;
}

function callCount(calls: number): string {
  return calls === 1 ? "1 call" : `${calls} calls`;
}

function gateCount(gates: number): string {
  return gates === 1 ? "1 gate" : `${gates} gates`;
}

function euros(amount: number): string {
  return formatMoney(amount, "EUR");
}

/** What the research endpoints refuse with when no model may be asked: `llm_not_configured`. */
const NO_MODEL_MAY_BE_ASKED = 501;

/**
 * Whether a research request that failed is known to have spent nothing (UI-14, NEW-31).
 *
 * **A refusal in the contract's shape is the server saying no before the model was asked
 * anything**: a 4xx carrying a code -- no spend cap, a scope it will not research -- or the 501
 * that says no model may be asked, because none is configured or the `llm` source is switched
 * off. Anything else -- a 500, a timeout the proxy turned into a 504, the network gone, a body
 * that is not the contract's -- can come after calls that were billed, and the response that
 * would have said how many never arrived.
 */
export function spendIsKnown(failure: unknown): boolean {
  if (!isApiError(failure) || failure.code.startsWith("client.")) return false;
  const status = failure.status;
  return (
    status !== null &&
    ((status >= 400 && status < 500) || status === NO_MODEL_MAY_BE_ASKED)
  );
}
