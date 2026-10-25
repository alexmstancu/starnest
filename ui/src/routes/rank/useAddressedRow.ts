import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Ranking } from "../../api/endpoints";
import { drillDownAsked, withoutDrillDown } from "../../navigation/drillDown";
import { useSelection } from "../../shell/SelectionContext";

/**
 * What an address asked Rank to open and could not, kept to be said once the request is
 * taken out of the address.
 */
export type AddressNotice =
  | { kind: "candidate"; candidate: string }
  | { kind: "pillar"; name: string }
  | { kind: "level" };

/**
 * Opens the candidate and pillar the address names (PL-084), once the ranking it names is here.
 *
 * **The address is the request until it is applied**, and only then taken out: the selection
 * resolves after the first render and re-keys the ranking, so a request read into the first
 * ranking's state would be lost with it. A ranking still being read, refused or failed applies
 * nothing and keeps the request, which its Try again then applies.
 */
export function useAddressedRow(
  ranking: Ranking | null,
  openAt: (candidate: string, pillar: string | null) => void,
): { notice: AddressNotice | null; arrivedAt: string | null; arrived: () => void } {
  const [parameters, setParameters] = useSearchParams();
  const asked = drillDownAsked(`?${parameters.toString()}`);
  const { read, levels, levelId, selectLevel } = useSelection();
  const [landing, setLanding] = useState<Landing>(NOWHERE);

  const candidate = asked?.candidate ?? null;
  const pillar = asked?.pillar ?? null;
  const level = asked?.level ?? null;
  useEffect(() => {
    if (candidate === null || read.state !== "ready") return;
    // Taken out of the address only together with what it came to, never before.
    const land = (next: Landing) => {
      setParameters(withoutDrillDown(parameters.toString()), { replace: true });
      setLanding(next);
    };
    if (level !== null && level !== levelId) {
      if (levels.some((each) => each.id === level)) selectLevel(level);
      else land({ notice: { kind: "level" }, arrivedAt: null });
      return;
    }
    if (ranking === null || (level !== null && ranking.level !== level)) return;
    const row = ranking.candidates.find((each) => each.candidate === candidate);
    if (row === undefined) {
      land({ notice: { kind: "candidate", candidate }, arrivedAt: null });
      return;
    }
    const scored = pillar !== null && (row.pillar_scores ?? []).some((each) => each.pillar === pillar);
    openAt(row.candidate, scored ? pillar : null);
    land({
      notice: pillar !== null && !scored ? { kind: "pillar", name: row.name } : null,
      arrivedAt: row.candidate,
    });
  }, [candidate, pillar, level, read.state, levelId, levels, selectLevel, ranking, openAt, parameters, setParameters]);

  return {
    notice: landing.notice,
    arrivedAt: landing.arrivedAt,
    arrived: () => setLanding((now) => ({ ...now, arrivedAt: null })),
  };
}

interface Landing {
  notice: AddressNotice | null;
  arrivedAt: string | null;
}

const NOWHERE: Landing = { notice: null, arrivedAt: null };

/** The notice in words, naming the candidate by the roster's name where it has one. */
export function addressNoticeWords(
  notice: AddressNotice,
  roster: ReadonlyMap<string, string>,
): string {
  switch (notice.kind) {
    case "level":
      return "The address names a level that does not exist, so nothing was opened.";
    case "pillar":
      return `The address names a pillar ${notice.name} is not scored on here, so every pillar of ${notice.name} is shown.`;
    case "candidate": {
      const name = roster.get(notice.candidate);
      return name === undefined
        ? "The address names a candidate this ranking does not hold, so nothing was opened."
        : `${name} is not in this ranking, so there is no evidence of it to open.`;
    }
  }
}
