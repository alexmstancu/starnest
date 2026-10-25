/** What the settings panel does: hold the four values, send them, report what came back. */

import { useRef, useState, type FormEvent } from "react";
import { replaceSettings, type Settings } from "../../../api/endpoints";
import { fieldProblems } from "../../../api/fieldProblems";
import {
  SETTING_RANGES,
  draftOf,
  invalidSettings,
  settingsFrom,
  type SettingName,
  type SettingsDraft,
} from "./settingsForm";
import { noteRankingInputsChanged } from "../../../api/rankingInputs";

export interface SettingsForm {
  draft: SettingsDraft;
  /** Fields holding text no number can be read from. Nothing is sent while there are any. */
  invalid: readonly SettingName[];
  /** A refusal no field carries. One that names fields is said on them instead. */
  failure: unknown;
  /**
   * The server's refusal of each field it named, in words (PL-028). Kept on a field until that
   * field is edited.
   */
  problems: Partial<Record<SettingName, string>>;
  saved: boolean;
  /** A save is in flight, so another may not start. */
  saving: boolean;
  change: (name: SettingName, value: string) => void;
  save: (event: FormEvent) => void;
}

/**
 * **The PUT answers with the record, so nothing is re-fetched after a save.** A reload here
 * would unmount the form while the second GET was in flight, taking the confirmation with it --
 * to be told what the response had already said. What was typed while it was in flight is newer
 * than what was stored, so it stays.
 */
export function useSettingsForm(settings: Settings): SettingsForm {
  const [draft, setDraft] = useState(draftOf(settings));
  const [failure, setFailure] = useState<unknown>(null);
  const [problems, setProblems] = useState<Partial<Record<SettingName, string>>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // Refs, because both are read when a save starts and when it ends, and neither is drawn.
  const inFlight = useRef(false);
  // **Bumped by every keystroke** (UI-06). A save adopts the record it stored only if nothing
  // was typed while it was in flight: what is on screen is newer then, and stays.
  const revision = useRef(0);
  const invalid = invalidSettings(draft);

  async function send(): Promise<void> {
    if (inFlight.current || invalid.length > 0) return;
    inFlight.current = true;
    const sentAt = revision.current;
    setSaving(true);
    setFailure(null);
    setProblems({});
    setSaved(false);
    try {
      const stored = await replaceSettings(settingsFrom(draft));
      noteRankingInputsChanged();
      if (revision.current === sentAt) {
        setDraft(draftOf(stored));
        setSaved(true);
      }
    } catch (error) {
      const named = onTheForm(fieldProblems(error, SETTING_RANGES), draft);
      if (Object.keys(named).length > 0) setProblems(named);
      else setFailure(error);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return {
    draft,
    invalid,
    failure,
    problems,
    saved,
    saving,
    change: (name, value) => {
      revision.current += 1;
      setDraft((current) => ({ ...current, [name]: value }));
      setProblems((current) =>
        Object.fromEntries(Object.entries(current).filter(([field]) => field !== name)),
      );
    },
    save: (event: FormEvent) => {
      event.preventDefault();
      void send();
    },
  };
}

/** Only the problems about a field this form shows: one about anything else names nothing here. */
function onTheForm(
  problems: Map<string, string>,
  draft: SettingsDraft,
): Partial<Record<SettingName, string>> {
  return Object.fromEntries([...problems].filter(([field]) => field in draft));
}
