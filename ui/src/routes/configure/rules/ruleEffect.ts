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
  /** A model's answer nobody has confirmed, which rules nothing out (Q218). */
  is_proposal?: boolean;
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

  // **Only a confirmed answer acts** (UI-12, Q218). A proposal is a model's reading that nobody
  // has checked, and the ranking ignores it, so it is mentioned apart and never as a removal.
  const confirmed = mine.filter((result) => result.is_proposal !== true);
  const proposed = mine.length - confirmed.length;
  const removed = confirmed
    .filter((result) => result.match_result === REMOVES)
    .map((result) => (options.nameOf ?? identity)(result.candidate))
    .sort();

  const decided =
    removed.length === 0
      ? `Answered for ${confirmed.length === 1 ? "one candidate" : `${confirmed.length} candidates`}, and rules nobody out.`
      : `Removes ${list(removed)}.`;
  const effect =
    confirmed.length === 0
      ? `${awaiting(proposed)} confirmation, so this rules nobody out yet.`
      : proposed === 0
        ? decided
        : `${decided} ${awaiting(proposed)} confirmation and ${proposed === 1 ? "rules" : "rule"} nobody out until then.`;

  // The design's phrasing: the effect first, then the fact that it is switched off. Saying
  // "not enforced" alone would leave the reader to work out what turning it on would cost.
  return options.enforced ? effect : `${effect} Not while this is off.`;
}

function identity(candidate: string): string {
  return candidate;
}

function awaiting(proposed: number): string {
  return proposed === 1
    ? "1 proposed answer awaits"
    : `${proposed} proposed answers await`;
}

/**
 * The sentence beside a gate while its answers have not been read: unknown, never "nothing".
 * "No answer has been recorded" while they are still on their way said a gate never fires.
 */
export function describeUnreadAnswers(
  status: "idle" | "loading" | "error",
): string {
  return status === "error"
    ? "The answers could not be read, so what this rule does is not known."
    : "Reading the answers…";
}

/**
 * The sentence beside a compound rule.
 *
 * **Who it flags is a ranking's to say**, because a compound rule reads figures and the household
 * rather than a recorded answer, and this screen reads no ranking. It points there rather than
 * saying "nobody", which is what every compound rule used to read, applied or not.
 */
export function describeCompoundEffect(applied: boolean): string {
  return applied
    ? "Applied. Who it flags right now is shown on Rank."
    : "Not applied, so it flags nobody.";
}

/** Up to three named, then a count -- a sentence, never a list of ids running off the row. */
function list(names: readonly string[]): string {
  if (names.length === 1) return names[0] ?? "";
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.length} candidates: ${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}
