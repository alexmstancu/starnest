import { isApiError } from "../api/ApiError";
import { presentError } from "../api/errorPresentation";
import { SCORE_SCALE_NOT_SET, remedyFor } from "./refusalRemedy";

/**
 * Whether a refusal is a setting nobody decided, which `UnsetSetting` draws, rather than a fault: a
 * screen that would show it in place of everything else asks first.
 */
export function isUnsetSetting(error: unknown): boolean {
  const { code } = presentError(error);
  const details = isApiError(error) ? error.details : undefined;
  return isUnsetState(code, details) && remedyFor(code, details) !== null;
}

/** A refusal that is a state a setting lifts, rather than a fault. */
export function isUnsetState(code: string, details: Readonly<Record<string, unknown>> = {}): boolean {
  if (code === "invalid_criterion") return details["reason"] === "anchor_above_scale";
  return UNSET_STATES.has(code);
}

const UNSET_STATES = new Set([SCORE_SCALE_NOT_SET, "comparator_limit_not_set", "cannot_be_ranked"]);
