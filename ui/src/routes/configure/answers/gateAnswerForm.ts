/**
 * A gate answer as typed, and the request it becomes. No React and no markup.
 *
 * **What this screen sends is always `manual`**: a person typed it, whatever it was prefilled
 * from. **The PUT replaces every field**, so a correction starts from the stored answer -- its
 * pages, its period and its override -- and drops none of them unless the person does.
 *
 * The checks here are the ones a form can make before sending: both dates or neither, every
 * page a full web address, an override with its reason. **Date order is the server's to
 * refuse** (422 `invalid_reference_period`), and it does.
 */

import type { MatchRuleResult, MatchRuleResultInput } from "../../../api/endpoints";

export type Answer = MatchRuleResultInput["match_result"];
export type PendingProposal = NonNullable<MatchRuleResult["pending_proposal"]>;

export interface GateAnswerDraft {
  matchRule: string;
  candidate: string;
  answer: Answer;
  reason: string;
  periodStart: string;
  periodEnd: string;
  overriding: boolean;
  overrideReason: string;
  /** One web address per line. */
  pages: string;
}

export type DraftField = "matchRule" | "candidate" | "period" | "overrideReason" | "pages";

export interface DraftProblem {
  field: DraftField;
  message: string;
}

export type DraftReading =
  | { ok: true; matchRule: string; candidate: string; input: MatchRuleResultInput }
  | { ok: false; problems: DraftProblem[] };

/**
 * `api/values.py`'s `WEB_ADDRESS`, character for character: the rule the server holds a typed
 * citation to. A gate's pages are held to it here, so a page nobody can follow is never stored.
 */
const WEB_ADDRESS = /^[Hh][Tt][Tt][Pp][Ss]?:\/\/[^\s/?#]+[^\s]*$/;

export function emptyDraft(): GateAnswerDraft {
  return {
    matchRule: "",
    candidate: "",
    answer: "matching",
    reason: "",
    periodStart: "",
    periodEnd: "",
    overriding: false,
    overrideReason: "",
    pages: "",
  };
}

/** A stored answer, to correct: everything it holds, so the PUT drops nothing unseen. */
export function draftFrom(stored: MatchRuleResult): GateAnswerDraft {
  return {
    ...contentOf(stored),
    matchRule: stored.match_rule,
    candidate: stored.candidate,
    overriding: stored.override_reason != null,
    overrideReason: stored.override_reason ?? "",
  };
}

/**
 * A re-check's proposal, to take as the person's answer. **Without the override**: that was a
 * reason for overriding the answer being replaced, and nothing the proposal says.
 */
export function draftFromProposal(
  stored: MatchRuleResult,
  proposal: PendingProposal,
): GateAnswerDraft {
  return {
    ...contentOf(proposal),
    matchRule: stored.match_rule,
    candidate: stored.candidate,
    overriding: false,
    overrideReason: "",
  };
}

function contentOf(answer: MatchRuleResult | PendingProposal) {
  return {
    answer: answer.match_result,
    reason: answer.reason ?? "",
    periodStart: answer.reference_period?.start ?? "",
    periodEnd: answer.reference_period?.end ?? "",
    pages: (answer.citations ?? []).join("\n"),
  };
}

export function readDraft(draft: GateAnswerDraft): DraftReading {
  const pages = linesOf(draft.pages);
  const overrideReason = draft.overrideReason.trim();
  const problems = problemsOf(draft, pages, overrideReason);
  if (problems.length > 0) return { ok: false, problems };

  const reason = draft.reason.trim();
  return {
    ok: true,
    matchRule: draft.matchRule,
    candidate: draft.candidate,
    input: {
      match_result: draft.answer,
      reason: reason === "" ? null : reason,
      data_source: "manual",
      // Null rather than left out: the PUT replaces, and a period cleared here is cleared there.
      reference_period:
        draft.periodStart === "" ? null : { start: draft.periodStart, end: draft.periodEnd },
      override_reason: draft.overriding ? overrideReason : null,
      citations: pages.map(({ text }) => text),
    },
  };
}

function problemsOf(
  draft: GateAnswerDraft,
  pages: { text: string; line: number }[],
  overrideReason: string,
): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (draft.matchRule === "") problems.push({ field: "matchRule", message: "Choose a gate." });
  if (draft.candidate === "") problems.push({ field: "candidate", message: "Choose a candidate." });
  if ((draft.periodStart === "") !== (draft.periodEnd === "")) {
    problems.push({
      field: "period",
      message: "A period needs both its first and its last day, or neither.",
    });
  }
  if (draft.overriding && overrideReason === "") {
    problems.push({
      field: "overrideReason",
      message: "Say why this overrides what the sources say, or untick the override.",
    });
  }
  const refused = pages.flatMap(({ text, line }) => (WEB_ADDRESS.test(text) ? [] : [line]));
  if (refused.length > 0) {
    const several = refused.length > 1;
    problems.push({
      field: "pages",
      message:
        `${several ? "Lines" : "Line"} ${refused.join(", ")} ` +
        `${several ? "are not full web addresses" : "is not a full web address"}: ` +
        "each page starts with http:// or https://.",
    });
  }
  return problems;
}

/** The non-blank lines, trimmed, with the line number a person would count to. */
function linesOf(text: string): { text: string; line: number }[] {
  return text
    .split("\n")
    .map((each, index) => ({ text: each.trim(), line: index + 1 }))
    .filter(({ text: each }) => each !== "");
}
