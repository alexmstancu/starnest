/**
 * The household form's arithmetic, with no React and no markup in it.
 *
 * **Parsing, not rules.** "At least one citizenship" is enforced by the API, which is the
 * authority on what a household may be (`arch.md` 8.1); what lives here is the text-to-record
 * conversion and the question the form needs answered before it is worth sending anything --
 * because a refusal naming a missing field tells the user less than the form already can. When
 * the server disagrees with any of it, the server wins and its refusal is what appears.
 *
 * Separated from `HouseholdPanel.tsx` so that the markup file has no conversions in it: there
 * were fifteen, among the inputs they belonged to.
 */

import type { Household } from "../../../api/endpoints";
import {
  describeRule,
  numberAsInput,
  readNumber,
  type NumberRule,
} from "../../../format/typedNumber";

/**
 * The form as text.
 *
 * Every field is the string that was typed rather than a number, so a half-typed "1." or an
 * emptied field is exactly what the user put there. The conversion happens once, on submit.
 */
export interface HouseholdDraft {
  net_income: string;
  number_adults: string;
  number_children: string;
  target_monthly_spend: string;
  max_rent: string;
  home_country_candidate: string;
  home_city_candidate: string;
  citizenships: string;
}

/**
 * An empty record to fill in, which is not a default household: every field is blank, so
 * nothing here is a number somebody would have to notice and correct.
 */
export const NOTHING_RECORDED: Household = {
  net_income: Number.NaN,
  number_adults: Number.NaN,
  number_children: Number.NaN,
  home_country_candidate: "",
  home_city_candidate: null,
  citizenships: [],
};

/**
 * What each number field reads, and its range (PL-028): **the contract's `HouseholdInput`
 * bounds**, checked before anything is sent and stated in the field's note. Money is shown with
 * cents only where it has any, as the design's `7,400` has none.
 */
export const HOUSEHOLD_RULES = {
  net_income: { kind: "money", minimum: 0, optional: false, cents: "if-any" },
  number_adults: { kind: "whole", minimum: 1, optional: false },
  number_children: { kind: "whole", minimum: 0, optional: false },
  target_monthly_spend: { kind: "money", minimum: 0, optional: true, cents: "if-any" },
  max_rent: { kind: "money", minimum: 0, optional: true, cents: "if-any" },
} as const satisfies Record<string, NumberRule>;

type NumberFieldName = keyof typeof HOUSEHOLD_RULES;

/** Each number field's range in words, for a server refusal whose kind the form does not know. */
export const HOUSEHOLD_RANGES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(HOUSEHOLD_RULES).map(([name, rule]) => [name, describeRule(rule)]),
);

export function draftOf(household: Household): HouseholdDraft {
  return {
    net_income: numberAsText(household.net_income, "net_income"),
    number_adults: numberAsText(household.number_adults, "number_adults"),
    number_children: numberAsText(household.number_children, "number_children"),
    target_monthly_spend: numberAsText(household.target_monthly_spend, "target_monthly_spend"),
    max_rent: numberAsText(household.max_rent, "max_rent"),
    home_country_candidate: household.home_country_candidate ?? "",
    home_city_candidate: household.home_city_candidate ?? "",
    citizenships: (household.citizenships ?? []).join(", "),
  };
}

/**
 * The record a draft describes, ready to send. Only for a draft the form would send: a field it
 * refuses throws rather than going out as something else.
 */
export function householdFrom(draft: HouseholdDraft): Household {
  return {
    net_income: requiredNumber(draft, "net_income"),
    number_adults: requiredNumber(draft, "number_adults"),
    number_children: requiredNumber(draft, "number_children"),
    target_monthly_spend: optionalNumber(draft, "target_monthly_spend"),
    max_rent: optionalNumber(draft, "max_rent"),
    home_country_candidate: draft.home_country_candidate.trim(),
    // Null rather than an empty string: not living in a city is a fact, and a city called ""
    // is not (`reqs.md` 3.9).
    home_city_candidate: draft.home_city_candidate.trim() || null,
    citizenships: citizenshipsIn(draft),
  };
}

export function citizenshipsIn(draft: HouseholdDraft): string[] {
  return draft.citizenships
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Whether the five fields the contract requires are all present.
 *
 * The form refuses to send without them, and says which they are. Sending anyway would earn a
 * 400 naming one field at a time, which is a slower way to learn the same thing.
 */
export function isIncomplete(draft: HouseholdDraft): boolean {
  return (
    draft.net_income.trim() === "" ||
    draft.number_adults.trim() === "" ||
    draft.number_children.trim() === "" ||
    draft.home_country_candidate.trim() === "" ||
    citizenshipsIn(draft).length === 0
  );
}

/** The fields that hold a number, in the order the form shows them. */
const NUMBER_FIELDS = Object.keys(HOUSEHOLD_RULES) as NumberFieldName[];

/**
 * The number fields holding text the form cannot send, in the order they are shown: not a
 * number, outside the field's range, or half typed. A required field left blank is not here:
 * `isIncomplete` says that, and names the fields.
 *
 * **Neither filled nor empty** (UI-10): a lone point in the rent went out as NaN, which JSON
 * sends as null -- a rent cap cleared by a typo. The form refuses to send while any is here.
 */
export function invalidHouseholdFields(
  draft: HouseholdDraft,
): readonly (keyof HouseholdDraft)[] {
  return NUMBER_FIELDS.filter((field) => {
    const reading = readNumber(draft[field], HOUSEHOLD_RULES[field]);
    if (reading.kind === "incomplete") return true;
    return reading.kind === "refused" && reading.refusal.code !== "required";
  });
}

/** A blank field for anything that is not a number, the not-yet-recorded case included. */
function numberAsText(value: number | null | undefined, field: NumberFieldName): string {
  return value === null || value === undefined || Number.isNaN(value)
    ? ""
    : numberAsInput(value, HOUSEHOLD_RULES[field]);
}

function requiredNumber(draft: HouseholdDraft, field: NumberFieldName): number {
  const reading = readNumber(draft[field], HOUSEHOLD_RULES[field]);
  if (reading.kind !== "number") throw new Error("A household figure the form refuses was about to be sent.");
  return reading.value;
}

/** An empty optional field is absent, not zero -- a target spend of 0 would be a decision. */
function optionalNumber(draft: HouseholdDraft, field: NumberFieldName): number | undefined {
  if (draft[field].trim() === "") return undefined;
  return requiredNumber(draft, field);
}
