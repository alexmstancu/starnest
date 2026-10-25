import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import type { Read } from "../api/read";
import { ReadFailureCard } from "./ReadFailureCard";
import { takeFocusIfLost, useFocusRegion } from "./useFocusWhenLost";
import { useRetryFocus } from "./useRetryFocus";

/**
 * A screen with nothing on it because nothing is there yet (PL-011): why it is empty, and the
 * one action that fills it. Apart from an unset setting (`UnsetSetting`) and from a failure:
 * nothing is wrong, the database is simply new.
 */
export function EmptyCard({
  title,
  detail,
  action,
  children,
}: {
  title: string;
  detail: string;
  /** The one control that fills what is empty. */
  action: ReactNode;
  /** What that action shows once pressed, inside the card. */
  children?: ReactNode;
}) {
  const heading = useId();
  return (
    <section className="empty-card" aria-labelledby={heading}>
      <h2 id={heading} className="empty-card__title">
        {title}
      </h2>
      <p className="empty-card__detail">{detail}</p>
      <div className="empty-card__action">{action}</div>
      {children}
    </section>
  );
}

/**
 * `children`, unless a successful read says the database holds no value -- then `card` in
 * their place (PL-011). **Decided from a read that answered, never one pending or failed**
 * (PL-001): while the count is read, what it guards stays drawn and marked busy; a count that
 * could not be read says so in a line with Try again, and guards nothing.
 *
 * **The wrapper is one element in every state**, so focus that the card or the content took
 * with it when the other replaced it lands here rather than on the page.
 */
export function UnlessNothingStored({
  stored,
  onRetry,
  card,
  children,
}: {
  stored: Read<number>;
  onRetry: () => Promise<void>;
  card: ReactNode;
  children: ReactNode;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const region = useFocusRegion();
  const { retryButton, hold } = useRetryFocus(stored, wrapper);
  const empty = stored.state === "ready" && stored.data === 0;

  useLayoutEffect(() => {
    takeFocusIfLost(region, wrapper.current);
  }, [empty, region]);

  return (
    <div
      ref={wrapper}
      tabIndex={-1}
      onFocus={region.claim}
      aria-busy={stored.state === "pending" || undefined}
    >
      {stored.state === "failed" && (
        <ReadFailureCard
          what="Whether any values are stored"
          error={stored.error}
          onRetry={() => {
            hold();
            void onRetry();
          }}
          retryRef={retryButton}
          prominence="region"
        />
      )}
      {empty ? card : children}
    </div>
  );
}
