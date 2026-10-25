import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { describeSaved } from "../../format/savedRanking";
import { ActRefusal } from "../../shell/ActRefusal";
import { useSelection } from "../../shell/SelectionContext";
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
 *
 * **Drawn only once there is a ranking** (PL-146), and held with a reason when that ranking
 * has nobody in it. Held controls use `aria-disabled` rather than `disabled`, so the keyboard
 * stays on a button whose save is in flight instead of falling to the page.
 */
export function SaveControl({
  criteriaSetId,
  levelId,
  ranked,
}: {
  criteriaSetId: string | null;
  levelId: string | null;
  /** How many candidates the ranking on screen holds. */
  ranked: number;
}) {
  const saved = useSavedRankings(criteriaSetId, levelId);
  const { criteriaSets } = useSelection();
  const [asking, setAsking] = useState(false);
  const offer = useRef<HTMLButtonElement>(null);
  const giveFocusBack = useRef(false);
  const nothingToSave = ranked === 0;
  const held = nothingToSave || !saved.canSave;

  // Back onto "Save this ranking" once the field closes, saved or called off -- the button
  // that had the keyboard is gone with the field.
  useEffect(() => {
    if (asking || !giveFocusBack.current) return;
    giveFocusBack.current = false;
    offer.current?.focus();
  }, [asking]);

  function close() {
    giveFocusBack.current = true;
    saved.clearError();
    setAsking(false);
  }

  async function keep() {
    // A failure keeps the field and the note, so nothing is retyped (PL-146).
    if (await saved.save()) close();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && !saved.saving) close();
  }

  const sets = new Map(criteriaSets.map((set) => [set.id, set.name]));

  return (
    <div className="keep">
      {asking ? (
        <form
          className="keep__ask"
          onSubmit={(event) => {
            event.preventDefault();
            void keep();
          }}
        >
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
            onKeyDown={onKey}
          />
          <button
            type="submit"
            className="button button--primary"
            aria-disabled={!saved.canSave}
          >
            {saved.saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="button"
            aria-disabled={saved.saving}
            onClick={saved.saving ? undefined : close}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          ref={offer}
          type="button"
          className="button button--primary"
          aria-disabled={held}
          title="Keep this ranking and the weights behind it"
          onClick={held ? undefined : () => setAsking(true)}
        >
          Save this ranking
        </button>
      )}
      <span className="keep__note-line">
        {asking
          ? "Weights, locks and every value behind the scores are frozen with it."
          : nothingToSave
            ? "Nothing to save: no candidate was ranked."
            : saved.kept !== null
              ? `Saved as “${describeSaved(saved.kept, sets)}”.`
              : "Nothing is kept until you save it."}
      </span>

      {/* A save is never sent again from its refusal (P1-14): Save is still there to press. */}
      <ActRefusal act="Saving the ranking" error={saved.error} />
    </div>
  );
}
