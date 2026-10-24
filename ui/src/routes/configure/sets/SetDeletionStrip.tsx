import { useEffect, useId, useRef } from "react";
import { HeldButton } from "../../../shell/HeldButton";

/**
 * What deleting a set takes with it, said before it is done (PL-033, PL-035).
 *
 * **Armed, not modal.** Delete arms this strip and sends nothing; it names the set, says that
 * its criteria, weights and rules go with it and that Recent changes can bring them back, says
 * where the selection moves if the set is in use, and offers the copy that makes the deletion
 * unnecessary. Saved rankings are named because they stay: the server keeps them readable.
 */
export function SetDeletionStrip({
  name,
  fallback,
  held,
  onDelete,
  onDuplicate,
  onKeep,
}: {
  name: string;
  /** The set the selection moves to when this one is in use, or null when it is not. */
  fallback: string | null;
  held: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onKeep: () => void;
}) {
  const messageId = useId();
  const confirm = useRef<HTMLButtonElement>(null);
  // Mounted by the press that armed it, so focus follows that press to the decision it asked.
  useEffect(() => confirm.current?.focus(), []);

  return (
    <div className="confirm" role="alert" aria-labelledby={messageId}>
      <p id={messageId} className="confirm__message">
        Delete {name}? Its criteria, pillar weights and rules go with it; Recent
        changes can bring them back.
      </p>
      {fallback !== null && (
        <p className="confirm__message">
          It is in use: Configure and Rank will move to {fallback}.
        </p>
      )}
      <p className="confirm__message">Saved rankings made with it stay readable.</p>
      <div className="confirm__acts">
        <HeldButton
          ref={confirm}
          className="button button--danger"
          held={held}
          onClick={onDelete}
        >
          Delete {name}
        </HeldButton>
        <HeldButton className="button" held={held} onClick={onDuplicate}>
          Duplicate first
        </HeldButton>
        <HeldButton className="button" held={held} onClick={onKeep}>
          Keep it
        </HeldButton>
      </div>
    </div>
  );
}
