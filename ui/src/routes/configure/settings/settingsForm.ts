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
import {
  describeRule,
  numberAsInput,
  readNumber,
  type NumberRule,
} from "../../../format/typedNumber";

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
  /**
   * What the box reads, and its range (PL-028). **The same bounds as the contract's
   * `SettingsInput`**, checked before anything is sent and stated in the field's note; every
   * setting is optional, because blank is "not decided yet".
   */
  rule: NumberRule;
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
    // A percentage, and 57.5% is a real floor to want.
    rule: { kind: "decimal", minimum: 0, maximum: 100, optional: true },
    label: "Minimum coverage to score",
    unit: "%",
    description: "Below this, a candidate has insufficient data and shows no score.",
    consequence:
      "No coverage floor is in force, so a candidate is scored however little is known about it.",
    severity: "advisory",
  },
  {
    name: "score_scale_max",
    rule: { kind: "whole", minimum: 1, optional: true },
    label: "Top of the score range",
    unit: "points",
    description: "The top of every score. Nothing assumes 100.",
    consequence: "Nothing can be ranked or compared until this is set.",
    severity: "blocking",
  },
  {
    name: "comparator_limit",
    // Twenty is the product's ceiling (PL-030), held by the contract and the database too.
    rule: { kind: "whole", minimum: 1, maximum: 20, optional: true },
    label: "Candidates you can compare at once",
    unit: "candidates (1–20)",
    description: "How many comparators one comparison may hold.",
    // **What Compare does, not what it might be expected to** (UI-31): an unset limit is
    // refused with `comparator_limit_not_set`, never read as "no limit".
    consequence: "Compare refuses every comparison until this is set.",
    severity: "advisory",
  },
  {
    name: "run_spend_cap_eur",
    // Money, so cents, and always shown with them: "5.00", as the design draws it (PL-032).
    rule: { kind: "money", minimum: 0, optional: true, cents: "always" },
    label: "Spend cap per acquisition",
    unit: "€",
    // **The cap bounds gate research too** (`api/rules.py`, `data_acquisition/research.py`).
    description:
      "An acquisition halts here, keeping what it fetched, and so does each gate-research pass.",
    consequence:
      "An acquisition or a gate-research pass that can spend refuses to start until a cap is " +
      "set, or the request accepts going uncapped.",
    severity: "advisory",
  },
  {
    name: "refetch_older_than_days",
    rule: { kind: "whole", minimum: 1, optional: true },
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
 * What the warning above the form says about the blanks: how many, and what each stops.
 *
 * **Compare is named** (PL-030): an unset comparator limit refuses every comparison, which "the
 * rule behind it is not in force" made sound like a rule quietly switched off.
 */
export function describeUnset(unset: readonly SettingField[]): string {
  const count =
    unset.length === 1 ? "One setting is not set" : `${String(unset.length)} settings are not set`;
  const others = unset.length - (unset.some(isComparatorLimit) ? 1 : 0);
  if (others === unset.length) {
    return unset.length === 1
      ? `${count}, so the rule behind it is not in force.`
      : `${count}, so the rules behind them are not in force.`;
  }
  const stopsCompare = `${count}: Compare refuses every comparison until the comparator limit is set`;
  if (others === 0) return `${stopsCompare}.`;
  return others === 1
    ? `${stopsCompare}, and the rule behind the other is not in force.`
    : `${stopsCompare}, and the rules behind the other ${String(others)} are not in force.`;
}

function isComparatorLimit(field: SettingField): boolean {
  return field.name === "comparator_limit";
}

/**
 * The fields holding text the form cannot send, in the order they are shown: not a number,
 * outside the field's range, or half typed.
 *
 * **Neither set nor unset** (UI-10): a lone point is not a decision to leave a rule off, and
 * sending it as null would make it one. Nor is a limit of 25 a limit the server will store. The
 * form refuses to send while any field is here -- a stored value outside a range included, which
 * loads, is marked, and holds Save until it is fixed.
 */
export function invalidSettings(draft: SettingsDraft): readonly SettingName[] {
  return SETTING_FIELDS.filter((field) => {
    const reading = readNumber(draft[field.name], field.rule);
    return reading.kind === "refused" || reading.kind === "incomplete";
  }).map((field) => field.name);
}

/** Each field's range in words, for a server refusal whose kind the form does not know. */
export const SETTING_RANGES: Readonly<Record<string, string>> = Object.fromEntries(
  SETTING_FIELDS.map((field) => [field.name, describeRule(field.rule)]),
);

/** How each setting reads what is typed, by name. */
export const SETTING_RULES: Readonly<Record<SettingName, NumberRule>> = Object.fromEntries(
  SETTING_FIELDS.map((field) => [field.name, field.rule]),
) as Record<SettingName, NumberRule>;

/**
 * What is true while a field is blank, said of the draft (PL-025, UF-033). **Blank and stored
 * blank, it is in force now; blank only in the draft, it is what saving would do**, because the
 * banners above the form describe the stored settings and a draft has not changed them yet.
 */
export function blankConsequence(consequence: string, storedBlank: boolean): string {
  if (storedBlank) return consequence;
  // A screen's name keeps its capital mid-sentence.
  const opening = consequence.startsWith("Compare ")
    ? consequence
    : consequence.charAt(0).toLowerCase() + consequence.slice(1);
  return `If you save this, ${opening}`;
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
    SETTING_FIELDS.map((field) => [field.name, numberAsInput(settings[field.name], field.rule)]),
  ) as SettingsDraft;
}

/** Only for a draft `invalidSettings` passes: a field it would refuse throws, never goes as null. */
export function settingsFrom(draft: SettingsDraft): Settings {
  return Object.fromEntries(
    SETTING_FIELDS.map((field) => [field.name, asNumber(draft[field.name], field.rule)]),
  );
}

/** An empty field is null, never zero: "not decided" and "decided to be nothing" differ. */
function asNumber(typed: string, rule: NumberRule): number | null {
  const reading = readNumber(typed, rule);
  if (reading.kind === "number") return reading.value;
  if (reading.kind === "blank") return null;
  throw new Error("A setting the form refuses was about to be sent.");
}
