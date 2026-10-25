/**
 * An address that opens one candidate's evidence on Rank, at one pillar (PL-084).
 *
 * **The address carries it, not a store**, so the link a hand-typed figure's read-back offers
 * survives a reload and a copied link, and Rank applies it only once the ranking it names has
 * arrived. Malformed or empty parts ask for nothing: an address a reader edited by hand is not
 * an error.
 */

import { ROUTES } from "./routes";

const RANK = ROUTES.find((route) => route.label === "Rank")!.path;

export const CANDIDATE = "candidate";
export const PILLAR = "pillar";
export const LEVEL = "level";

export interface DrillDown {
  candidate: string;
  pillar: string | null;
  /** The level the candidate is at; null leaves the reader's level as it is. */
  level: string | null;
}

export function drillDownPath({ candidate, pillar, level }: DrillDown): string {
  const query = new URLSearchParams({ [CANDIDATE]: candidate });
  if (pillar !== null) query.set(PILLAR, pillar);
  if (level !== null) query.set(LEVEL, level);
  return `${RANK}?${query.toString()}`;
}

/** What an address asks Rank to open, or null when it names no candidate. */
export function drillDownAsked(search: string): DrillDown | null {
  const query = new URLSearchParams(search);
  const candidate = present(query.get(CANDIDATE));
  if (candidate === null) return null;
  return { candidate, pillar: present(query.get(PILLAR)), level: present(query.get(LEVEL)) };
}

/** The same address with the request taken out, everything else (`?saved`) kept. */
export function withoutDrillDown(search: string): URLSearchParams {
  const query = new URLSearchParams(search);
  for (const name of [CANDIDATE, PILLAR, LEVEL]) query.delete(name);
  return query;
}

function present(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}
