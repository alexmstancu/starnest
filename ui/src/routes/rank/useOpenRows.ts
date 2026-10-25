import { useCallback } from "react";
import { isRecord } from "../../shell/sessionState";
import { useSessionState } from "../../shell/SessionProvider";
import { type OpenCandidate, type OpenRow, choosePillar, openAt, toggleRow } from "./openRows";

/**
 * Which candidates' evidence is open, and the pillar chosen in each (PL-016).
 *
 * **Kept above the routes**, so the open rows survive a visit to another tab, a reload and a
 * criteria-set switch (P1-20) -- and reset on a level change, where the candidates are others.
 * A remembered candidate the ranking no longer holds opens nothing, because only the ranking's
 * own rows draw a panel.
 */
export function useOpenRows() {
  const [open, setOpen] = useSessionState<readonly OpenRow[]>("rank/open", NONE, parseOpenRows);
  const toggle = useCallback(
    (row: OpenCandidate) => setOpen((already) => toggleRow(already, row)),
    [setOpen],
  );
  // **One handler for both ways in.** The chart in the row and the cards in the panel set the
  // same thing, so they call the same function -- which is what makes them agree rather than
  // two selections that happen to look alike.
  const choose = useCallback(
    (row: OpenCandidate, pillar: string) =>
      setOpen((already) => choosePillar(already, row, pillar)),
    [setOpen],
  );
  // An address's request (PL-084): opens, and never closes, so applying it twice is harmless.
  const openAtPillar = useCallback(
    (candidate: string, pillar: string | null) =>
      setOpen((already) => openAt(already, candidate, pillar)),
    [setOpen],
  );
  return { open, toggle, choose, openAt: openAtPillar };
}

const NONE: readonly OpenRow[] = [];

export function parseOpenRows(stored: unknown): OpenRow[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  return stored.flatMap((row: unknown): OpenRow[] => {
    if (!isRecord(row) || typeof row["candidate"] !== "string") return [];
    const pillar = row["chosenPillar"];
    return [{ candidate: row["candidate"], chosenPillar: typeof pillar === "string" ? pillar : null }];
  });
}
