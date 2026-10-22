import { useState } from "react";

/**
 * A number that goes up each time `key` changes: the `freshness` a resource needs when what it
 * reads has been moved on by something else (UIR-A1).
 *
 * **Derived during render, not in an effect**, as React has it for a value that follows a prop:
 * an effect would draw the stale answer once more before asking again.
 */
export function useVersionOf(key: string): number {
  const [seen, setSeen] = useState({ key, version: 0 });
  if (seen.key === key) return seen.version;
  const next = { key, version: seen.version + 1 };
  setSeen(next);
  return next.version;
}
