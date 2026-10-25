/**
 * A run's status in words and in colour, for every place one appears (PL-122).
 *
 * **One map, so two places cannot disagree.** The card's pill, its heading, the history's chip
 * and the sidebar each used to word a status for themselves: one printed the wire's
 * `halted_by_user`, one replaced the underscores, one had no colour at all -- and a stop the
 * reader asked for looked exactly like a halt at the spend cap. They are different facts, and
 * the design keeps them apart: "halted by you" is neutral, "halted at the spend cap" is amber.
 *
 * **In `shell/`**, because the sidebar reads it and `shell/` may not import from `routes/`.
 */

import type { Run } from "../api/endpoints";

export type RunTone = "live" | "good" | "warn" | "bad" | "plain";

export interface RunStatusWords {
  /** The status as a word: the pill, the chip, the sidebar. */
  word: string;
  /** The status as the card's heading, which says what is happening to the run. */
  heading: string;
  tone: RunTone;
}

/**
 * Every status the contract names, and `stopping`, which no server sends: it is a running run
 * somebody has asked to stop, and the card says so in a word of its own (`runState`).
 */
export const RUN_STATUS_WORDS = {
  running: { word: "running", heading: "Acquiring now", tone: "live" },
  stopping: {
    word: "stopping",
    heading: "Stopping after the source in flight",
    tone: "warn",
  },
  completed: { word: "completed", heading: "Acquisition finished", tone: "good" },
  halted_by_user: { word: "halted by you", heading: "Stopped by you", tone: "plain" },
  halted_on_spend_cap: {
    word: "halted at the spend cap",
    heading: "Halted at the spend cap",
    tone: "warn",
  },
  // "Finished" over a run whose process was killed would be a plausible sentence that is false.
  failed: { word: "failed", heading: "Acquisition did not finish", tone: "bad" },
} as const satisfies Record<Run["run_status"] | "stopping", RunStatusWords>;

/** A status this client does not know: said as not known, never printed as the wire has it. */
const NOT_KNOWN: RunStatusWords = {
  word: "status not known",
  heading: "Acquisition",
  tone: "plain",
};

export function describeRunStatus(status: string | null | undefined): RunStatusWords {
  if (status === null || status === undefined || !Object.hasOwn(RUN_STATUS_WORDS, status)) {
    return NOT_KNOWN;
  }
  return RUN_STATUS_WORDS[status as keyof typeof RUN_STATUS_WORDS];
}
