/**
 * What a rule is actually costing you, in the candidates it acts on.
 *
 * A switch that says only "enforced" makes a reader guess whether it matters. `reqs.md` 5.4
 * keeps a non-matching candidate visible with its score, precisely so the cost of a gate is
 * legible -- and the same reasoning applies to the switch itself: turning one on should say
 * what it did.
 */

export interface RuleResult {
  match_rule: string;
  candidate: string;
  match_result: string;
}

const REMOVES = "not_matching";

/**
 * The sentence beside one rule.
 *
 * **An unenforced rule states what it *would* do**, followed by the fact that it is not doing
 * it. A gate answered for nobody says so rather than staying silent: "no answers recorded" and
 * "answered, and rules nobody out" are different facts, and a blank would merge them.
 */
export function describeEffect(
  ruleId: string,
  results: readonly RuleResult[],
  options: { enforced: boolean; nameOf?: (candidate: string) => string },
): string {
  const mine = results.filter((result) => result.match_rule === ruleId);
  if (mine.length === 0) {
    return "No answer has been recorded for this rule, so it never fires.";
  }

  const removed = mine
    .filter((result) => result.match_result === REMOVES)
    .map((result) => (options.nameOf ?? identity)(result.candidate))
    .sort();

  const effect =
    removed.length === 0
      ? `Answered for ${mine.length === 1 ? "one candidate" : `${mine.length} candidates`}, and rules nobody out.`
      : `Removes ${list(removed)}.`;

  // The design's phrasing: the effect first, then the fact that it is switched off. Saying
  // "not enforced" alone would leave the reader to work out what turning it on would cost.
  return options.enforced ? effect : `${effect} Not while this is off.`;
}

function identity(candidate: string): string {
  return candidate;
}

/** Up to three named, then a count -- a sentence, never a list of ids running off the row. */
function list(names: readonly string[]): string {
  if (names.length === 1) return names[0] ?? "";
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.length} candidates: ${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}
