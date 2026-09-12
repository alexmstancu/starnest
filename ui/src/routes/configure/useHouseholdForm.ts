/**
 * What the household panel *does*: hold what was typed, send it, and report what came back.
 *
 * The markup is `HouseholdPanel.tsx` and the arithmetic is `householdForm.ts`. This is the
 * middle: React state and the one call to the API.
 */

import { useState, type FormEvent } from "react";
import { replaceHousehold, type Household } from "../../api/endpoints";
import {
  draftOf,
  householdFrom,
  isIncomplete,
  type HouseholdDraft,
} from "./householdForm";

export interface HouseholdForm {
  draft: HouseholdDraft;
  /** True while a field the contract requires is empty, so the form can say which. */
  incomplete: boolean;
  failure: unknown;
  saved: boolean;
  change: (field: keyof HouseholdDraft, value: string) => void;
  save: (event: FormEvent) => void;
}

/**
 * **The PUT answers with the record, so nothing is re-fetched after a save.** Reloading would
 * unmount the form mid-flight and lose the confirmation with it, to be told what the response
 * already said -- so the draft is rebuilt from what came back.
 */
export function useHouseholdForm(household: Household): HouseholdForm {
  const [draft, setDraft] = useState<HouseholdDraft>(draftOf(household));
  const [failure, setFailure] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  function change(field: keyof HouseholdDraft, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  async function send(): Promise<void> {
    setFailure(null);
    setSaved(false);
    try {
      setDraft(draftOf(await replaceHousehold(householdFrom(draft))));
      setSaved(true);
    } catch (error) {
      setFailure(error);
    }
  }

  return {
    draft,
    incomplete: isIncomplete(draft),
    failure,
    saved,
    change,
    save: (event: FormEvent) => {
      event.preventDefault();
      void send();
    },
  };
}
