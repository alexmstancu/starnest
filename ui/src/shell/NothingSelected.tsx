import type { Read } from "../api/read";
import { LoadedRegion } from "./LoadedRegion";
import { ReadFailureCard } from "./ReadFailureCard";
import { type SelectionLists, useSelection } from "./SelectionContext";
import type { SkeletonShape } from "./Skeleton";

/**
 * What a screen says while no criteria set and level are chosen.
 *
 * **While the lists are coming, or hold a set and a level the selection is about to choose**,
 * the screen is still being read (PL-009), so it is a skeleton in the shape of what will come:
 * "choose a set" in that render was a fact drawn from lists nobody had read (PL-001). **Once
 * the lists never arrived**, it says so rather than inviting a choice from lists that are not
 * there (PL-002); only lists that were read and hold nothing to choose ask for a choice.
 */
export function NothingSelected({ toSee, skeleton }: { toSee: string; skeleton: SkeletonShape }) {
  const { read, reload } = useSelection();
  if (stillChoosing(read)) {
    return (
      <LoadedRegion read={PENDING} what="The criteria sets and levels" skeleton={skeleton} onRetry={reload}>
        {() => null}
      </LoadedRegion>
    );
  }
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

function stillChoosing(lists: Read<SelectionLists>): boolean {
  if (lists.state === "pending") return true;
  return (
    lists.state === "ready" && lists.data.levels.length > 0 && lists.data.criteriaSets.length > 0
  );
}

const PENDING: Read<never> = { state: "pending" };
