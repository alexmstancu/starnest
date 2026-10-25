/** What the settings panel does: hold the five values, send them, report what came back. */

import { replaceSettings, type Settings } from "../../../api/endpoints";
import { useRecordForm, type RecordForm } from "../useRecordForm";
import {
  SETTING_FIELDS,
  SETTING_RANGES,
  SETTING_RULES,
  draftOf,
  invalidSettings,
  settingsFrom,
  type SettingsDraft,
} from "./settingsForm";

export type SettingsForm = RecordForm<Settings, SettingsDraft>;

export function useSettingsForm(settings: Settings): SettingsForm {
  return useRecordForm<Settings, SettingsDraft>({
    key: "settings",
    stored: settings,
    draftOf,
    rules: SETTING_RULES,
    invalid: invalidSettings,
    ranges: SETTING_RANGES,
    send: (draft) => replaceSettings(settingsFrom(draft)),
    recorded: { stage: "Acquisition limits", wording: { labels: LABELS }, consequences: CONSEQUENCES },
  });
}

const LABELS = Object.fromEntries(
  SETTING_FIELDS.map(({ name, label }) => [name, label]),
) as Record<keyof SettingsDraft, string>;

/** What each setting left unset stops, lower-cased to follow "unsets <label>:". */
const CONSEQUENCES = Object.fromEntries(
  SETTING_FIELDS.map(({ name, consequence }) => [
    name,
    consequence.charAt(0).toLowerCase() + consequence.slice(1),
  ]),
) as Partial<Record<keyof SettingsDraft, string>>;
