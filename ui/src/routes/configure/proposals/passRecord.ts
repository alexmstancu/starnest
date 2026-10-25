/**
 * What the session keeps of the last research pass (PL-052), as stored and as read back.
 *
 * **Money spent on gate research must never leave the page unsaid**, so the pass is kept in the
 * session store rather than in the screen: how far it had got while it ran, then how it ended,
 * until the reader dismisses it. A record still `running` that no page is running is a pass the
 * page stopped -- left for another tab, or reloaded -- and reads as abandoned, never as nothing.
 *
 * **A failure is kept as its code, status and details, never its message** (P1-07, P1-11): the
 * words come from the code, so a reload words it the same way, and the server's sentence is
 * written nowhere.
 */

import { ApiError, isApiError } from "../../../api/ApiError";
import { isRecord } from "../../../shell/sessionState";
import type { Gate, Pass, PassEnd, PassTally, Progress } from "./researchPass";

export type PassRecord = ({ kind: "running" } & Progress) | PassEnd;

/** The record as the session store holds it: plain data, a failure reduced to its code. */
export function storedFormOf(record: PassRecord): PassRecord {
  if (!("failure" in record)) return record;
  const { failure } = record;
  return {
    ...record,
    failure: isApiError(failure)
      ? { code: failure.code, status: failure.status, details: failure.details ?? null }
      : null,
  };
}

/** A stored record read back; undefined for anything this build does not recognise. */
export function parsePassRecord(stored: unknown): PassRecord | undefined {
  if (!isRecord(stored)) return undefined;
  const pass = parsePass(stored["pass"]);
  if (pass === undefined) return undefined;
  const kind = stored["kind"];
  switch (kind) {
    case "running":
    case "abandoned": {
      const inFlight = stored["inFlight"] === null ? null : parseGate(stored["inFlight"]);
      return inFlight === undefined ? undefined : { kind, pass, inFlight };
    }
    case "finished":
    case "cap":
    case "stopped":
      return { kind, pass };
    case "refused":
    case "failed":
    case "unread":
      return { kind, pass, failure: failureOf(stored["failure"]) };
    default:
      return undefined;
  }
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
    !isAmount(questionsTotal) ||
    !(capEur === null || isAmount(capEur)) ||
    !isAmount(ceilingEur) ||
    tally === undefined
  ) {
    return undefined;
  }
  const parsedGates = gates.map(parseGate);
  if (!parsedGates.every((gate) => gate !== undefined)) return undefined;
  return { level, gates: parsedGates, questionsTotal, capEur, ceilingEur, tally };
}

function parseTally(stored: unknown): PassTally | undefined {
  if (!isRecord(stored)) return undefined;
  const { asked, calls, spentMicroEur, proposed, refusals, haltedOnSpendCap } = stored;
  if (
    !isAmount(asked) ||
    !isAmount(calls) ||
    !isAmount(spentMicroEur) ||
    !isAmount(proposed) ||
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

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
