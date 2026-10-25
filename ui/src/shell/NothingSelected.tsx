import { ReadFailureCard } from "./ReadFailureCard";
import { useSelection } from "./SelectionContext";

/**
 * What a screen says while no criteria set and level are chosen -- **unless the lists to
 * choose from never arrived**, which is a failure to say so rather than an invitation to
 * choose from lists that are not there (PL-002).
 */
export function NothingSelected({ toSee }: { toSee: string }) {
  const { read, reload } = useSelection();
  if (read.state === "failed") {
    return (
      <ReadFailureCard
        what="The criteria sets and levels"
        error={read.error}
        onRetry={reload}
        prominence="screen"
      />
    );
  }
  return <p className="screen__note">Choose a criteria set and a level {toSee}.</p>;
}
