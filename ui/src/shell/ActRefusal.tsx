import { type ReactNode, useState } from "react";
import { RefusalNotice } from "./RefusalNotice";

/**
 * The refusal of an act, held where the act's control is (PL-004).
 *
 * **Dismissed here, not in the screen's hook**: a refusal is a value the hook keeps until the
 * next attempt, and the reader putting it away changes nothing stored. The next refusal is a
 * new error, so it shows again. `onResend` only where P1-14 allows sending the act again.
 */
export function ActRefusal({
  act,
  error,
  onResend,
  children,
}: {
  act: string;
  /** Null, or anything nullish, while nothing was refused. */
  error: unknown;
  onResend?: () => Promise<void>;
  /** What the refusal names, drawn inside it: the locks in the way. */
  children?: ReactNode;
}) {
  const [dismissed, setDismissed] = useState<unknown>(null);
  if (error === null || error === undefined || error === dismissed) return null;

  return (
    <RefusalNotice
      act={act}
      error={error}
      onDismiss={() => setDismissed(error)}
      onResend={onResend}
    >
      {children}
    </RefusalNotice>
  );
}
