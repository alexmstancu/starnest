import { useState } from "react";
import { type Item, keyOf } from "./runScope";

const NOTHING: ReadonlySet<string> = new Set();

export interface GapSelection {
  /** The keys picked, as `keyOf` names them. */
  selected: ReadonlySet<string>;
  /** The items picked, among those still in the card. */
  chosen: Item[];
  /** Picks or unpicks `keys`. Any change puts away a start armed for the old selection (PL-116). */
  toggle: (keys: readonly string[], on: boolean) => void;
}

/**
 * What is picked in one remedy card (PL-124), held by the card so its one action can follow it.
 *
 * **Nothing picked to begin with, as the design has it**, and nothing carried to another level:
 * the picks belong to the level they were made at. A re-read of the gaps keeps them, and a pick
 * whose item has gone counts for nothing.
 */
export function useGapSelection(
  items: readonly Item[],
  level: string,
  onChange: () => void,
): GapSelection {
  const [picks, setPicks] = useState<{ level: string; keys: ReadonlySet<string> }>({
    level,
    keys: NOTHING,
  });
  const selected = picks.level === level ? picks.keys : NOTHING;
  return {
    selected,
    chosen: items.filter((item) => selected.has(keyOf(item))),
    toggle: (keys, on) => {
      onChange();
      setPicks((current) => {
        const next = new Set(current.level === level ? current.keys : NOTHING);
        for (const key of keys) {
          if (on) next.add(key);
          else next.delete(key);
        }
        return { level, keys: next };
      });
    },
  };
}
