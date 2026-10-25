import { useCallback, useRef, useState } from "react";
import { type EvaluationSummary, saveEvaluation } from "../../api/endpoints";
import { useSelection } from "../../shell/SelectionContext";

/**
 * What the saving panel knows, kept out of its markup.
 *
 * React's own answer -- a custom hook beside the component -- rather than the older
 * container/presentational split (`CLAUDE.md`).
 *
 * **It does not read the list.** The sidebar lists what has been saved; this only adds to it,
 * and tells the shell that it did so the list can catch up.
 */
export function useSavedRankings(
  criteriaSetId: string | null,
  levelId: string | null,
) {
  const { noteSavedRanking } = useSelection();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  // What the last save kept, as the server describes it, so the control can say so (PL-146).
  const [kept, setKept] = useState<EvaluationSummary | null>(null);
  // **One save per press** (PL-146): state lags a render behind a second press, a ref does not.
  const inFlight = useRef(false);

  // A ranking is saved for a criteria set at a level, so with no selection there is nothing
  // to save -- not an empty one.
  const canSave = criteriaSetId !== null && levelId !== null && !saving;

  /** Saves, and answers whether it did -- a refusal stays on screen beside the note. */
  const save = useCallback(async (): Promise<boolean> => {
    if (criteriaSetId === null || levelId === null || inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const saved = await saveEvaluation(criteriaSetId, levelId, note);
      setNote("");
      setKept(saved);
      // The server decides what a saved ranking is, including the moment it was computed, so
      // the sidebar re-reads rather than being handed this answer to push onto its list.
      noteSavedRanking();
      return true;
    } catch (error) {
      setFailure(error);
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [criteriaSetId, levelId, note, noteSavedRanking]);

  return {
    error: failure,
    clearError: () => setFailure(null),
    note,
    setNote,
    canSave,
    saving,
    save,
    kept,
  };
}
