import { useCallback } from "react";
import { fetchHousehold } from "../../api/endpoints";
import { hasErrorCode } from "../../api/ApiError";
import { useRead } from "../../api/useRead";
import type { HomeRead } from "./rankTable";

/**
 * Which candidate the household lives in, for the pill beside its name and the note under the
 * Δ home column. Its own read: a ranking says what a candidate scored, never who lives there.
 *
 * **Shared by the live ranking and a saved one**, because both take Δ home against the
 * household's current home -- a saved ranking does not record one.
 *
 * **Unknown until it is read, and unknown if it failed**: no row is marked home and nothing is
 * said about the column, which claims nothing. Only the server's answer that no household is
 * recorded is a fact here; the sidebar's household card says when the read failed.
 */
export function useHome(): HomeRead {
  const { read } = useRead(
    useCallback((signal: AbortSignal) => fetchHousehold({ signal }), []),
  );
  if (read.state === "ready") return { state: "ready", household: read.data };
  if (read.state === "failed" && hasErrorCode(read.error, "household_not_configured")) {
    return { state: "not_configured" };
  }
  return { state: "unknown" };
}
