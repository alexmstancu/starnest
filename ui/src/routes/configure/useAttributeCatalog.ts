import { useCallback, useMemo } from "react";
import { fetchAttributes } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { catalogOf, type AttributeCatalog } from "./criteria/criterionReading";

/**
 * The catalog at one level, for the rows that show what an attribute is.
 *
 * **The objective half of the ontology, fetched once for the whole screen** (`reqs.md` 3.0).
 * A criterion says what the household wants of an attribute; it does not say what the
 * attribute measures or whether any source would answer it. That is the catalog's, and every
 * criterion row on the screen wants the same copy of it -- so it is read here rather than in
 * each opened pillar.
 *
 * **A failure is silence, not a refusal.** What this feeds is a type line and one chip; the
 * weights the stage exists to edit do not depend on it. An empty catalog makes the rows say
 * less, which is exactly what is true when it could not be read -- and `chipsFor` treats an
 * attribute it has no entry for as one it knows nothing about rather than one with no sources.
 */
export function useAttributeCatalog(levelId: string | null): AttributeCatalog {
  const { resource } = useResource(
    useCallback(
      // Not reachable while disabled; the empty string keeps the type honest.
      (signal: AbortSignal) => fetchAttributes(levelId ?? "", { signal }),
      [levelId],
    ),
    levelId !== null,
  );

  return useMemo(
    () => (resource.data === null ? NOTHING_YET : catalogOf(resource.data.items)),
    [resource.data],
  );
}

/** One shared empty map, so a screen waiting on the catalog does not re-render on its own. */
const NOTHING_YET: AttributeCatalog = new Map();
