import type { Attribute, Candidate, RunPair } from "../../api/endpoints";
import { formatCount, pillarName } from "../../format/display";

/**
 * What a picker acquires (PL-125, `reqs.md` 5.6): one candidate across every attribute, one
 * attribute across every candidate, or one pillar's attributes across every candidate.
 */
export type PickKind = "candidate" | "attribute" | "pillar";

export interface PickOption {
  value: string;
  label: string;
}

/** The level's candidates and attributes, which every pick is drawn from. */
export interface PickCatalog {
  candidates: readonly Pick<Candidate, "id" | "name">[];
  attributes: readonly Pick<Attribute, "id" | "name" | "pillar">[];
}

/** What can be picked of one kind, named as the catalog names it; pillars in the catalog's order. */
export function optionsFor(
  kind: PickKind,
  catalog: PickCatalog,
  pillars: { names: ReadonlyMap<string, string>; order: ReadonlyMap<string, number> },
): PickOption[] {
  if (kind === "candidate") {
    return catalog.candidates.map(({ id, name }) => ({ value: id, label: name }));
  }
  if (kind === "attribute") {
    return catalog.attributes.map(({ id, name }) => ({ value: id, label: name }));
  }
  const held = [
    ...new Set(catalog.attributes.flatMap((attribute) => (attribute.pillar ? [attribute.pillar] : []))),
  ];
  const rank = (pillar: string) => pillars.order.get(pillar) ?? Number.MAX_SAFE_INTEGER;
  return held
    .sort((one, other) => rank(one) - rank(other))
    .map((pillar) => ({ value: pillar, label: pillarName(pillars.names, pillar) }));
}

/**
 * The exact pairs a pick asks about. **Pairs, never a rectangle widened by accident**: nothing
 * picked is no pair at all, which the server refuses as an empty scope rather than reading as
 * the whole level.
 */
export function pairsPicked(kind: PickKind, picked: string, catalog: PickCatalog): RunPair[] {
  if (picked === "") return [];
  const attributes =
    kind === "attribute"
      ? catalog.attributes.filter((attribute) => attribute.id === picked)
      : kind === "pillar"
        ? catalog.attributes.filter((attribute) => attribute.pillar === picked)
        : catalog.attributes;
  const candidates =
    kind === "candidate"
      ? catalog.candidates.filter((candidate) => candidate.id === picked)
      : catalog.candidates;
  return candidates.flatMap((candidate) =>
    attributes.map((attribute) => ({ candidate: candidate.id, attribute: attribute.id })),
  );
}

/** The picker's action, naming how many items its estimate covers. */
export function pickedLabel(pairs: number): string {
  if (pairs === 0) return "Estimate";
  return `Estimate ${formatCount(pairs)} ${pairs === 1 ? "item" : "items"}`;
}
