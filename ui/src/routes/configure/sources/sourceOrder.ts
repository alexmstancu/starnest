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
 * One source's new place in the order, as the one field the contract lets us write.
 *
 * There is no batch reorder and there is deliberately no new operation: a drop is a run of
 * `PATCH /data-sources/{id}` with `default_priority`, which is the same request the arrows
 * already send.
 */
export interface PriorityChange {
  id: string;
  default_priority: number;
}

/**
 * What a drop costs, in priorities.
 *
 * **A drag is a splice, not a swap, so it cannot reuse the arrows' arithmetic.** Moving the
 * top source to fourth place by exchanging two numbers would put it fourth and leave the two
 * rows between it untouched, which is a different order from the one that was dropped.
 *
 * **So the affected rows are renumbered densely: position one upwards, one apart.** The
 * alternative -- rotating the priorities the span already holds -- preserves the stored
 * numbers but breaks on a tie, and ties are reachable: `ecb` and `unodc` both ship at 16, and
 * the endpoint lets a household set any number. A row that lands tied with its new neighbour
 * is then ordered by id rather than by where it was dropped, so the gesture would silently
 * put it somewhere else. Dense numbering is the only assignment that cannot do that.
 *
 * `UNIQUE` on the column was tried and reverted for the reason this relies on: the changes are
 * written one at a time, so the order passes through a moment where two sources share a
 * number. That moment is legal.
 *
 * **Only the rows whose number actually changes are returned**, so a drop that lands where the
 * row already was comes back empty and nothing is sent.
 */
export function reorderForDrop<Source extends OrderedSource>(
  sources: readonly Source[],
  draggedId: string,
  targetId: string,
): PriorityChange[] {
  const dropped = droppedOrder(sources, draggedId, targetId);
  const changes: PriorityChange[] = [];
  dropped.forEach((source, index) => {
    const priority = index + 1;
    if (source.default_priority !== priority) {
      changes.push({ id: source.id, default_priority: priority });
    }
  });
  return changes;
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
