/**
 * What the household panel *does*: hold what was typed, send it, and report what came back.
 *
 * The markup is `HouseholdPanel.tsx` and the arithmetic is `householdForm.ts`. This is the
 * middle: React state and the one call to the API.
 */

import { useRef, useState, type FormEvent } from "react";
import { replaceHousehold, type Household } from "../../../api/endpoints";
import { fieldProblems } from "../../../api/fieldProblems";
import {
  HOUSEHOLD_RANGES,
  draftOf,
  householdFrom,
  invalidHouseholdFields,
  isIncomplete,
  type HouseholdDraft,
} from "./householdForm";
import { noteRankingInputsChanged } from "../../../api/rankingInputs";

export interface HouseholdForm {
  draft: HouseholdDraft;
  /** True while a field the contract requires is empty, so the form can say which. */
  incomplete: boolean;
  /** Fields holding text no number can be read from. Nothing is sent while there are any. */
  invalid: readonly (keyof HouseholdDraft)[];
  /** A refusal no field carries. One that names fields is said on them instead. */
  failure: unknown;
  /**
   * The server's refusal of each field it named, in words (PL-028). Kept on a field until that
   * field is edited.
   */
  problems: Partial<Record<keyof HouseholdDraft, string>>;
  saved: boolean;
  /** A save is in flight, so another may not start. */
  saving: boolean;
  change: (field: keyof HouseholdDraft, value: string) => void;
  save: (event: FormEvent) => void;
}

/**
 * **The PUT answers with the record, so nothing is re-fetched after a save.** Reloading would
 * unmount the form mid-flight and lose the confirmation with it, to be told what the response
 * already said -- so the draft is rebuilt from what came back, unless something was typed while
 * it was in flight: that is newer than what was stored, and stays.
 */
export function useHouseholdForm(household: Household): HouseholdForm {
  const [draft, setDraft] = useState<HouseholdDraft>(draftOf(household));
  const [failure, setFailure] = useState<unknown>(null);
  const [problems, setProblems] = useState<Partial<Record<keyof HouseholdDraft, string>>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // Refs, because both are read when a save starts and when it ends, and neither is drawn.
  const inFlight = useRef(false);
  // **Bumped by every keystroke** (UI-06). A save adopts the record it stored only if nothing
  // was typed while it was in flight: what is on screen is newer then, and stays.
  const revision = useRef(0);
  const invalid = invalidHouseholdFields(draft);

  function change(field: keyof HouseholdDraft, value: string): void {
    revision.current += 1;
    setDraft((current) => ({ ...current, [field]: value }));
    setProblems((current) =>
      Object.fromEntries(Object.entries(current).filter(([name]) => name !== field)),
    );
    setSaved(false);
  }

  async function send(): Promise<void> {
    if (inFlight.current || invalid.length > 0) return;
    inFlight.current = true;
    const sentAt = revision.current;
    setSaving(true);
    setFailure(null);
    setProblems({});
    setSaved(false);
    try {
      const stored = await replaceHousehold(householdFrom(draft));
      noteRankingInputsChanged();
      if (revision.current === sentAt) {
        setDraft(draftOf(stored));
        setSaved(true);
      }
    } catch (error) {
      const named = Object.fromEntries(
        [...fieldProblems(error, HOUSEHOLD_RANGES)].filter(([field]) => field in draft),
      );
      if (Object.keys(named).length > 0) setProblems(named);
      else setFailure(error);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return {
    draft,
    incomplete: isIncomplete(draft),
    invalid,
    failure,
    problems,
    saved,
    saving,
    change,
    save: (event: FormEvent) => {
      event.preventDefault();
      void send();
    },
  };
}
