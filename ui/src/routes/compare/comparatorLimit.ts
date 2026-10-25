/**
 * The comparator limit as Compare may act on it (PL-092).
 *
 * **Only a limit the settings can hold is a limit here**: a whole number from 1 to 20, the range
 * Configure accepts (PL-030). Anything else -- unset, still loading, nonsense -- is unknown, and
 * an unknown limit neither holds a chip nor trims a selection: guessing a bound would be this
 * screen inventing policy, and the server's refusal is the backstop.
 */
export const LOWEST_LIMIT = 1;
export const HIGHEST_LIMIT = 20;

export function knownLimit(limit: number | null | undefined): number | null {
  if (typeof limit !== "number" || !Number.isInteger(limit)) return null;
  return limit >= LOWEST_LIMIT && limit <= HIGHEST_LIMIT ? limit : null;
}
