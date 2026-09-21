import { useCallback, useState } from "react";
import { fetchEvaluations, saveEvaluation } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { newestFirst } from "./savedRankings";

/**
 * What the saved-rankings panel knows, kept out of its markup.
 *
 * React's own answer -- a custom hook beside the component -- rather than the older
 * container/presentational split (`CLAUDE.md`).
 */
export function useSavedRankings(
  criteriaSetId: string | null,
  levelId: string | null,
) {
  const list = useResource(
    useCallback((signal: AbortSignal) => fetchEvaluations({ signal }), []),
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const saved =
    list.resource.status === "ready" ? newestFirst(list.resource.data.items) : [];

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
      // Re-read rather than pushing the answer onto the list: the server decides what a saved
      // ranking is, including the moment it was computed.
      list.reload();
    } catch (error) {
      setFailure(error);
    } finally {
      setSaving(false);
    }
  }, [criteriaSetId, levelId, note, list]);

  return {
    status: list.resource.status,
    error: list.resource.status === "error" ? list.resource.error : failure,
    reload: list.reload,
    saved,
    note,
    setNote,
    canSave,
    saving,
    save,
  };
}
