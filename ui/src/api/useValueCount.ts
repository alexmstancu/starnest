import { useCallback } from "react";
import { fetchValueCount } from "./endpoints";
import type { Read } from "./read";
import { useRead } from "./useRead";

/**
 * Whether the database holds any value at all (PL-011), as a read: the one question behind
 * Rank's, Compare's and Acquire's empty cards, asked the same way by all three.
 *
 * **Decided from the count, never from a ranking.** Every candidate reading `insufficient_data`
 * is also what a set scoring only unsourced attributes looks like, with values stored.
 *
 * `freshness` is the shell's "an acquisition ended": the cards leave once a first one stores
 * anything.
 */
export function useValueCount(freshness: number): {
  read: Read<number>;
  reload: () => Promise<void>;
} {
  const { read, reload } = useRead(
    useCallback((signal: AbortSignal) => fetchValueCount({ signal }), []),
    { freshness },
  );
  // Always enabled, so never idle; said to the type rather than assumed by every caller.
  return { read: read.state === "idle" ? PENDING : read, reload };
}

const PENDING: Read<never> = { state: "pending" };
