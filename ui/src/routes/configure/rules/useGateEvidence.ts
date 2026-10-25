/**
 * What the rules panel's cost lines are read from, beside the rules themselves (PL-156, PL-164):
 * the live ranking, the household's citizenships, and whether the roster has placed the answers.
 *
 * **Keyed on everything that moves them.** The ranking is read again when this set's rules
 * change, when a gate answer is written, and when the household, the settings or a source is
 * saved anywhere on the screen (`rankingInputs`) -- so a citizenship edit moves the lines at once
 * rather than when Configure is next opened.
 */

import { useCallback } from "react";
import { hasErrorCode } from "../../../api/ApiError";
import { fetchHousehold, fetchRanking, type Ranking } from "../../../api/endpoints";
import { useRankingInputsVersion } from "../../../api/rankingInputs";
import type { Idle, Read } from "../../../api/read";
import { useCandidateRosterState } from "../../../api/useCandidateRoster";
import { useRead } from "../../../api/useRead";
import type { HeldCitizenships } from "./ruleEffect";

export interface GateEvidence {
  ranking: Read<Ranking> | Idle;
  reloadRanking: () => Promise<void>;
  held: HeldCitizenships;
  /** While the roster is on its way, which answers are at this level is not known (PL-151). */
  rosterReading: boolean;
}

export function useGateEvidence(
  criteriaSetId: string,
  levelId: string,
  /**
   * Changes whenever a rule's switch or outcome does, in words: what the ranking depends on.
   * Null while the rules are still being read, and the ranking waits for them.
   */
  rulesInForce: string | null,
  answersFreshness: number,
): GateEvidence {
  const inputs = useRankingInputsVersion();
  const ranking = useRead(
    useCallback(
      (signal: AbortSignal) => fetchRanking(criteriaSetId, levelId, { signal }),
      [criteriaSetId, levelId],
    ),
    // A number that changes with any of the three, so the ranking is read again in place,
    // keeping the last one on screen until the new one lands.
    {
      enabled: rulesInForce !== null,
      freshness: hashOf(`${rulesInForce}|${answersFreshness}|${inputs}`),
    },
  );
  const household = useRead(
    useCallback((signal: AbortSignal) => fetchHousehold({ signal }), []),
    { freshness: inputs },
  );
  const roster = useCandidateRosterState();

  return {
    ranking: ranking.read,
    reloadRanking: ranking.reload,
    held: heldFrom(household.read),
    rosterReading: roster.status === "loading",
  };
}

function heldFrom(read: Read<{ citizenships: string[] }> | Idle): HeldCitizenships {
  if (read.state === "ready") return { state: "held", citizenships: read.data.citizenships };
  if (read.state === "failed") {
    return hasErrorCode(read.error, "household_not_configured")
      ? { state: "no-household" }
      : { state: "failed" };
  }
  return { state: "reading" };
}

/** A string's 32-bit hash: distinct keys give distinct numbers for all practical purposes. */
function hashOf(key: string): number {
  let hash = 0;
  for (let at = 0; at < key.length; at += 1) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(at)) | 0;
  }
  return hash;
}
