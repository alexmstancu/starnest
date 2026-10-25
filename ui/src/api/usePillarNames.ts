/**
 * What to call each pillar, by id.
 *
 * **The catalog's name, not the id title-cased.** A ranking and a criteria set both carry
 * pillar *ids* -- `economics`, `connectivity` -- and capitalising one gives "Economics" and
 * "Connectivity" where the catalog says "Economy" and "Transport". The difference is not
 * cosmetic: a name is a decision somebody made and a title-cased id is this screen guessing.
 *
 * **A failure is silence, not a refusal.** What this feeds is a label; the weights, scores and
 * bars beside it do not depend on it. An empty map makes every pillar fall back to its
 * title-cased id, which is what the screens did before this existed.
 *
 * **The fallback itself lives in `format/`, not here.** `api/` is the port to the contract and
 * may not import `format/` -- turning an id into something a reader sees is presentation, and
 * the zone rule in `eslint.config.js` is what said so. This file fetches; `pillarName` names.
 */

import { useCallback } from "react";
import { fetchPillars } from "./endpoints";
import { useRead } from "./useRead";

export type PillarNames = ReadonlyMap<string, string>;

/** Where each pillar sits in the catalog's reading order, by id (`display_order`). */
export type PillarOrder = ReadonlyMap<string, number>;

interface PillarCatalog {
  names: PillarNames;
  order: PillarOrder;
}

/**
 * The names once, shared by every caller on the page.
 *
 * **The catalog is eleven rows that do not change while the app is open**, and five components
 * each mounted their own `useResource` for it -- Rank fired two `GET /pillars`, Configure two.
 * One in-flight promise, kept for the life of the module, is the whole of what a cache needs to
 * be here: there is nothing to invalidate, because a migration is the only thing that can
 * change these and that means a restart.
 *
 * `null` until the first caller asks, so nothing is fetched by merely importing this.
 */
let theNames: Promise<PillarCatalog> | null = null;

function readThem(signal: AbortSignal): Promise<PillarCatalog> {
  // **The signal is not passed on.** The request is shared, so one component unmounting must
  // not cancel it for the other four still waiting. It is eleven rows and it happens once.
  void signal;
  theNames ??= fetchPillars()
    .then((answer) => ({
      names: new Map(answer.items.map((pillar) => [pillar.id, pillar.name])),
      // **Kept, not dropped** (PL-074): the drill-down orders its rows by it, and the
      // order is the catalog's fact rather than the order the list happened to arrive in.
      order: new Map(answer.items.map((pillar) => [pillar.id, pillar.display_order])),
    }))
    .catch((failure: unknown) => {
      // **A failure is not remembered.** Keeping a rejected promise would make one bad moment
      // permanent for the rest of the session; the next caller tries again.
      theNames = null;
      throw failure;
    });
  return theNames;
}

/** Only for tests: forget what was fetched, so each one starts from nothing. */
export function forgetPillarNames(): void {
  theNames = null;
}

const NONE: PillarCatalog = { names: new Map(), order: new Map() };

function usePillarCatalog(): PillarCatalog {
  const { read } = useRead(
    useCallback((signal: AbortSignal) => readThem(signal), []),
  );
  // **One empty map, not a new one each render.** A fresh `new Map()` on every render of a
  // loading or failed screen is a new object identity for every consumer downstream.
  return read.state === "ready" ? read.data : NONE;
}

export function usePillarNames(): PillarNames {
  return usePillarCatalog().names;
}

/** The catalog's order of the pillars; empty while unread or failed, as the names are. */
export function usePillarOrder(): PillarOrder {
  return usePillarCatalog().order;
}
