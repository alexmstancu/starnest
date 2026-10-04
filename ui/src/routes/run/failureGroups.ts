/**
 * What went wrong in a run, as problems rather than as lines.
 *
 * **One message repeated is one problem.** A run that asked the LLM about 32 countries with no
 * credit left on the key fails 32 times with the same sentence, and a table with a row for each
 * of them is thirty-two three-line paragraphs saying one thing -- which is the complaint this
 * module exists to answer. So a source and a message together make one group, carrying a count,
 * and the items it happened to wait behind a disclosure.
 *
 * **Grouped by source, because a source is what a remedy addresses.** `POST /{runId}/retry`
 * asks the sources that failed about what they failed on, and the card beside this list scopes
 * a narrower run by source -- so a reader deciding what to do about a failure is deciding about
 * a source, and a source's groups stay together.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number` and friends, so the counting
 * and the shortening live here and the component renders what it is given.
 */

import { oneLine, readableMessage } from "./itemNames";

/** One failure as `RunDetail.failures` reports it. */
export interface RunFailure {
  data_source?: string | null;
  candidate?: string | null;
  attribute?: string | null;
  error_message?: string | null;
}

/** What a failure happened to. Neither half identifies it alone. */
export interface FailedItem {
  candidate: string;
  attribute: string;
}

/** One distinct complaint: a source, the message it gave, and every item it gave it about. */
export interface FailureGroup {
  /** The source and the message together, which is what makes this group one problem. */
  key: string;
  source: string;
  /** The message exactly as the server wrote it, for the reader who opens the group. */
  message: string;
  /** The sentence worth reading, shortened to one line, for the collapsed row. */
  headline: string;
  /** "32 items". Counted here, because the markup may not count. */
  tally: string;
  items: FailedItem[];
}

/** A failure whose source the run did not name still has to be shown, not dropped. */
const UNNAMED = "unnamed";

const NO_MESSAGE = "The source failed without saying why.";

export function failureGroups(
  failures: readonly RunFailure[] | null | undefined,
): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();

  for (const failure of failures ?? []) {
    const source = oneLine(failure.data_source) || UNNAMED;
    const message = oneLine(failure.error_message) || NO_MESSAGE;
    // A separator a message cannot contain, so two different pairs can never collide on one
    // key -- and a collision here would merge two problems into one count.
    const key = `${source}\u0000${message}`;
    const existing = groups.get(key);
    const item = {
      candidate: oneLine(failure.candidate) || UNNAMED,
      attribute: oneLine(failure.attribute) || UNNAMED,
    };
    if (existing === undefined) {
      groups.set(key, {
        key,
        source,
        message,
        headline: readableMessage(message),
        tally: "",
        items: [item],
      });
    } else {
      existing.items.push(item);
    }
  }

  const counted = [...groups.values()].map((group) => ({
    ...group,
    tally: plural(group.items.length, "item"),
    items: [...group.items].sort(byCandidateThenAttribute),
  }));

  return counted.sort(worstFirst(totalPerSource(counted)));
}

/**
 * The line above the list: how many failures, how many sources, and how many things are
 * actually wrong.
 *
 * **The third count is the one that answers the complaint.** "32 failures" reads as thirty-two
 * problems; "32 failures, 1 distinct message" says in four words that it is one problem with a
 * wide blast radius, which is a thing a reader can act on.
 */
export function describeFailures(
  failures: readonly RunFailure[] | null | undefined,
): string {
  const groups = failureGroups(failures);
  if (groups.length === 0) return "Nothing failed in this acquisition.";

  const items = groups.reduce((total, group) => total + group.items.length, 0);
  const sources = new Set(groups.map((group) => group.source)).size;
  return (
    `${plural(items, "failure")} from ${plural(sources, "source")}, ` +
    `${plural(groups.length, "distinct message")}. ` +
    "The same message repeated is one problem, so each is listed once with what it hit."
  );
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function totalPerSource(groups: readonly FailureGroup[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const group of groups) {
    totals.set(
      group.source,
      (totals.get(group.source) ?? 0) + group.items.length,
    );
  }
  return totals;
}

/**
 * The source that failed most, first, and its groups kept together.
 *
 * **Sorted, not served in arrival order.** The order a run happens to report its failures in is
 * the order the sources were asked, which is an implementation detail of the acquisition loop;
 * a reader wants the biggest thing wrong at the top, and wants it in the same place on the next
 * read.
 */
function worstFirst(
  totals: Map<string, number>,
): (left: FailureGroup, right: FailureGroup) => number {
  return (left, right) => {
    if (left.source !== right.source) {
      const bySize =
        (totals.get(right.source) ?? 0) - (totals.get(left.source) ?? 0);
      return bySize === 0 ? left.source.localeCompare(right.source) : bySize;
    }
    const byCount = right.items.length - left.items.length;
    return byCount === 0 ? left.message.localeCompare(right.message) : byCount;
  };
}

function byCandidateThenAttribute(left: FailedItem, right: FailedItem): number {
  const byCandidate = left.candidate.localeCompare(right.candidate);
  return byCandidate === 0
    ? left.attribute.localeCompare(right.attribute)
    : byCandidate;
}
