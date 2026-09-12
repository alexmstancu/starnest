/**
 * The four tuning values as text, and back again. No React, no markup.
 *
 * **Every one may be empty, and empty is the shipped state.** They are provisional by design
 * (`reqs.md` 3.10): the documents propose numbers and the household chooses them, so an empty
 * field is a decision not yet made and is sent as null rather than filled in with something
 * plausible. That is also why a ranking refuses to compute until the score scale is set instead
 * of assuming 100 (`devplan.md` 0.3).
 */

import type { Settings } from "../../api/endpoints";

export const SETTING_FIELDS = [
  [
    "score_scale_max",
    "Score scale maximum",
    "The top of every score. Nothing assumes 100.",
  ],
  [
    "min_coverage",
    "Minimum coverage",
    "Below this, a candidate is insufficient_data.",
  ],
  [
    "comparator_limit",
    "Comparator limit",
    "How many comparators one comparison may hold.",
  ],
  [
    "run_spend_cap_eur",
    "Run spend cap (EUR)",
    "A run halts here, keeping what it fetched.",
  ],
] as const;

export type SettingName = (typeof SETTING_FIELDS)[number][0];

export type SettingsDraft = Record<SettingName, string>;

/** The four values as the text of four inputs, which is what a half-typed number has to be. */
export function draftOf(settings: Settings): SettingsDraft {
  return Object.fromEntries(
    SETTING_FIELDS.map(([name]) => [name, asText(settings[name])]),
  ) as SettingsDraft;
}

export function settingsFrom(draft: SettingsDraft): Settings {
  return {
    score_scale_max: asNumber(draft.score_scale_max),
    min_coverage: asNumber(draft.min_coverage),
    comparator_limit: asNumber(draft.comparator_limit),
    run_spend_cap_eur: asNumber(draft.run_spend_cap_eur),
  };
}

function asText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** An empty field is null, never zero: "not decided" and "decided to be nothing" differ. */
function asNumber(typed: string): number | null {
  return typed.trim() === "" ? null : Number(typed);
}
