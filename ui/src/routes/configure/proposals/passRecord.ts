/**
 * What the session keeps of the last research pass (PL-052), as stored and as read back.
 *
 * **Money spent on gate research must never leave the page unsaid**, so the pass is kept in the
 * session store rather than in the screen: how far it had got while it ran, then how it ended,
 * until the reader dismisses it. A record still `running` that no page is running is a pass the
 * page stopped -- left for another tab, or reloaded -- and reads as abandoned, never as nothing.
 * **A running pass carries the outcome it would replace**, which stays until the pass asks the
 * model something (`askedTheModel`).
 *
 * **A failure is kept as its code, status and details, never its message** (P1-07, P1-11): the
 * words come from the code, so a reload words it the same way, and the server's sentence is
 * written nowhere.
 *
 * **A record that does not hold together reads as unreadable, never as a figure.** Storage can
 * be edited, or written by another build: a negative, fractional or absurd amount is refused
 * whole, and the screen says an earlier outcome could not be read rather than show €0.
 */

import { ApiError, isApiError } from "../../../api/ApiError";
import { isRecord } from "../../../shell/sessionState";
import type { Gate, Pass, PassEnd, PassTally, Progress } from "./researchPass";

/** A stored outcome this build cannot trust. */
export interface Unreadable {
  kind: "unreadable";
}

/** What the screen says of the last pass once it is over. */
export type Outcome = PassEnd | Unreadable;

export type PassRecord = ({ kind: "running"; kept: Outcome | null } & Progress) | Outcome;

/** The record as the session store holds it: plain data, a failure reduced to its code. */
export function storedFormOf(record: PassRecord): PassRecord {
  if (record.kind === "running") {
    return { ...record, kept: record.kept === null ? null : storedFormOf(record.kept) as Outcome };
  }
  if (!("failure" in record)) return record;
  const { failure } = record;
  return {
    ...record,
    failure: isApiError(failure)
      ? { code: failure.code, status: failure.status, details: failure.details ?? null }
      : null,
  };
}

const UNREADABLE: Unreadable = { kind: "unreadable" };

/**
 * A stored record read back: null for none, `unreadable` for one that does not hold together.
 * **A running pass keeps one outcome, one level deep**: its `kept` is read as an outcome only, so
 * a record nested deeper reads as unreadable rather than recursing until the stack gives out.
 */
export function parsePassRecord(stored: unknown): PassRecord | null {
  if (stored === null || stored === undefined) return null;
  if (isRecord(stored) && stored["kind"] === "running") {
    const progress = parseProgress(stored);
    if (progress === undefined) return UNREADABLE;
    const kept = stored["kept"];
    return { kind: "running", kept: kept == null ? null : parseOutcome(kept), ...progress };
  }
  return parseOutcome(stored);
}

function parseOutcome(stored: unknown): Outcome {
  if (!isRecord(stored)) return UNREADABLE;
  const pass = parsePass(stored["pass"]);
  if (pass === undefined) return UNREADABLE;
  const kind = stored["kind"];
  switch (kind) {
    case "abandoned": {
      const progress = parseProgress(stored);
      return progress === undefined ? UNREADABLE : { kind, ...progress };
    }
    case "finished":
      // Nothing left to ask is what finishes a pass, so it asked every gate it held.
      return pass.tally.asked === pass.gates.length ? { kind, pass } : UNREADABLE;
    case "cap":
    case "stopped":
      return { kind, pass };
    case "unread":
      // It could not read its gates, so it asked nothing and spent nothing.
      return pass.gates.length === 0 && pass.tally.calls === 0
        ? { kind, pass, failure: failureOf(stored["failure"]) }
        : UNREADABLE;
    case "refused":
    case "failed":
      return { kind, pass, failure: failureOf(stored["failure"]) };
    default:
      return UNREADABLE;
  }
}

