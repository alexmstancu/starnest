import { useState } from "react";

/**
 * A number that goes up each time `value` changes -- compared with `Object.is`, so a string key
 * by its contents and a list by its identity: the `freshness` a resource needs when what it reads
 * has been moved on by something else (UIR-A1, RB-3).
 *
 * **Derived during render, not in an effect**, as React has it for a value that follows a prop:
 * an effect would draw the stale answer once more before asking again.
 */
export function useVersionOf(value: unknown): number {
  const [seen, setSeen] = useState({ value, version: 0 });
  if (Object.is(seen.value, value)) return seen.version;
  const next = { value, version: seen.version + 1 };
  setSeen(next);
  return next.version;
}
