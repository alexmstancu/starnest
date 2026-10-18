import type { ReactNode } from "react";

/**
 * A button held while an act is in flight, never disabled (NEW-34, NEW-44).
 *
 * **Chromium throws focus off a control the moment it is disabled** and does not give it back,
 * so a keyboard user who pressed Store, Estimate, Retry, Start, Refresh or Stop was put back on
 * the page while the request ran. Held, the button keeps focus, says it is unavailable with
 * `aria-disabled`, and a press does nothing until the answer is in.
 *
 * **`disabled` stays for what is not in flight** -- nothing selected, no level to plan in --
 * where there is no answer to wait for, only nothing to do.
 */
export function HeldButton({
  held,
  disabled = false,
  className,
  onClick,
  children,
}: {
  held: boolean;
  disabled?: boolean;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-disabled={held || undefined}
      onClick={() => {
        if (!held) onClick();
      }}
    >
      {children}
    </button>
  );
}
