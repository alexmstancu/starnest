import { useLayoutEffect, useRef } from "react";
import { presentError } from "../api/errorPresentation";

/**
 * An act that did not go through (C01 M2, PL-004).
 *
 * **Every refusal can be dismissed**, so `onDismiss` is required. **Try again appears only
 * where pressing it sends the same request again** (N11, P1-14), so `onResend` is passed only
 * for an act that is safe to repeat -- an estimate, a read-back. A failed start, stop, retry,
 * save or confirm gets Dismiss alone: a start sent twice could begin a second paid run.
 */
export function RefusalNotice({
  act,
  error,
  note,
  onDismiss,
  onResend,
}: {
  /** What was attempted, as the subject of a sentence: "The estimate". */
  act: string;
  error: unknown;
  /** What the refusal leaves unknown, where it matters: whether a start began. */
  note?: string;
  onDismiss: () => void;
  onResend?: () => Promise<void>;
}) {
  // **Dismiss and Try again take their own buttons away**, so focus goes back to the control
  // whose act was refused -- held when the refusal appeared -- rather than falling to the page.
  const pressed = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    pressed.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
  }, []);
  const giveFocusBack = () => {
    if (pressed.current?.isConnected) pressed.current.focus();
  };

  return (
    <div className="failure-card" role="alert">
      <p className="failure-card__title">{act} did not go through</p>
      <p>{presentError(error).message}</p>
      {note !== undefined && <p>{note}</p>}
      <div className="failure-card__acts">
        {onResend && (
          <button
            type="button"
            className="button"
            onClick={() => {
              giveFocusBack();
              void onResend();
            }}
          >
            Try again
          </button>
        )}
        <button
          type="button"
          className="button"
          onClick={() => {
            giveFocusBack();
            onDismiss();
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
