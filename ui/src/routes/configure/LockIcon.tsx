/**
 * **A padlock, shut when the weight is held and open when it is free** (NEW-68). Both locks
 * draw this one icon. The design draws a filled or hollow disc, which reads as a radio button
 * rather than a lock; the divergence is recorded in `docs/design-brief.md`.
 *
 * Sized by attributes, because an SVG with no size draws at 300 by 150 px; coloured by
 * `currentColor`, so the button's state colours it; hidden, because the button says it in words.
 */
export function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg
      className="lock-icon"
      data-state={locked ? "shut" : "open"}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={locked ? "M5 7.5V5a3 3 0 0 1 6 0v2.5" : "M5 7.5V5a3 3 0 0 1 5.8-1.1"} />
      <rect
        x="3"
        y="7.5"
        width="10"
        height="7"
        rx="1.5"
        fill={locked ? "currentColor" : "none"}
      />
    </svg>
  );
}
