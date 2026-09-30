/**
 * A figure typed by hand, turned into the request the contract takes.
 *
 * **Parsing and presentational guards, not domain rules.** The API decides whether an attribute
 * accepts a hand-typed value at all (`409 manual_entry_not_permitted`) and whether a payload
 * matches its declared type; what lives here is text-to-record conversion and the questions the
 * form can answer before it is worth sending anything — because a refusal naming an empty field
 * tells the reader less than the form already can. When the two disagree, the server wins and
 * its refusal is what appears.
 *
 * **Two types, because two types is what the catalog permits.** Five attributes declare
 * `manual_entry`: two `LabelSet`, two `AssignedScore`, one `Quantity` that already has a figure.
 * Monetary, Count and Ratio have no attribute that would accept one, so an editor for them would
 * be a form nobody can open.
 */

import type { ManualValueInput } from "../../api/endpoints";

export type ManualKind = "LabelSet" | "AssignedScore";

/** Every field as the string that was typed, so a half-finished entry is exactly what is there. */
export interface ManualDraft {
  candidate: string;
  /** Comma-separated as typed; split on submit. `LabelSet` only. */
  labels: string;
  /** `AssignedScore` only. */
  value: string;
  rangeMin: string;
  rangeMax: string;
  rationale: string;
  periodStart: string;
  periodEnd: string;
  confidence: "absolute" | "high" | "medium" | "low";
  quote: string;
  citation: string;
}

export const NOTHING_TYPED: ManualDraft = {
  candidate: "",
  labels: "",
  value: "",
  // **A range with no default.** 0–10 is the obvious guess and it is still a guess: the scale a
  // score sits on is what makes it mean anything, so it is asked rather than assumed.
  rangeMin: "",
  rangeMax: "",
  rationale: "",
  periodStart: "",
  periodEnd: "",
  // The contract's own default: a deliberately unflattering middle, because a source tier says
  // nothing useful about a value somebody typed (`reqs.md` 5.7).
  confidence: "medium",
  quote: "",
  citation: "",
};

export type Built =
  | { readonly body: ManualValueInput; readonly problems: readonly [] }
  | { readonly body: null; readonly problems: readonly string[] };

/**
 * The request, or the reasons there is not one yet.
 *
 * `retrievalDate` is passed in rather than read from the clock here, so the module stays a pure
 * function and a test can assert the exact stamp. It is *now* for a hand-typed figure — the
 * retrieval date is when this application learned the value, which for typing is the moment of
 * typing. The reference date is a different question and the form asks it.
 */
export function buildManualValue(
  attribute: string,
  kind: ManualKind,
  draft: ManualDraft,
  retrievalDate: string,
): Built {
  const problems: string[] = [];

  if (draft.candidate.trim() === "") problems.push("Choose the candidate this figure is about.");

  // **Both dates, never one.** The reference period is what the figure describes and the
  // retrieval date is when we learned it; merging them is the invariant this application is
  // built to keep (`reqs.md` 3.6), and a period nobody stated cannot be guessed from the other.
  if (draft.periodStart === "" || draft.periodEnd === "") {
    problems.push("Say what period this figure describes — both dates.");
  } else if (draft.periodStart > draft.periodEnd) {
    problems.push("The period ends before it starts.");
  }

  const payload =
    kind === "LabelSet"
      ? labelSetPayload(draft, problems)
      : assignedScorePayload(draft, problems);

  if (problems.length > 0 || payload === null) {
    return { body: null, problems };
  }

  return {
    body: {
      candidate: draft.candidate.trim(),
      attribute,
      payload,
      reference_period: { start: draft.periodStart, end: draft.periodEnd },
      retrieval_date: retrievalDate,
      confidence_level: draft.confidence,
      quote: draft.quote.trim() === "" ? null : draft.quote.trim(),
      citations: draft.citation.trim() === "" ? [] : [draft.citation.trim()],
    },
    problems: [],
  };
}

function labelSetPayload(
  draft: ManualDraft,
  problems: string[],
): { labels: string[] } | null {
  const labels = splitLabels(draft.labels);
  if (labels.length === 0) {
    problems.push("Name at least one — separate several with commas.");
    return null;
  }
  return { labels };
}

/** Trimmed, blanks dropped, duplicates dropped, order kept as typed. */
export function splitLabels(typed: string): string[] {
  const seen = new Set<string>();
  for (const label of typed.split(",")) {
    const trimmed = label.trim();
    if (trimmed !== "") seen.add(trimmed);
  }
  return [...seen];
}

function assignedScorePayload(
  draft: ManualDraft,
  problems: string[],
): {
  value: number;
  range_min: number;
  range_max: number;
  assigned_by: "human";
  rationale?: string;
} | null {
  const value = numberFrom(draft.value);
  const min = numberFrom(draft.rangeMin);
  const max = numberFrom(draft.rangeMax);

  if (value === null) problems.push("The score must be a number.");
  if (min === null || max === null) {
    problems.push("Give the scale the score sits on — its lowest and highest points.");
  } else if (min >= max) {
    problems.push("The scale's lowest point must be below its highest.");
  } else if (value !== null && (value < min || value > max)) {
    problems.push(`The score must sit between ${String(min)} and ${String(max)}.`);
  }

  if (value === null || min === null || max === null) return null;

  return {
    value,
    range_min: min,
    range_max: max,
    // **Never `llm`.** The field exists to keep a judgement somebody made apart from one a model
    // produced; a form that could claim the other would make the distinction worthless.
    assigned_by: "human",
    ...(draft.rationale.trim() === "" ? {} : { rationale: draft.rationale.trim() }),
  };
}

function numberFrom(typed: string): number | null {
  if (typed.trim() === "") return null;
  const parsed = Number(typed);
  return Number.isFinite(parsed) ? parsed : null;
}
