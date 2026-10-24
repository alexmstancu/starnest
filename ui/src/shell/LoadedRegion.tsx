import type { ReactNode } from "react";
import type { Read } from "../api/read";
import { formatDateTime } from "../format/display";
import { ReadFailureCard } from "./ReadFailureCard";
import { Skeleton, type SkeletonShape } from "./Skeleton";

/**
 * A region drawn from one read (C01 M1): a skeleton while it is pending, the failure card when
 * it never arrived, and what it read otherwise -- **never a default standing in for it**.
 *
 * `read` is a `Read`, not `Read | Idle`: "nothing is selected" is the screen's to say (PL-009),
 * so a region cannot be handed a read that was never asked for.
 *
 * **The wrapper stays the same element across a refresh**, so what is inside it keeps its
 * state and its focus while it is read again; it is only marked busy.
 */
export function LoadedRegion<T>({
  read,
  what,
  skeleton,
  onRetry,
  prominence = "screen",
  children,
}: {
  read: Read<T>;
  /** What is being read, as the subject of a sentence: "The ranking". */
  what: string;
  skeleton: SkeletonShape;
  onRetry: () => void | Promise<void>;
  prominence?: "screen" | "region";
  children: (data: T) => ReactNode;
}) {
  if (read.state === "failed") {
    return (
      <ReadFailureCard what={what} error={read.error} onRetry={onRetry} prominence={prominence} />
    );
  }

  if (read.state === "pending") {
    return (
      <div aria-busy="true">
        <Skeleton shape={skeleton} />
      </div>
    );
  }

  return (
    <div aria-busy={read.refresh === "running"}>
      {typeof read.refresh === "object" && (
        <p className="stale-read" role="status">
          {what} could not be refreshed, shown as read at{" "}
          {formatDateTime(read.readAt.toISOString())}.
          <button type="button" className="button" onClick={() => void onRetry()}>
            Try again
          </button>
        </p>
      )}
      {children(read.data)}
    </div>
  );
}
