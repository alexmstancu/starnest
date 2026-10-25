/**
 * The one place that turns an API failure into something a person reads (C01 M2, PL-003).
 *
 * `arch.md` 7.6: the client branches on `code`, never on prose. **Every code the contract lists
 * (`ErrorCode`) and every code this client makes for itself has a sentence here**, and the
 * table is held to both lists at compile time: a code added to the contract fails to build
 * until it is worded, and a code worded here that nobody sends fails too.
 *
 * **Never the server's sentence** (P1-07). `message` is for a person reading the API directly;
 * the specifics come from `details`, and names from lookups the caller hands in. A code from a
 * newer server than this interface is worded as a refusal, never by its message.
 */

import { ApiError, CLIENT_ERROR_CODES, isApiError, type ErrorCode } from "./ApiError";

/**
 * The refusal a weight change can meet: every other weight in the pillar is locked, so there
 * is nothing to rebalance into. Named here because two modules branch on it -- the table below
 * and `lockedAttributes` -- and a code spelled twice is a code that can be spelled wrong once.
 */
export const WEIGHTS_ALL_LOCKED = "weights_all_locked";

type ClientCode =
  | (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES]
  | "client.unexpected";

type Details = Readonly<Record<string, unknown>>;

/** Names for the ids a refusal carries. A lookup that has none says so, and the id is not shown. */
export interface Names {
  candidate?: (id: string) => string | undefined;
}

export interface Wording {
  cause: (details: Details, names: Names) => string;
  retryable: boolean;
  kind: "unreachable" | "fault" | "refusal" | "unset";
}

export interface PresentedError {
  /** For branching on -- a remedy, a form's field -- and never rendered. */
  code: string;
  kind: Wording["kind"];
  /** What to put on screen: the interface's own sentence, never the server's. */
  message: string;
  /** True when retrying the same request could plausibly succeed. */
  retryable: boolean;
}

const refusal = (sentence: string | ((details: Details, names: Names) => string)): Wording => ({
  cause: typeof sentence === "string" ? () => sentence : sentence,
  retryable: false,
  kind: "refusal",
});
const unset = (sentence: Parameters<typeof refusal>[0]): Wording => ({
  ...refusal(sentence),
  kind: "unset",
});

