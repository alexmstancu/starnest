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

import type { Household } from "../../api/endpoints";

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

export function draftOf(household: Household): HouseholdDraft {
  return {
    net_income: numberAsText(household.net_income),
    number_adults: numberAsText(household.number_adults),
    number_children: numberAsText(household.number_children),
    target_monthly_spend: numberAsText(household.target_monthly_spend),
    max_rent: numberAsText(household.max_rent),
    home_country_candidate: household.home_country_candidate ?? "",
    home_city_candidate: household.home_city_candidate ?? "",
    citizenships: (household.citizenships ?? []).join(", "),
  };
}

/** The record a draft describes, ready to send. */
export function householdFrom(draft: HouseholdDraft): Household {
  return {
    net_income: Number(draft.net_income),
    number_adults: Number(draft.number_adults),
    number_children: Number(draft.number_children),
    target_monthly_spend: optionalNumber(draft.target_monthly_spend),
    max_rent: optionalNumber(draft.max_rent),
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

/** A blank field for anything that is not a number, the not-yet-recorded case included. */
function numberAsText(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value)
    ? ""
    : String(value);
}

/** An empty optional field is absent, not zero -- a target spend of 0 would be a decision. */
function optionalNumber(typed: string): number | undefined {
  return typed.trim() === "" ? undefined : Number(typed);
}
