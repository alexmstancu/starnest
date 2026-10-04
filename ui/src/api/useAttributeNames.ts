/**
 * What to call each attribute, by id.
 *
 * **The catalog's name, never the id.** The design states it as a rule -- "No programmatic
 * identifiers in rendered text" -- and the database has held a name for every attribute since
 * migration `0101`. A screen printing `country.average_working_hours` is showing a key to
 * someone who never chose one, when "Average working hours" was a row away.
 *
 * **A failure is silence, not a refusal.** What this feeds is a label; the figures, scores and
 * provenance beside it do not depend on it. An empty map makes every attribute fall back to
 * its id made readable, which is no worse than what the screens showed before this existed.
 *
 * Deliberately the same shape as `usePillarNames`, down to the shared promise and the
 * presentation living in `format/`: `api/` is the port to the contract and may not import
 * `format/`. This file fetches; `attributeName` names.
 */

import { useCallback } from "react";
import { fetchAttributes } from "./endpoints";
import { useResource } from "./useResource";

export type AttributeNames = ReadonlyMap<string, string>;

/**
 * The names once, shared by every caller on the page.
 *
 * **Every level, fetched without narrowing.** An id carries its own level, and four screens
 * want the same answer; a map holding one level would fall back to the id for the other and
 * do it silently. It is a few dozen rows that only a migration can change, so one in-flight
 * promise kept for the life of the module is the whole of what a cache needs to be here.
 */
let theNames: Promise<AttributeNames> | null = null;

function readThem(signal: AbortSignal): Promise<AttributeNames> {
  // **The signal is not passed on.** The request is shared, so one component unmounting must
  // not cancel it for the others still waiting.
  void signal;
  theNames ??= fetchAttributes()
    .then(
      (answer) =>
        new Map(
          answer.items.map((attribute) => [attribute.id, attribute.name]),
        ) as AttributeNames,
    )
    .catch((failure: unknown) => {
      // **A failure is not remembered**, or one bad moment would outlast the session.
      theNames = null;
      throw failure;
    });
  return theNames;
}

/** Only for tests: forget what was fetched, so each one starts from nothing. */
export function forgetAttributeNames(): void {
  theNames = null;
}

const NONE: AttributeNames = new Map();

export function useAttributeNames(): AttributeNames {
  const { resource } = useResource(
    useCallback((signal: AbortSignal) => readThem(signal), []),
  );
  // One empty map, not a new one each render, or every consumer re-renders while it loads.
  return resource.status === "ready" ? resource.data : NONE;
}