export const WORDS = {
  [CLIENT_ERROR_CODES.unreachable]: {
    cause: () => "The backend did not answer. Check that it is running, then try again.",
    retryable: true,
    kind: "unreachable",
  },
  // Never the server's own words: a fault's text is for its log, not for the screen (P1-11).
  [CLIENT_ERROR_CODES.serverFault]: {
    cause: () => "The server failed while answering.",
    retryable: true,
    kind: "fault",
  },
  [CLIENT_ERROR_CODES.malformedError]: {
    cause: () => "The backend reported an error in a shape this interface does not recognise.",
    retryable: false,
    kind: "fault",
  },
  [CLIENT_ERROR_CODES.malformedBody]: {
    cause: () => "The backend answered with something that is not JSON.",
    retryable: false,
    kind: "fault",
  },
  // Never retryable: the same body would be refused again, and it never left the browser.
  [CLIENT_ERROR_CODES.unsendableNumber]: refusal(
    "A value in this change is not a number that can be saved, so nothing was sent. " +
      "Check the figures typed, then save again.",
  ),
  "client.unexpected": {
    cause: () => "Something went wrong in this interface.",
    retryable: false,
    kind: "fault",
  },

  not_found: refusal("It is not there any more: it may have been deleted meanwhile."),
  candidate_not_found: refusal("That place is not among the candidates."),
  household_not_configured: unset("Nothing has been recorded about the household yet."),
  [WEIGHTS_ALL_LOCKED]: refusal(
    "Every other weight in this pillar is locked, so there is nothing to rebalance into.",
  ),
  criteria_set_exists: refusal("A criteria set with that name already exists."),
  criteria_set_name_taken: refusal((details) => {
    const name = text(details["name"]);
    return name === null
      ? "Another criteria set already has that name."
      : `Another criteria set is already called “${name}”.`;
  }),
  no_default_criteria_set: refusal("There is no criteria set to start a new one from."),
  nothing_to_retry: refusal("Nothing in that acquisition failed or went unanswered, so there is nothing to retry."),
  nothing_to_ask_again: refusal("Every gate already has an answer, so there is nothing to ask again."),
  spend_cap_not_set: unset(
    "This acquisition could spend money, and no spend cap is set. Set one in Configure, or accept an uncapped run.",
  ),
  nothing_to_fetch: refusal("Nothing in that scope can be fetched from a switched-on source."),
  selection_not_in_run: refusal((details) => {
    const outside = Array.isArray(details["pairs"]) ? details["pairs"].length : 0;
    if (outside === 0) return "The selection names items this acquisition cannot retry, so nothing was retried.";
    const items = outside === 1 ? "One selected item is" : `${outside} selected items are`;
    return `${items} not among what this acquisition can retry, so nothing was retried.`;
  }),
  run_already_in_flight: refusal((details) => {
    const run = whole(details["run"]);
    return run === null
      ? "Another acquisition is still going, and one runs at a time."
      : `Acquisition ${run} is still going, and one runs at a time.`;
  }),
  llm_not_configured: unset("The LLM source is switched off, or has no key configured."),
  manual_entry_not_permitted: refusal("This attribute does not accept a manually entered value."),
  manual_entry_switched_off: refusal(
    "Manual entry is switched off, so a figure typed now could not count. Switch it on under Source priority to type one.",
  ),
  invalid_value: refusal("That value is not one this attribute accepts."),
  conflicting_observation: refusal(
    "A different figure is already recorded for this place, attribute, source and period.",
  ),
  answer_recorded_by_a_person: refusal(
    "A person has already recorded this answer, so it is not replaced.",
  ),
  // The shipped state, not a fault: the scale is provisional by design and has no default.
  score_scale_not_set: unset(
    "Nothing can be ranked until the top of the score range is set. It has no default, " +
      "because the scale is a judgement rather than a fact.",
  ),
  score_scale_below_anchors: refusal((details) => {
    const minimum = number(details["minimum"]);
    return minimum === null
      ? "A criterion anchors a figure to a score above this top of the range."
      : `A criterion anchors a figure to a score above this top of the range; the lowest top that fits is ${minimum}.`;
  }),
  comparator_limit_not_set: unset(
    "Nothing can be compared until the most candidates a comparison may hold is set.",
  ),
  comparator_limit_exceeded: refusal((details) => {
    const limit = whole(details["limit"]);
    const asked = whole(details["asked"]);
    return limit === null || asked === null
      ? "This comparison holds more candidates than the limit allows."
      : `${asked} comparators were asked for, and the limit is ${limit}.`;
  }),
  invalid_comparison: refusal((details, names) => {
    const named = namedCandidates(details["candidates"], names);
    return named === ""
      ? "These candidates cannot be compared as chosen."
      : `These candidates cannot be compared as chosen: ${named}.`;
  }),
  invalid_criteria_set: refusal("The criteria set is not valid as written."),
  invalid_criterion: refusal((details) => {
    if (details["reason"] !== "anchor_above_scale") return "This rule is not valid as written.";
    const anchor = number(details["anchor_score"]);
    const top = number(details["score_scale_max"]);
    return anchor === null || top === null
      ? "A criterion anchors a figure to a score above the top of the score range."
      : `A criterion anchors a figure to a score of ${anchor}, above the top of the score range, ${top}.`;
  }),
  unknown_place: refusal("That place is not one this application knows."),
  invalid_reference_period: refusal("The period is not valid: it must not end before it starts."),
  invalid_request: refusal((details) => {
    if (fieldKinds(details).includes("malformed_identifier")) {
      return "Something this request names is not well formed, so nothing was done.";
    }
    const fields = fieldKinds(details).length;
    return fields > 1
      ? `${fields} values in this request are not valid, so nothing was done.`
      : "A value in this request is not valid, so nothing was done.";
  }),
  cannot_be_scored: refusal("This cannot be scored from the figures stored."),
  cannot_be_ranked: unset(cannotBeRanked),
  invalid_match_rule_result: refusal("That answer is not one this gate accepts."),
  unknown_data_source: refusal("That source is not in the catalog."),
  unknown_scope: refusal("The scope names something that does not exist at this level."),
  invalid_source_order: refusal("The source order must name every source once, and no other."),
} satisfies Record<ErrorCode | ClientCode, Wording>;

