/**
 * The "how was this scored" tooltip on a drill-down row's attribute (PL-073), in plain lines.
 *
 * **Built only from what was served**: the catalog says what the attribute measures, the active
 * set says the goal, the method, its anchors and whether a missing figure blocks, and the row
 * says its source. Nothing is said that none of them states, and an attribute the set does not
 * score gets no tooltip at all.
 */

import {
  describeAnchors,
  describeGoal,
  describeValueType,
} from "../../format/criterionWords";
import { readableUnit } from "../../format/figure";

/** What the tooltip reads from a criterion, named structurally so `Criterion` satisfies it. */
export interface ScoringRule {
  is_scored?: boolean;
  goal?: "minimise" | "maximise" | "target_range";
  target_range_min?: number | null;
  target_range_max?: number | null;
  normalisation_method?: "fixed" | "percentile" | "as_is";
  scale_anchors?: readonly { input_value?: number; score?: number }[];
  blocks_if_missing?: boolean;
}

export interface MeasuredAttribute {
  value_type?: string;
  unit?: string | null;
}

export function howScored({
  criterion,
  attribute,
  source,
}: {
  criterion: ScoringRule | undefined;
  attribute: MeasuredAttribute | undefined;
  /** The row's source, already in words. */
  source: string;
}): string | null {
  if (criterion === undefined || criterion.is_scored === false) return null;

  const unit = attribute?.unit?.trim() ? readableUnit(attribute.unit.trim()) : null;
  const goal = describeGoal(
    criterion.goal,
    criterion.target_range_min,
    criterion.target_range_max,
  );
  const lines = [
    describeValueType(attribute?.value_type, unit),
    goal === "" ? "" : `Goal: ${goal}`,
    methodLine(criterion),
    `Source: ${source}`,
    criterion.blocks_if_missing === true
      ? "Required: no score without it"
      : "Not required: when missing, its weight is spread over the attributes that have a figure",
  ];
  return lines
    .filter((line) => line !== "")
    .map((line) => `${line}.`)
    .join("\n");
}

function methodLine(criterion: ScoringRule): string {
  switch (criterion.normalisation_method) {
    case "fixed": {
      const anchors = describeAnchors(criterion.scale_anchors);
      return anchors === ""
        ? "Scored against fixed anchors, none set yet"
        : `Scored against fixed anchors: ${anchors}`;
    }
    case "percentile":
      return "Scored by percentile";
    case "as_is":
      return "Used as published";
    default:
      return "";
  }
}
