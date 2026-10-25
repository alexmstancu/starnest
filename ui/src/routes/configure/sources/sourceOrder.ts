import { isApiError } from "../../../api/ApiError";

/**
 * Reordering the source list, and what a move means.
 *
 * **A lower number wins** (`reqs.md` 6.6), so "move up" means "take a smaller priority". The
 * arithmetic lives here because a `.tsx` under `routes/` may not call `Number` and friends,
 * and because "what does moving a source mean" is a rule worth a test.
 */

export interface OrderedSource {
  id: string;
  default_priority: number;
  is_enabled?: boolean;
}

/** The list as it is read top to bottom: the order the active-value rule applies. */
export function inPriorityOrder<Source extends OrderedSource>(
  sources: readonly Source[],
): Source[] {
  return [...sources].sort(
    (one, other) => one.default_priority - other.default_priority,
  );
}

/**
 * The whole order once a source has moved one place, as every source's id, highest first.
 *
 * **The order, never the numbers** (D36, PL-136): the server hands the stored priorities back
 * out in this order, so the tiers between them survive, and it alone decides what a tie reads
 * as. The interface only says where each source stands.
 *
 * **A tie is swapped like any other pair** (PL-137): priorities are deliberately not unique --
 * two sources share 16 in the shipped catalog -- and the server gives the pair distinct numbers.
 *
 * Null when there is no neighbour in that direction, which is what disables the button.
 */
export function orderAfterMove<Source extends OrderedSource>(
  sources: readonly Source[],
  id: string,
  direction: "up" | "down",
): string[] | null {
  const ordered = inPriorityOrder(sources);
  const at = ordered.findIndex((source) => source.id === id);
  const to = direction === "up" ? at - 1 : at + 1;
  const here = ordered[at];
  const neighbour = ordered[to];
  if (at === -1 || !here || !neighbour) return null;

  ordered[at] = neighbour;
  ordered[to] = here;
  return ordered.map((source) => source.id);
}

/**
 * The whole order a drop leaves, as every source's id, highest first.
 *
 * **A drag is a splice, not a swap**: moving the top source to fourth place puts the two rows
 * it passed one place higher each, which no exchange of two places can say.
 *
 * **Null for a drop that moves nothing** -- onto its own row, or with either source not in the
 * list -- so nothing is sent: a request restating the order would still flash the row as
 * saving and re-read the list to show what was already on screen.
 */
export function orderAfterDrop<Source extends OrderedSource>(
  sources: readonly Source[],
  draggedId: string,
  targetId: string,
): string[] | null {
  const dropped = droppedOrder(sources, draggedId, targetId);
  return dropped.length === 0 ? null : dropped.map((source) => source.id);
}

/**
 * Which edge of the target row the dragged row would come to rest against.
 *
 * **The edge follows the direction, and the design's does not.** The mockup draws the line on
 * the target's top edge always, while its own handler removes the row and re-inserts it at the
 * target's index -- which lands it *below* the target whenever the drag went downwards. One of
 * the two is wrong, and an indicator that points at the wrong gap is the worse half to keep:
 * the alternative reading, "always insert above", has a dead end, because then no drop can
 * ever reach the last place in the list.
 *
 * Null for every row but the one being dropped onto, and null for a drop on the dragged row
 * itself -- there is no gap it would move to.
 */
export function landingEdge<Source extends OrderedSource>(
  sources: readonly Source[],
  draggedId: string,
  targetId: string,
): "above" | "below" | null {
  const ordered = inPriorityOrder(sources);
  const from = ordered.findIndex((source) => source.id === draggedId);
  const to = ordered.findIndex((source) => source.id === targetId);
  if (from === -1 || to === -1 || from === to) return null;
  return from > to ? "above" : "below";
}

/**
 * The list as the drop leaves it: the dragged source taken out, then put back at the target's
 * index.
 *
 * **Taken out first, which is what makes the last place reachable.** Removing the row shifts
 * everything below it up one, so re-inserting at the target's old index lands the row after
 * that target when the drag went down and before it when the drag went up. Every gap in the
 * list, including the one at the very bottom, is the destination of some drop.
 */
function droppedOrder<Source extends OrderedSource>(
  sources: readonly Source[],
  draggedId: string,
  targetId: string,
): Source[] {
  const ordered = inPriorityOrder(sources);
  const from = ordered.findIndex((source) => source.id === draggedId);
  const to = ordered.findIndex((source) => source.id === targetId);
  if (from === -1 || to === -1 || from === to) return [];

  const dragged = ordered[from];
  if (dragged === undefined) return [];
  ordered.splice(from, 1);
  ordered.splice(to, 0, dragged);
  return ordered;
}

/**
 * What position to show beside a source.
 *
 * A switched-off source has no position, because it is not in the contest -- showing one
 * would say it is next in line when it is not consulted at all. The numbering of the rest
 * closes up, so reading it top to bottom is reading what would actually happen.
 */
export function positionsOf<Source extends OrderedSource>(
  sources: readonly Source[],
): Map<string, number | null> {
  let position = 0;
  return new Map(
    inPriorityOrder(sources).map((source) => [
      source.id,
      source.is_enabled === false ? null : ++position,
    ]),
  );
}

/**
 * What an `invalid_source_order` refusal names, in sources rather than ids (P1-07).
 *
 * The order sent is the list on screen, so a refusal means the catalog changed under it: a
 * source added since the list was read is missing, one taken away is unknown. An unknown one
 * has no name left to read, so it is counted rather than shown by id.
 *
 * Null for any other failure, whose wording is the code's alone.
 */
export function describeOrderRefusal(
  error: unknown,
  nameOf: (id: string) => string,
): string | null {
  if (!isApiError(error) || error.code !== "invalid_source_order") return null;
  const details = error.details ?? {};
  const missing = idsIn(details["missing"]);
  const repeated = idsIn(details["repeated"]);
  const unknown = idsIn(details["unknown"]);
  const parts = [
    missing.length > 0 && `${listed(missing, nameOf)} ${wasOrWere(missing)} left out of it`,
    repeated.length > 0 && `${listed(repeated, nameOf)} ${wasOrWere(repeated)} named twice`,
    unknown.length > 0 &&
      `${unknown.length === 1 ? "one source" : `${unknown.length} sources`} in it ${
        unknown.length === 1 ? "is" : "are"
      } no longer in the catalog`,
  ].filter((part): part is string => part !== false);
  if (parts.length === 0) return null;
  return `In the order sent, ${parts.join("; ")}. The list now shows the order stored.`;
}

function idsIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : [];
}

function listed(ids: readonly string[], nameOf: (id: string) => string): string {
  return ids.map(nameOf).join(", ");
}

function wasOrWere(ids: readonly string[]): string {
  return ids.length === 1 ? "was" : "were";
}
