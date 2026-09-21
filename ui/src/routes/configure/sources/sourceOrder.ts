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
 * The two priority changes that move a source past its neighbour.
 *
 * **A swap, not an assignment.** Giving the moved source its neighbour's number leaves the two
 * *level* rather than reordered, and a tie keeps whatever order they already had -- so the row
 * would not visibly move. Exchanging the two numbers is the smallest change that says what was
 * meant, and it needs both halves.
 *
 * Priorities are deliberately not unique -- two sources share 16 in the shipped catalog -- so
 * a move against an equal neighbour is refused rather than faked.
 *
 * Null when there is no neighbour in that direction, which is what disables the button.
 */
export interface Swap {
  id: string;
  priority: number;
  neighbourId: string;
  neighbourPriority: number;
}

export function priorityForMove<Source extends OrderedSource>(
  sources: readonly Source[],
  id: string,
  direction: "up" | "down",
): Swap | null {
  const ordered = inPriorityOrder(sources);
  const at = ordered.findIndex((source) => source.id === id);
  if (at === -1) return null;

  const here = ordered[at];
  const neighbour = ordered[direction === "up" ? at - 1 : at + 1];
  if (!here || !neighbour) return null;
  if (here.default_priority === neighbour.default_priority) return null;

  return {
    id: here.id,
    priority: neighbour.default_priority,
    neighbourId: neighbour.id,
    neighbourPriority: here.default_priority,
  };
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