/** A pass in flight, and the gate it was asking: always the next one it held. */
function parseProgress(stored: Record<string, unknown>): Progress | undefined {
  const pass = parsePass(stored["pass"]);
  const inFlight = stored["inFlight"] === null ? null : parseGate(stored["inFlight"]);
  if (pass === undefined || inFlight === undefined) return undefined;
  const next = pass.gates[pass.tally.asked];
  if (inFlight !== null && (next?.id !== inFlight.id || next.name !== inFlight.name)) {
    return undefined;
  }
  return { pass, inFlight };
}

/** An `ApiError` again, without its message; anything else reads as an unexpected failure. */
function failureOf(stored: unknown): unknown {
  if (!isRecord(stored) || typeof stored["code"] !== "string") return new Error();
  const status = stored["status"];
  const details = stored["details"];
  return new ApiError({
    code: stored["code"],
    message: "",
    status: typeof status === "number" ? status : null,
    details: isRecord(details) ? details : undefined,
  });
}

function parsePass(stored: unknown): Pass | undefined {
  if (!isRecord(stored)) return undefined;
  const { level, gates, questionsTotal, capEur, ceilingEur } = stored;
  const tally = parseTally(stored["tally"]);
  if (
    typeof level !== "string" ||
    !Array.isArray(gates) ||
    !isCount(questionsTotal) ||
    !(capEur === null || isEuros(capEur)) ||
    !isEuros(ceilingEur) ||
    tally === undefined
  ) {
    return undefined;
  }
  const parsedGates = gates.map(parseGate);
  if (!parsedGates.every((gate) => gate !== undefined)) return undefined;
  if (!holdsTogether(tally, parsedGates.length)) return undefined;
  return { level, gates: parsedGates, questionsTotal, capEur, ceilingEur, tally };
}

/**
 * Whether a tally is one a pass could have kept, so that every figure the screen says is the
 * figure stored: no more gates asked than it holds, no spend without a call, and nothing at all
 * asked, called or spent by a pass that held no gate -- which the screen calls "spent nothing".
 */
function holdsTogether(tally: PassTally, gates: number): boolean {
  if (tally.asked > gates) return false;
  if (tally.spentMicroEur > 0 && tally.calls === 0) return false;
  return gates > 0 || (tally.calls === 0 && tally.spentMicroEur === 0);
}

function parseTally(stored: unknown): PassTally | undefined {
  if (!isRecord(stored)) return undefined;
  const { asked, calls, spentMicroEur, proposed, refusals, haltedOnSpendCap } = stored;
  if (
    !isCount(asked) ||
    !isCount(calls) ||
    !isMicroEuros(spentMicroEur) ||
    !isCount(proposed) ||
    !Array.isArray(refusals) ||
    !refusals.every((refusal) => typeof refusal === "string") ||
    typeof haltedOnSpendCap !== "boolean"
  ) {
    return undefined;
  }
  return { asked, calls, spentMicroEur, proposed, refusals, haltedOnSpendCap };
}

function parseGate(stored: unknown): Gate | undefined {
  if (!isRecord(stored)) return undefined;
  const { id, name } = stored;
  return typeof id === "string" && typeof name === "string" ? { id, name } : undefined;
}

/**
 * Bounds past which a stored figure is not a pass this application could have run: no estimate
 * here comes near a million euros or a million questions, so beyond them the record is corrupt.
 */
const MOST_EUR = 1_000_000;
const MOST_COUNT = 1_000_000;
const MICRO_EUR_PER_EUR = 1_000_000;

/** A whole number of things, neither negative nor absurd. */
function isCount(value: unknown): value is number {
  return isWholeUpTo(value, MOST_COUNT);
}

/** A spend as a pass sums it: whole micro-euros, neither negative nor absurd. */
function isMicroEuros(value: unknown): value is number {
  return isWholeUpTo(value, MOST_EUR * MICRO_EUR_PER_EUR);
}

function isWholeUpTo(value: unknown, most: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= most;
}

function isEuros(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MOST_EUR;
}
