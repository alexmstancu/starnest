/**
 * The five tuning values as text, and back again. No React, no markup.
 *
 * **Every one may be empty, and empty is the shipped state.** They are provisional by design
 * (`reqs.md` 3.10): the documents propose numbers and the household chooses them, so an empty
 * field is a decision not yet made and is sent as null rather than filled in with something
 * plausible. That is also why a ranking refuses to compute until the score scale is set instead
 * of assuming 100 (`devplan.md` 0.3).
 */

import type { Settings } from "../../../api/endpoints";

/**
 * How much is lost while a setting is undecided.
 *
 * `blocking` means the product cannot do its job: a ranking refuses to compute without a score
 * scale, so Rank and Compare have nothing to show. `advisory` means a rule is simply not in
 * force, which is a different and much smaller thing -- and conflating the two would teach a
 * reader that every warning here is decorative.
 */
export type UnsetSeverity = "blocking" | "advisory";

export interface SettingField {
  name: SettingName;
  label: string;
  /**
   * What the figure is counted in, printed beside the box.
   *
   * **Without it every field is a bare number and two of them are ambiguous**: a coverage
   * floor of 60 could be a percentage or a count of attributes, and a spend cap of 10 could
   * be euros or calls. The unit is not part of the label, because a label is read out as the
   * field's name and "Spend cap per acquisition €" is not what it is called.
   */
  unit: string;
  description: string;
  /** What is true *while this is blank*, in plain words. */
  consequence: string;
  severity: UnsetSeverity;
}

/**
 * The five limits, in the order the design puts them.
 *
 * **The floor leads and the ceilings follow**, which is the order they are decided in: what
 * makes a score trustworthy enough to show, then how high a score goes, then how much may be
 * compared, spent and re-fetched. The labels are the design's; the descriptions and the
 * consequences are this project's, because they state what our contract actually does with
 * each value rather than what a prototype assumed.
 */
export const SETTING_FIELDS = [
  {
    name: "min_coverage",
    label: "Minimum coverage to score",
    unit: "%",
    description: "Below this, a candidate is insufficient_data.",
    consequence:
      "No coverage floor is in force, so a candidate is scored however little is known about it.",
    severity: "advisory",
  },
  {
    name: "score_scale_max",
    label: "Top of the score range",
    unit: "points",
    description: "The top of every score. Nothing assumes 100.",
    consequence: "Nothing can be ranked or compared until this is set.",
    severity: "blocking",
  },
  {
    name: "comparator_limit",
    label: "Candidates you can compare at once",
    unit: "candidates",
    description: "How many comparators one comparison may hold.",
    consequence: "A comparison accepts as many comparators as you pick.",
    severity: "advisory",
  },
  {
    name: "run_spend_cap_eur",
    label: "Spend cap per acquisition",
    unit: "€",
    description: "A run halts here, keeping what it fetched.",
    consequence:
      "A run that can spend refuses to start until a cap is set, or the request accepts going uncapped.",
    severity: "advisory",
  },
  {
    name: "refetch_older_than_days",
    label: "Refetch data older than",
    unit: "days",
    description:
      "How old a figure must be before a run asks about it again. Not what decides which figure scores.",
    consequence:
      "Every run re-fetches everything in its scope, including figures fetched minutes ago.",
    severity: "advisory",
  },
] as const satisfies readonly SettingField[];

export type SettingName =
  | "score_scale_max"
  | "min_coverage"
  | "comparator_limit"
  | "run_spend_cap_eur"
  | "refetch_older_than_days";

/** The fields left blank, in the order they are shown. */
export function unsetFields(
  draft: SettingsDraft,
): readonly SettingField[] {
  return SETTING_FIELDS.filter((field) => draft[field.name].trim() === "");
}

/**
 * Whether anything blank stops the product working, rather than merely leaving a rule off.
 *
 * The design's round-2 review found its prototype stating this rule and then ranking anyway
 * (R3), which is worse than saying nothing: it teaches that the warnings are decoration.
 */
export function isBlocked(draft: SettingsDraft): boolean {
  return unsetFields(draft).some((field) => field.severity === "blocking");
}

export type SettingsDraft = Record<SettingName, string>;

/** The five values as the text of five inputs, which is what a half-typed number has to be. */
export function draftOf(settings: Settings): SettingsDraft {
  return Object.fromEntries(
    SETTING_FIELDS.map((field) => [field.name, asText(settings[field.name])]),
  ) as SettingsDraft;
}

export function settingsFrom(draft: SettingsDraft): Settings {
  return {
    score_scale_max: asNumber(draft.score_scale_max),
    min_coverage: asNumber(draft.min_coverage),
    comparator_limit: asNumber(draft.comparator_limit),
    run_spend_cap_eur: asNumber(draft.run_spend_cap_eur),
    refetch_older_than_days: asNumber(draft.refetch_older_than_days),
  };
}

function asText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** An empty field is null, never zero: "not decided" and "decided to be nothing" differ. */
function asNumber(typed: string): number | null {
  return typed.trim() === "" ? null : Number(typed);
}
