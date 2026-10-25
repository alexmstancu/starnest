import { useCallback } from "react";
import { fetchHousehold } from "../../api/endpoints";
import { hasErrorCode } from "../../api/ApiError";
import { useResource } from "../../api/useResource";
import type { HomeRead } from "./rankTable";

/**
 * Which candidate the household lives in, for the pill beside its name and the note under the
 * Δ home column. Its own read: a ranking says what a candidate scored, never who lives there.
 *
 * **Shared by the live ranking and a saved one**, because both take Δ home against the
 * household's current home -- a saved ranking does not record one.
 */
export function useHome(): HomeRead {
  const household = useResource(
    useCallback((signal: AbortSignal) => fetchHousehold({ signal }), []),
  );
  if (household.resource.status === "ready") {
    return { state: "ready", household: household.resource.data };
  }
  if (
    household.resource.status === "error" &&
    hasErrorCode(household.resource.error, "household_not_configured")
  ) {
    return { state: "not_configured" };
  }
  return { state: "unknown" };
}
