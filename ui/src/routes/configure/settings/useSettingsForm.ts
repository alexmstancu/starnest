/** What the settings panel does: hold the five values, send them, report what came back. */

import { replaceSettings, type Settings } from "../../../api/endpoints";
import { useRecordForm, type RecordForm } from "../useRecordForm";
import {
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
  });
}
