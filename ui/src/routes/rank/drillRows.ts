/**
 * The drill-down's rows, in the order a reader meets them (PL-068, PL-071, PL-074; M6).
 *
 * **Two server reads, one list.** `/values` says what is stored, in the server's order; the
 * ranked detail's `attribute_scores` says which attributes this set scores, under which pillar.
 * A scored attribute with no value in use is not left out -- it gets a row of its own naming it,
 * because a count of what is missing sends the reader looking for which.
 *
 * **Ordered here, from server data, not in SQL** (N8): whether an attribute is descriptive
 * depends on the set, and the acquisition diff depends on the server's order within an
 * attribute, which is kept.
 */

import type { StoredValue } from "../../api/endpoints";
import { attributeName } from "../../format/display";
import { foldRepeats, type RepeatedValue } from "./repeatedValues";

/** Why a scored attribute has no value in use. */
export type MissingWhy =
  | "nothing_stored"
  | "rejected"
  | "switched_off"
  | "rejected_or_switched_off"
  | "not_in_use";

export type DrillRow =
  | { kind: "figure"; attribute: string; scored: boolean; repeated: RepeatedValue }
  | { kind: "missing"; attribute: string; scored: true; why: MissingWhy };

export interface ScoredAttribute {
  attribute: string;
  pillar: string;
}

export function drillRows(input: {
  /** `/values`, in the server's order. */
  values: readonly StoredValue[];
  /** The ranked detail's `attribute_scores`; null while pending or after a failure. */
  scores: readonly ScoredAttribute[] | null;
  /** Each pillar's `display_order`, from `/pillars`. */
  pillarOrder: ReadonlyMap<string, number>;
  /** Each attribute's catalog name. */
  names: ReadonlyMap<string, string>;
  chosenPillar: string | null;
}): DrillRow[] {
  const { values, scores, pillarOrder, names, chosenPillar } = input;
  const figures = figuresByAttribute(values);
  const byName = (left: string, right: string) =>
    attributeName(names, left).localeCompare(attributeName(names, right));

  // **Nothing is guessed while the scoring is unknown**: no gap rows, no pillar, no filter.
  if (scores === null) {
    return [...figures.keys()]
      .sort(byName)
      .flatMap((attribute) => figureRows(attribute, false, figures));
  }

  const pillarOf = new Map(scores.map((each) => [each.attribute, each.pillar]));
  const descriptive =
    chosenPillar === null
      ? [...figures.keys()].filter((attribute) => !pillarOf.has(attribute)).sort(byName)
      : [];
  const rankOf = (attribute: string) =>
    pillarOrder.get(pillarOf.get(attribute) ?? "") ?? Number.POSITIVE_INFINITY;
  const counted = [...pillarOf.keys()]
    .filter((attribute) => chosenPillar === null || pillarOf.get(attribute) === chosenPillar)
    .sort((left, right) => rankOf(left) - rankOf(right) || byName(left, right));

  return [
    ...descriptive.flatMap((attribute) => figureRows(attribute, false, figures)),
    ...counted.flatMap((attribute) => [
      ...gapRow(attribute, figures.get(attribute) ?? []),
      ...figureRows(attribute, true, figures),
    ]),
  ];
}

function figuresByAttribute(
  values: readonly StoredValue[],
): Map<string, StoredValue[]> {
  const grouped = new Map<string, StoredValue[]>();
  for (const value of values) {
    const group = grouped.get(value.attribute);
    if (group === undefined) grouped.set(value.attribute, [value]);
    else group.push(value);
  }
  return grouped;
}

function figureRows(
  attribute: string,
  scored: boolean,
  figures: ReadonlyMap<string, StoredValue[]>,
): DrillRow[] {
  return foldRepeats(figures.get(attribute) ?? []).map((repeated) => ({
    kind: "figure",
    attribute,
    scored,
    repeated,
  }));
}

function gapRow(attribute: string, stored: readonly StoredValue[]): DrillRow[] {
  if (stored.some((each) => each.is_active)) return [];
  return [{ kind: "missing", attribute, scored: true, why: whyMissing(stored) }];
}

function whyMissing(stored: readonly StoredValue[]): MissingWhy {
  if (stored.length === 0) return "nothing_stored";
  const rejected = (each: StoredValue) => Boolean(each.rejection_reason);
  const switchedOff = (each: StoredValue) => each.source_is_enabled === false;
  if (stored.every(rejected)) return "rejected";
  if (stored.every(switchedOff)) return "switched_off";
  if (stored.every((each) => rejected(each) || switchedOff(each))) {
    return "rejected_or_switched_off";
  }
  return "not_in_use";
}
