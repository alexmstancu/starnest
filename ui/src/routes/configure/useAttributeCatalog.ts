import { useCallback, useMemo } from "react";
import { fetchAttributes, type Attribute } from "../../api/endpoints";
import type { Idle, Read } from "../../api/read";
import { useRead } from "../../api/useRead";
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
 * **A failure is said, not silent** (PL-014). The absence of a "No source yet" chip is itself a
 * claim that the attribute has a source, so `catalog` is empty until the read is ready -- no
 * row is drawn as sourced or unsourced -- and `read` lets stage 3 say why, with Try again.
 */
export interface AttributeCatalogRead {
  /** By attribute id; empty unless the read is ready. */
  catalog: AttributeCatalog;
  /** Every attribute at the level, as read; empty unless the read is ready. */
  attributes: readonly Attribute[];
  read: Read<AttributeCatalog> | Idle;
  reload: () => Promise<void>;
}

export function useAttributeCatalog(levelId: string | null): AttributeCatalogRead {
  const { read, reload } = useRead(
    useCallback(
      // Not reachable while disabled; the empty string keeps the type honest.
      (signal: AbortSignal) => fetchAttributes(levelId ?? "", { signal }),
      [levelId],
    ),
    { enabled: levelId !== null },
  );

  const items = read.state === "ready" ? read.data.items : NO_ATTRIBUTES;
  const catalog = useMemo(
    () => (items === NO_ATTRIBUTES ? NOTHING_YET : catalogOf(items)),
    [items],
  );
  const catalogRead = useMemo(
    (): Read<AttributeCatalog> | Idle =>
      read.state === "ready" ? { ...read, data: catalog } : read,
    [read, catalog],
  );

  return { catalog, attributes: items, read: catalogRead, reload };
}

const NO_ATTRIBUTES: readonly Attribute[] = [];
/** One shared empty map, so a screen waiting on the catalog does not re-render on its own. */
const NOTHING_YET: AttributeCatalog = new Map();
