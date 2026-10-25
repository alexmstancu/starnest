import { useId } from "react";
import { locksInTheWay } from "../../api/errorPresentation";

/**
 * The locks a refused weight change names, drawn inside its notice: at most three, by the names
 * their rows use, and how many more (UF-035; the design's banner names "up to three to unlock").
 * Pillars or criteria alike -- the caller says how an id is named.
 *
 * Nothing when the refusal names no lock, or when the moved weight is itself the lock: the
 * sentence says so then, and listing the weight as its own obstacle sent the reader looking for
 * another one.
 */
export function LocksInTheWay({
  error,
  nameOf,
}: {
  error: unknown;
  nameOf: (id: string) => string;
}) {
  const headingId = useId();
  const { named, more } = locksInTheWay(error);
  if (named.length === 0) return null;

  return (
    <>
      <p className="screen__note" id={headingId}>
        Locked, so unable to absorb the change:
      </p>
      {/* Named, because these weights also appear in the rows above: a reader arriving at the
          list out of context needs to be told which one it is -- by the name those rows use. */}
      <ul className="lock-list" aria-labelledby={headingId}>
        {named.map((id) => (
          <li key={id}>{nameOf(id)}</li>
        ))}
        {more > 0 && <li>{more === 1 ? "and one more" : `and ${String(more)} more`}</li>}
      </ul>
    </>
  );
}
