import { useState } from "react";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSavedRankings } from "./useSavedRankings";

/**
 * Keeping the ranking in front of you, from the header it belongs to.
 *
 * **`GET /rankings` computes and stores nothing.** That is what makes re-weighting instant,
 * and it is why keeping one has to be a deliberate act rather than a side effect of looking:
 * the live ranking moves under you as a weight changes, and a saved one does not.
 *
 * **Two steps, because the note is the reason it was kept.** The design shows one button
 * until it is pressed, then the field and the confirmation -- so the common case is one click
 * and the field never sits there empty inviting somebody to wonder what it is for.
 */
export function SaveControl({
  criteriaSetId,
  levelId,
}: {
  criteriaSetId: string | null;
  levelId: string | null;
}) {
  const saved = useSavedRankings(criteriaSetId, levelId);
  const [asking, setAsking] = useState(false);

  async function keep() {
    await saved.save();
    setAsking(false);
  }

  return (
    <div className="keep">
      {asking ? (
        <div className="keep__ask">
          <label className="visually-hidden" htmlFor="keep-note">
            Why this one is worth keeping
          </label>
          <input
            id="keep-note"
            className="field__control keep__note"
            placeholder="Why keep this one?"
            value={saved.note}
            autoFocus
            onChange={(event) => saved.setNote(event.target.value)}
          />
          <button
            type="button"
            className="button button--primary"
            disabled={!saved.canSave}
            onClick={() => void keep()}
          >
            {saved.saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setAsking(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="button button--primary"
            disabled={!saved.canSave}
            title="Keep this ranking and the weights behind it"
            onClick={() => setAsking(true)}
          >
            Save this ranking
          </button>
          <span className="keep__note-line">
            Nothing is kept until you save it.
          </span>
        </>
      )}

      {saved.error != null && (
        <ErrorNotice error={saved.error} onRetry={saved.reload} />
      )}
    </div>
  );
}
