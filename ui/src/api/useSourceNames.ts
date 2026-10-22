/**
 * What to call each data source, by id (UIR-G3).
 *
 * **The catalog's name, never the id.** `answerable_by` and the source priority carry ids --
 * `world_bank`, `llm` -- and printing one put a programmatic identifier on screen where the
 * catalog says "World Bank" and "LLM with web search".
 *
 * **A failure is silence, not a refusal**, as for the pillar names: what this feeds is a label,
 * and the screen beside it does not depend on it. The caller decides what to say without one;
 * it must never fall back to the id.
 */

import { useCallback } from "react";
import { fetchDataSources } from "./endpoints";
import { useResource } from "./useResource";

export type SourceNames = ReadonlyMap<string, string>;

/**
 * The names once, shared by every caller on the page. The sources are catalog rows that change
 * only with a migration, and a migration means a restart, so there is nothing to invalidate.
 */
let theNames: Promise<SourceNames> | null = null;

function readThem(signal: AbortSignal): Promise<SourceNames> {
  // The request is shared: one component unmounting must not cancel it for the others.
  void signal;
  theNames ??= fetchDataSources()
    .then(
      (answer) =>
        new Map(answer.items.map((source) => [source.id, source.name])) as SourceNames,
    )
    .catch((failure: unknown) => {
      // A failure is not remembered: the next caller tries again.
      theNames = null;
      throw failure;
    });
  return theNames;
}

/** Only for tests: forget what was fetched, so each one starts from nothing. */
export function forgetSourceNames(): void {
  theNames = null;
}

const NONE: SourceNames = new Map();

export function useSourceNames(): SourceNames {
  const { resource } = useResource(
    useCallback((signal: AbortSignal) => readThem(signal), []),
  );
  return resource.status === "ready" ? resource.data : NONE;
}
