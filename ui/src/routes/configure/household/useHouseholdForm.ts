/**
 * What the household panel *does*: hold what was typed, send it, and report what came back.
 *
 * The markup is `HouseholdPanel.tsx` and the arithmetic is `householdForm.ts`. The state is the
 * one every record form shares (`useRecordForm.ts`); what is the household's own is here.
 */

import { fetchHousehold, replaceHousehold, type Household } from "../../../api/endpoints";
import { HOUSEHOLD_LABELS } from "../../../format/vocabulary";
import { useRecordForm, type RecordForm } from "../useRecordForm";
import {
  HOUSEHOLD_RANGES,
  HOUSEHOLD_RULES,
  draftOf,
  householdFrom,
  invalidHouseholdFields,
  isIncomplete,
  type HouseholdDraft,
} from "./householdForm";

export interface HouseholdForm extends RecordForm<Household, HouseholdDraft> {
  /** True while a field the contract requires is empty, so the form can say which. */
  incomplete: boolean;
}

export function useHouseholdForm(household: Household): HouseholdForm {
  const form = useRecordForm<Household, HouseholdDraft>({
    key: "household",
    stored: household,
    draftOf,
    rules: HOUSEHOLD_RULES,
    invalid: invalidHouseholdFields,
    ranges: HOUSEHOLD_RANGES,
    recordOf: householdFrom,
    write: (record) => replaceHousehold(record),
    read: (signal) => fetchHousehold({ signal }),
    recorded: {
      stage: "Household",
      // Where the household lives and which passports it holds are identifiers: said to have
      // changed, never printed (NEW-07).
      wording: {
        labels: HOUSEHOLD_LABELS,
        opaque: ["home_country_candidate", "home_city_candidate", "citizenships"],
      },
    },
  });
  return { ...form, incomplete: isIncomplete(form.draft) };
}
