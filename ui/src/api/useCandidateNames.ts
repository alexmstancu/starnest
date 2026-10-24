/**
 * What to call each candidate, by id.
 *
 * **The catalog's name, never the id.** The design states it as a rule -- "No programmatic
 * identifiers in rendered text". A screen printing `country.malta` is showing a key to someone
 * who never chose one, when "Malta" was a row away -- and the ranking table proves the name is
 * there, because it has been printing it all along from the same catalog.
 *
 * **A failure is silence, not a refusal.** What this feeds is a label; the figures, scores and
 * provenance beside it do not depend on it. An empty map makes every candidate fall back to
 * its id made readable, which is no worse than what the screens showed before this existed.
 *
 * Deliberately the same shape as `usePillarNames`, down to the shared promise and the
 * presentation living in `format/`: `api/` is the port to the contract and may not import
 * `format/`. This file fetches; `candidateName` names.
 */

import { useCallback, useMemo } from "react";
import { type Candidate, fetchCandidates } from "./endpoints";
import { useRead } from "./useRead";

export type CandidateNames = ReadonlyMap<string, string>;

/**
 * The names once, shared by every caller on the page.
 *
 * **Every level, fetched without narrowing**, for the reason the attribute map gives: an id
 * carries its own level, and a map holding one would fall back to the id for the other
 * silently. Thirty-two rows at country level, and only a migration can change them.
 */
let theRoster: Promise<readonly Candidate[]> | null = null;

function readThem(signal: AbortSignal): Promise<readonly Candidate[]> {
  // **The signal is not passed on.** The request is shared, so one component unmounting must
  // not cancel it for the others still waiting.
  void signal;
  theRoster ??= fetchCandidates()
    .then((answer) => answer.items as readonly Candidate[])
    .catch((failure: unknown) => {
      // **A failure is not remembered**, or one bad moment would outlast the session.
      theRoster = null;
      throw failure;
    });
  return theRoster;
}

/** Only for tests: forget what was fetched, so each one starts from nothing. */
export function forgetCandidateNames(): void {
  theRoster = null;
}

const NONE: CandidateNames = new Map();
const NOBODY: readonly Candidate[] = [];

export function useCandidateNames(): CandidateNames {
  const roster = useCandidateRoster();
  return useMemo(
    () =>
      roster.length === 0
        ? NONE
        : (new Map(
            roster.map((candidate) => [candidate.id, candidate.name]),
          ) as CandidateNames),
    [roster],
  );
}

/**
 * The candidates themselves, not just their names.
 *
 * **The same request, shared.** A screen offering a country to choose from needs the id, the
 * name and the level; a screen printing a stored value needs only the name. Fetching twice for
 * one list of 32 rows would be two requests for one answer, and the two could disagree while
 * both were in flight.
 */
export function useCandidateRoster(): readonly Candidate[] {
  return useCandidateRosterState().roster;
}

export interface CandidateRosterState {
  /** Empty until the list has arrived, and empty if it failed. */
  roster: readonly Candidate[];
  status: "loading" | "ready" | "error";
  error: unknown;
  /** Asks again. A failure is never remembered, so this is a real second request. */
  reload: () => void;
}

/**
 * The roster with what a picker needs to say about it: whether it is still coming, and why it
 * never came (UI-27).
 *
 * **A label can be silent about a failure; a picker cannot.** A name falls back to the id made
 * readable, but a required field offering nothing reads as a database with no places in it, so
 * a screen choosing from the roster reads this and says which it is.
 */
export function useCandidateRosterState(): CandidateRosterState {
  const { read, reload } = useRead(useCallback((signal: AbortSignal) => readThem(signal), []));
  // `void`, as the callers' Try again buttons expect; stable, as `reload` is.
  const askAgain = useCallback(() => void reload(), [reload]);
  return {
    // One empty array, not a new one each render, or every consumer re-renders while it loads.
    roster: read.state === "ready" ? read.data : NOBODY,
    status: read.state === "ready" ? "ready" : read.state === "failed" ? "error" : "loading",
    error: read.state === "failed" ? read.error : null,
    reload: askAgain,
  };
}
