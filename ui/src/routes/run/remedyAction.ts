import { formatCount } from "../../format/display";
import { pairsOf } from "./runScope";
import type { GapSelection } from "./useGapSelection";

/**
 * A remedy card's one action, named by what it would ask (PL-124): "Retry 12 failed" while
 * nothing is picked, "Retry 2 selected" once something is. **Counted in pairs**: an item two
 * sources failed on is listed under each, and is one item to retry.
 */
export function actionLabel(
  verb: string,
  held: number,
  noun: string,
  picks: Pick<GapSelection, "chosen">,
): string {
  const picked = pairsOf(picks.chosen).length;
  return picked > 0
    ? `${verb} ${formatCount(picked)} selected`
    : `${verb} ${formatCount(held)} ${noun}`;
}
