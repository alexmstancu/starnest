import type { Read } from "../api/read";
import { LoadedRegion } from "./LoadedRegion";
import { type SelectionLists, useSelection } from "./SelectionContext";
import type { SkeletonShape } from "./Skeleton";
import { type FocusRegion, useFocusWhenLost } from "./useFocusWhenLost";

/**
 * What a screen says while no criteria set and level are chosen.
 *
 * **While the lists are coming, or hold a set and a level the selection is about to choose**,
 * the screen is still being read (PL-009), so it is a skeleton in the shape of what will come:
 * "choose a set" in that render was a fact drawn from lists nobody had read (PL-001). **Once
 * the lists never arrived**, it says so rather than inviting a choice from lists that are not
 * there (PL-002); only lists that were read and hold nothing to choose ask for a choice.
 */
export function NothingSelected({
  toSee,
  skeleton,
  takesFocusFrom,
}: {
  toSee: string;
  skeleton: SkeletonShape;
  /** The screen whose Try again it may be drawn in place of, mid-way through a selection. */
  takesFocusFrom?: FocusRegion;
}) {
  const { read, reload } = useSelection();
  // **One region for still-being-read and could-not-be-read**, so the Try again it draws keeps
  // focus in it while the lists are read again (`LoadedRegion`).
  if (stillChoosing(read) || read.state === "failed") {
    return (
      <LoadedRegion
        read={read.state === "failed" ? read : PENDING}
        what="The criteria sets and levels"
        skeleton={skeleton}
        onRetry={reload}
        takesFocusFrom={takesFocusFrom}
      >
        {() => null}
      </LoadedRegion>
    );
  }
  return <NothingToChoose toSee={toSee} takesFocusFrom={takesFocusFrom} />;
}

/**
 * Lists read and holding nothing to choose. **Drawn in place of the Try again that read them**,
 * it takes the focus that button took away with it.
 */
function NothingToChoose({ toSee, takesFocusFrom }: { toSee: string; takesFocusFrom?: FocusRegion }) {
  const note = useFocusWhenLost<HTMLParagraphElement>(takesFocusFrom);
  return (
    <p ref={note} tabIndex={-1} className="screen__note">
      Choose a criteria set and a level {toSee}.
    </p>
  );
}

function stillChoosing(lists: Read<SelectionLists>): boolean {
  if (lists.state === "pending") return true;
  return (
    lists.state === "ready" && lists.data.levels.length > 0 && lists.data.criteriaSets.length > 0
  );
}

const PENDING: Read<never> = { state: "pending" };
