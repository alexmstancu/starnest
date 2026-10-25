/**
 * What a rule is actually costing you, in the candidates it acts on.
 *
 * A switch that says only "enforced" makes a reader guess whether it matters. `reqs.md` 5.4
 * keeps a non-matching candidate visible with its score, precisely so the cost of a gate is
 * legible -- and the same reasoning applies to the switch itself: turning one on should say
 * what it did.
 */

import type { Idle, Read } from "../../../api/read";
import type { Ranking, RuleOutcome } from "../../../api/endpoints";

/**
 * What a rule's sentence reports, which is what colours it (PL-156): red only for a rule that
 * removes someone, amber for one that flags, and plain when it costs nothing or is not known.
 */
export type EffectTone = "removes" | "flags" | "nothing" | "unknown";

export interface RuleEffect {
  readonly sentence: string;
  readonly tone: EffectTone;
}

export interface RuleResult {
  match_rule: string;
  candidate: string;
  match_result: string;
  /** A model's answer nobody has confirmed, which rules nothing out (Q218). */
  is_proposal?: boolean;
}

const REMOVES = "not_matching";

/**
 * The answers about candidates at this level (PL-151): the answers are read for every level,
 * and a gate's sentence must not count a city at country level. A candidate's level is the
 * roster's to say, never read off its id, and **one the roster does not place is kept**, so a
 * roster that could not be read hides nothing.
 */
export function answersAtLevel<Answer extends RuleResult>(
  answers: readonly Answer[],
  roster: readonly { id: string; level: string }[],
  level: string,
): Answer[] {
  const levelOf = new Map(roster.map((candidate) => [candidate.id, candidate.level]));
  return answers.filter((answer) => {
    const placed = levelOf.get(answer.candidate);
    return placed === undefined || placed === level;
  });
}

/**
 * The sentence beside one gate, from its recorded answers.
 *
 * **An unenforced rule states what it *would* do**, followed by the fact that it is not doing
 * it. A gate answered for nobody says so rather than staying silent: "no answers recorded" and
 * "answered, and rules nobody out" are different facts, and a blank would merge them. **The verb
 * is the set's outcome** (D56): a gate held as a warning flags whom it would otherwise remove.
 */
export function describeEffect(
  ruleId: string,
  results: readonly RuleResult[],
  options: {
    enforced: boolean;
    outcome?: RuleOutcome;
    /** The level's candidates, in the singular: "country". */
    level: string;
    nameOf?: (candidate: string) => string;
  },
): RuleEffect {
  const mine = results.filter((result) => result.match_rule === ruleId);
  if (mine.length === 0) {
    return offWhen(!options.enforced, {
      sentence: "No answer has been recorded for this rule, so it never fires.",
      tone: "nothing",
    });
  }

  // **Only a confirmed answer acts** (UI-12, Q218). A proposal is a model's reading that nobody
  // has checked, and the ranking ignores it, so it is mentioned apart and never as a removal.
  const confirmed = mine.filter((result) => result.is_proposal !== true);
  const proposed = mine.length - confirmed.length;
  const failing = confirmed
    .filter((result) => result.match_result === REMOVES)
    .map((result) => (options.nameOf ?? identity)(result.candidate))
    .sort();
  const flags = options.outcome === "warning";

  const decided =
    failing.length === 0
      ? `Answered for ${confirmed.length === 1 ? "one candidate" : `${confirmed.length} candidates`}, and rules nobody out.`
      : `${flags ? "Flags" : "Removes"} ${list(failing, options.level)}.`;
  const sentence =
    confirmed.length === 0
      ? `${awaiting(proposed)} confirmation, so this rules nobody out yet.`
      : proposed === 0
        ? decided
        : `${decided} ${awaiting(proposed)} confirmation and ${proposed === 1 ? "rules" : "rule"} nobody out until then.`;
  const tone: EffectTone = failing.length === 0 ? "nothing" : flags ? "flags" : "removes";
  return offWhen(!options.enforced, { sentence, tone });
}

/**
 * The design's phrasing for a rule that is off: what it would do, then "-- not while this is
 * off". Saying "not enforced" alone would leave the reader to work out what turning it on costs.
 */
function offWhen(off: boolean, effect: RuleEffect): RuleEffect {
  return off
    ? { ...effect, sentence: `${effect.sentence.replace(/\.$/, "")} — not while this is off.` }
    : effect;
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
): RuleEffect {
  return {
    sentence:
      status === "error"
        ? "The answers could not be read, so what this rule does is not known."
        : "Reading the answers…",
    tone: "unknown",
  };
}

/**
 * The sentence beside a compound rule, from the live ranking (PL-156).
 *
 * **Who it acts on is the ranking's to say**, because a compound rule reads figures and the
 * household rather than a recorded answer: the candidates whose warnings or reasons for not
 * matching name this rule are exactly the ones it flags or removes. A rule that is off is not
 * evaluated, so nothing says whom it would flag, and the sentence does not guess.
 */
export function describeCompoundEffect(
  ruleId: string,
  options: {
    applied: boolean;
    outcome: RuleOutcome;
    ranking: Read<Ranking> | Idle;
    /** The level's candidates, in the singular: "country". */
    level: string;
  },
): RuleEffect {
  if (!options.applied) {
    const verb = options.outcome === "warning" ? "flags" : "removes";
    return { sentence: `Not applied, so it ${verb} nobody.`, tone: "nothing" };
  }
  const { ranking } = options;
  if (ranking.state === "failed") {
    return {
      sentence: "The ranking could not be read, so whom this rule acts on is not known.",
      tone: "unknown",
    };
  }
  if (ranking.state !== "ready") return { sentence: "Reading the ranking…", tone: "unknown" };

  const results = ranking.data.candidates;
  const removed = results
    .filter((each) => (each.non_match_reasons ?? []).some((reason) => reason.compound_rule === ruleId))
    .map((each) => each.name)
    .sort();
  const flagged = results
    .filter((each) => (each.warnings ?? []).some((warning) => warning.compound_rule === ruleId))
    .map((each) => each.name)
    .sort();
  if (removed.length === 0 && flagged.length === 0) {
    return { sentence: `Applies to no ${options.level} right now.`, tone: "nothing" };
  }
  const sentences = [
    removed.length > 0 ? `Removes ${list(removed, options.level)}.` : "",
    flagged.length > 0 ? `Flags ${list(flagged, options.level)}.` : "",
  ];
  return {
    sentence: sentences.filter(Boolean).join(" "),
    tone: removed.length > 0 ? "removes" : "flags",
  };
}

/**
 * One name, or a count of the level's candidates and up to three names -- "3 countries:
 * Bulgaria, Hungary and Romania" -- a sentence, never a list of ids running off the row.
 */
function list(names: readonly string[], level: string): string {
  if (names.length === 1) return names[0] ?? "";
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const named =
    more > 0
      ? `${shown.join(", ")} and ${more} more`
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `${names.length} ${plural(level)}: ${named}`;
}

/** A level is named by its id, a noun in the singular: "country", "city". */
function plural(level: string): string {
  return /[^aeiou]y$/.test(level) ? `${level.slice(0, -1)}ies` : `${level}s`;
}