const NOT_WORDED: Wording = refusal("The server refused this.");

export function presentError(error: unknown, names: Names = {}): PresentedError {
  if (!isApiError(error)) return present("client.unexpected", WORDS["client.unexpected"], {}, names);
  const wording = (WORDS as Record<string, Wording | undefined>)[error.code];
  if (wording) return present(error.code, wording, error.details ?? {}, names);
  // A code from a newer server than this interface: a refusal, or a fault if it is a 5xx.
  const fallback = isFaultStatus(error) ? WORDS[CLIENT_ERROR_CODES.serverFault] : NOT_WORDED;
  return present(error.code, fallback, {}, names);
}

function present(code: string, wording: Wording, details: Details, names: Names): PresentedError {
  return {
    code,
    kind: wording.kind,
    message: wording.cause(details, names),
    retryable: wording.retryable,
  };
}

function isFaultStatus(error: ApiError): boolean {
  return error.status !== null && error.status >= 500;
}

function cannotBeRanked(details: Details): string {
  switch (details["reason"]) {
    case "scores_nothing":
      return "This criteria set scores nothing at this level: no criterion in it counts.";
    case "pillar_without_criteria":
    case "pillars_without_weight":
    case "criteria_without_weight":
      return "A pillar in this criteria set carries weight with nothing in it to score.";
    default:
      return "This criteria set cannot rank anything at this level as it stands.";
  }
}

/** The candidates named, by name; those without one counted, never shown by id. */
function namedCandidates(ids: unknown, names: Names): string {
  if (!Array.isArray(ids)) return "";
  const known: string[] = [];
  let unnamed = 0;
  for (const id of ids) {
    const name = typeof id === "string" ? names.candidate?.(id) : undefined;
    if (name === undefined) unnamed += 1;
    else known.push(name);
  }
  if (unnamed > 0) {
    known.push(unnamed === 1 ? (known.length ? "one other candidate" : "one candidate") : `${unnamed} ${known.length ? "other " : ""}candidates`);
  }
  return known.join(", ");
}

function fieldKinds(details: Details): string[] {
  const errors = details["errors"];
  if (!Array.isArray(errors)) return [];
  return errors.map((problem) =>
    typeof problem === "object" && problem !== null && typeof (problem as { kind?: unknown }).kind === "string"
      ? (problem as { kind: string }).kind
      : "",
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function whole(value: unknown): number | null {
  const figure = number(value);
  return figure !== null && Number.isInteger(figure) ? figure : null;
}

/**
 * The attributes whose locks blocked a weight change.
 *
 * `docs/openapi.yaml` types `Error.details` as a free-form object, and its one example for
 * this code carries `details.locked` as a list of attribute ids. So this reads that shape
 * defensively and returns nothing when it is absent: showing which locks are in the way is
 * worth doing, and guessing at them is not.
 */
export function lockedAttributes(error: unknown): string[] {
  if (!isApiError(error) || error.code !== WEIGHTS_ALL_LOCKED) return [];

  const locked = error.details?.["locked"];
  if (!Array.isArray(locked)) return [];

  return locked.filter((entry): entry is string => typeof entry === "string");
}
