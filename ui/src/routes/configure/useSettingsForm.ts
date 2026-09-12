/** What the settings panel does: hold the four values, send them, report what came back. */

import { useState, type FormEvent } from "react";
import { replaceSettings, type Settings } from "../../api/endpoints";
import {
  draftOf,
  settingsFrom,
  type SettingName,
  type SettingsDraft,
} from "./settingsForm";

export interface SettingsForm {
  draft: SettingsDraft;
  failure: unknown;
  saved: boolean;
  change: (name: SettingName, value: string) => void;
  save: (event: FormEvent) => void;
}

/**
 * **The PUT answers with the record, so nothing is re-fetched after a save.** A reload here
 * would unmount the form while the second GET was in flight, taking the confirmation with it --
 * to be told what the response had already said.
 */
export function useSettingsForm(settings: Settings): SettingsForm {
  const [draft, setDraft] = useState(draftOf(settings));
  const [failure, setFailure] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function send(): Promise<void> {
    setFailure(null);
    setSaved(false);
    try {
      setDraft(draftOf(await replaceSettings(settingsFrom(draft))));
      setSaved(true);
    } catch (error) {
      setFailure(error);
    }
  }

  return {
    draft,
    failure,
    saved,
    change: (name, value) =>
      setDraft((current) => ({ ...current, [name]: value })),
    save: (event: FormEvent) => {
      event.preventDefault();
      void send();
    },
  };
}
