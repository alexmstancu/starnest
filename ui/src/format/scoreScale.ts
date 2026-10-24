import { formatScore } from "./display";

/**
 * A score read against the scale it was computed on (PL-062).
 *
 * **The top of the range is a setting, not 100.** Every ranking, drill-down and comparison
 * carries the `score_scale_max` its scores are on -- the live setting, or the value a saved
 * ranking froze -- and anything drawn or labelled from a score reads that one. Shared by Rank
 * and Compare, which is why it sits here rather than under either screen.
 *
 * **Without a scale nothing is drawn**: the score still prints as the server sent it, and the
 * bar it would fill is left out, because a length measured against a guessed top is a claim
 * nobody made.
 */

/** The range a score is on, "0–150", or nothing when no scale came with it. */
export function scoreRange(scaleMax: number | null | undefined): string {
  return isScale(scaleMax) ? `0–${formatScore(scaleMax)}` : "";
}

/** How much of its scale a score fills, 0 to 1, or null when either is missing. */
export function scoreShare(
  score: number | null | undefined,
  scaleMax: number | null | undefined,
): number | null {
  if (!isScale(scaleMax) || typeof score !== "number" || !Number.isFinite(score)) {
    return null;
  }
  return Math.min(1, Math.max(0, score / scaleMax));
}

/** A score's track as a width, "85.3%", never past "100%"; null when there is none to draw. */
export function scoreTrackWidth(
  score: number | null | undefined,
  scaleMax: number | null | undefined,
): string | null {
  const share = scoreShare(score, scaleMax);
  return share === null ? null : `${Number((share * 100).toFixed(1))}%`;
}

/** Whether a response carried a scale a score can be read against. */
export function isScale(scaleMax: number | null | undefined): scaleMax is number {
  return typeof scaleMax === "number" && Number.isFinite(scaleMax) && scaleMax > 0;
}
