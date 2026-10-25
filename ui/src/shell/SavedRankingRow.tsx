import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ActRefusal } from "./ActRefusal";
import { useDiscardSaved } from "./useDiscardSaved";

/**
 * One saved ranking in the sidebar: its name over who led it and when, a link that opens it,
 * and a × that deletes it once the deletion is confirmed (PL-145, D47).
 *
 * **Confirmed in place, not in a dialog.** The row is 262px wide and the question is about
 * that row, so it opens under the name it is about. Deleting cannot be undone -- the figures
 * frozen with it go with it -- which is why one press is never enough.
 */
export function SavedRankingRow({
  evaluationId,
  name,
  meta,
  href,
  current,
  onGone,
}: {
  evaluationId: number;
  name: string;
  meta: string;
  href: string;
  current: boolean;
  onGone: (alreadyGone: boolean) => void;
}) {
  const discard = useDiscardSaved(evaluationId, onGone);
  const remove = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);

  // The keyboard follows the question: onto "Keep it" when it is asked, which is the answer
  // that loses nothing, and back onto the × when it is called off -- never onto the page.
  useEffect(() => {
    if (discard.step === "confirming" && !asked.current) {
      asked.current = true;
      keep.current?.focus();
    }
    if (discard.step === "idle" && asked.current) {
      asked.current = false;
      remove.current?.focus();
    }
  }, [discard.step]);

  const deleting = discard.step === "deleting";
  const confirming = discard.step !== "idle";

  return (
    <li
      className={
        confirming ? "saved-list__row saved-list__row--confirming" : "saved-list__row"
      }
    >
      <Link
        className="saved-list__open"
        to={href}
        title="Open this saved ranking"
        aria-current={current ? "page" : undefined}
      >
        <span className="saved-list__name">{name}</span>
        <span className="saved-list__meta">{meta}</span>
      </Link>
      {!confirming && (
        <button
          ref={remove}
          type="button"
          className="saved-list__remove"
          aria-label={`Delete ${name}`}
          title="Delete this saved ranking"
          onClick={discard.ask}
        >
          ×
        </button>
      )}
      {confirming && (
        <div className="saved-list__confirm">
          <p className="sidebar__note">
            Delete it? The weights and figures frozen with it go too.
          </p>
          <div className="saved-list__confirm-actions">
            <button
              type="button"
              className="action action--danger"
              aria-disabled={deleting}
              onClick={() => void discard.discard()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              ref={keep}
              type="button"
              className="action"
              aria-disabled={deleting}
              onClick={deleting ? undefined : discard.callOff}
            >
              Keep it
            </button>
          </div>
          {/* Dismiss only (P1-14): Delete, still above, is how it is sent again. */}
          <ActRefusal act="The deletion" error={discard.failure} />
        </div>
      )}
    </li>
  );
}
