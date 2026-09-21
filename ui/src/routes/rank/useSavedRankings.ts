import { useCallback, useState } from "react";
import { saveEvaluation } from "../../api/endpoints";
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

  // A ranking is saved for a criteria set at a level, so with no selection there is nothing
  // to save -- not an empty one.
  const canSave = criteriaSetId !== null && levelId !== null && !saving;

  const save = useCallback(async () => {
    if (criteriaSetId === null || levelId === null) return;
    setSaving(true);
    setFailure(null);
    try {
      await saveEvaluation(criteriaSetId, levelId, note);
      setNote("");
      // The server decides what a saved ranking is, including the moment it was computed, so
      // the sidebar re-reads rather than being handed this answer to push onto its list.
      noteSavedRanking();
    } catch (error) {
      setFailure(error);
    } finally {
      setSaving(false);
    }
  }, [criteriaSetId, levelId, note, noteSavedRanking]);

  return {
    error: failure,
    /** Clearing the failure is the retry: the save button is still there to press again. */
    reload: () => setFailure(null),
    note,
    setNote,
    canSave,
    saving,
    save,
  };
}
