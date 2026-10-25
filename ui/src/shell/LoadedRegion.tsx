import { type ReactNode, useLayoutEffect, useRef } from "react";
import type { Read } from "../api/read";
import { formatDateTime } from "../format/display";
import { ReadFailureCard } from "./ReadFailureCard";
import { Skeleton, type SkeletonShape } from "./Skeleton";
import { type FocusRegion, takeFocusIfLost } from "./useFocusWhenLost";
import { useRetryFocus } from "./useRetryFocus";

/**
 * A region drawn from one read (C01 M1): a skeleton while it is pending, the failure card when
 * it never arrived, and what it read otherwise -- **never a default standing in for it**.
 *
 * `read` is a `Read`, not `Read | Idle`: "nothing is selected" is the screen's to say (PL-009),
 * so a region cannot be handed a read that was never asked for.
 *
 * **The wrapper stays the same element in every state**, so what is inside it keeps its state
 * and its focus while it is read again; it is only marked busy.
 *
 * **Try again takes its own button away**, and a browser answers by putting focus on the page.
 * So the wrapper holds focus while the read is retried, and hands it to the new Try again if
 * that fails too -- but only while focus is still in the region or lost: a reader who tabbed
 * elsewhere meanwhile put it there on purpose (`useRetryFocus`).
 *
 * **Drawn in place of something pressed in `takesFocusFrom`** -- a Try again that changed the
 * selection the region was keyed on -- it takes the focus that was lost with it.
 */
export function LoadedRegion<T>({
  read,
  what,
  skeleton,
  onRetry,
  prominence = "screen",
  takesFocusFrom,
  children,
}: {
  read: Read<T>;
  /** What is being read, as the subject of a sentence: "The ranking". */
  what: string;
  skeleton: SkeletonShape;
  onRetry: () => void | Promise<void>;
  prominence?: "screen" | "region";
  takesFocusFrom?: FocusRegion;
  children: (data: T) => ReactNode;
}) {
  const region = useRef<HTMLDivElement>(null);
  const { retryButton, hold } = useRetryFocus(read, region);

  function retry() {
    hold();
    void onRetry();
  }

  // Before paint: between the commit that took the pressed control away and a passive effect,
  // focus would sit on the page.
  useLayoutEffect(() => {
    if (takesFocusFrom) takeFocusIfLost(takesFocusFrom, region.current);
  }, [takesFocusFrom]);

  const busy = read.state === "pending" || (read.state === "ready" && read.refresh === "running");
  return (
    <div ref={region} tabIndex={-1} aria-busy={busy}>
      {read.state === "failed" && (
        <ReadFailureCard
          what={what}
          error={read.error}
          onRetry={retry}
          retryRef={retryButton}
          prominence={prominence}
        />
      )}
      {read.state === "pending" && <Skeleton shape={skeleton} />}
      {read.state === "ready" && typeof read.refresh === "object" && (
        <p className="stale-read" role="status">
          {what} could not be refreshed, shown as read at{" "}
          {formatDateTime(read.readAt.toISOString())}.
          <button ref={retryButton} type="button" className="button" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {read.state === "ready" && children(read.data)}
    </div>
  );
}
