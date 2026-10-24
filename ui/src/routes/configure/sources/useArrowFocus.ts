import { useEffect, useRef } from "react";
import { refocusIfLost } from "../../../shell/focusReturn";

type Direction = "up" | "down";

/**
 * Where a keyboard goes after an arrow has moved its row (NEW-45).
 *
 * **A moved row keeps its focus**: React records the focused element before a commit and gives
 * it focus again afterwards, so an arrow whose row moved down the list is still focused once
 * the new order is drawn. What loses focus is the end of the list. A row moved to the top or the
 * bottom has no neighbour that way, so that arrow is disabled outright, and a browser drops focus
 * from a disabled control. Focus then goes to the row's other arrow, the next move there is.
 *
 * @param sources the list on screen, which changes when a move has been read back.
 * @param settled whether no change is being written or read back.
 */
export function useArrowFocus(sources: readonly unknown[], settled: boolean) {
  const arrows = useRef(new Map<string, HTMLButtonElement>());
  const pressed = useRef<{ id: string; direction: Direction } | null>(null);

  useEffect(() => {
    const move = pressed.current;
    if (move === null) return;
    refocusIfLost(
      arrows.current.get(keyOf(move.id, move.direction)),
      arrows.current.get(keyOf(move.id, opposite(move.direction))),
    );
    if (settled) pressed.current = null;
  }, [sources, settled]);

  return {
    /** A ref for one row's arrow, so focus can be handed to it by row and direction. */
    arrowRef:
      (id: string, direction: Direction) =>
      (element: HTMLButtonElement | null): void => {
        if (element === null) arrows.current.delete(keyOf(id, direction));
        else arrows.current.set(keyOf(id, direction), element);
      },
    /** Notes the arrow a reader pressed, whose row focus follows until the move has settled. */
    pressed: (id: string, direction: Direction): void => {
      pressed.current = { id, direction };
    },
  };
}

function keyOf(id: string, direction: Direction): string {
  return `${id}:${direction}`;
}

function opposite(direction: Direction): Direction {
  return direction === "up" ? "down" : "up";
}
