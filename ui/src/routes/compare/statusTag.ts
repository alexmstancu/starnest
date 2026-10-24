/**
 * What Compare says about a candidate that is not matching, or cannot be scored (PL-095).
 *
 * **Status belongs to the evaluation**, and a comparison carries each side's: a candidate that
 * fails a gate keeps its score and its column, so without a tag it read exactly like one that
 * matches. A matching candidate carries no tag, because the tag is the exception.
 */

import { formatMatchStatus } from "../../format/display";

/** The fields of a candidate's result a tag reads. */
export interface HasStatus {
  match_status: string;
  insufficient_reason?: string | null;
  non_match_reasons?: readonly { reason_detail?: string | null }[] | null;
}

export interface StatusTag {
  /** The status as the server names it, which the chip's colour is keyed on. */
  status: string;
  label: string;
  /** Why, in the server's words, or null where it gave none. */
  reason: string | null;
}

export function statusTag(result: HasStatus): StatusTag | null {
  if (result.match_status === "matching") return null;
  // **Two kinds of reason, never mixed** (as on Rank): why a scored candidate does not match,
  // and why one could not be scored at all.
  const reasons = (result.non_match_reasons ?? [])
    .map((each) => each.reason_detail ?? "")
    .filter((detail) => detail !== "");
  const reason = reasons.length > 0 ? reasons.join(" ") : (result.insufficient_reason ?? null);
  return {
    status: result.match_status,
    label: formatMatchStatus(result.match_status),
    reason: reason === "" ? null : reason,
  };
}
