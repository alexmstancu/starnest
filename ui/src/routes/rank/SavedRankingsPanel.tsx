import { useId } from "react";
import { useSearchParams } from "react-router-dom";
import { requestedSavedRanking } from "../../format/savedRanking";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { SavedRankingView } from "./SavedRankingView";
import { useSavedRankings } from "./useSavedRankings";

/**
 * Keeping a ranking, and looking at one that was kept.
 *
 * **`GET /rankings` computes and stores nothing.** That is what makes re-weighting instant,
 * and it is why saving has to be a deliberate act rather than a side effect of looking. The
 * live ranking moves under you as you change a weight; a saved one does not.
 *
 * **The list of what has been kept lives in the sidebar**, where the design puts it: a saved
 * ranking is about the whole session rather than about the screen that happened to make one,
 * and it has to be reachable from Configure while a weight is being moved. This screen owns
 * the two things that are about the ranking in front of you -- saving it, and showing the one
 * the sidebar opened.
 *
 * **Opening a saved ranking shows it. It does not restore it.** The design's prototype
 * treated a saved ranking as a weight vector to load back, which would overwrite whatever
 * criteria set is being worked on -- the very thing the design's own round-2 review flags as
 * the most destructive unrecorded action (R6). Our contract makes a better answer available:
 * an evaluation freezes the criteria *and* the score scale it used, and reads back as a whole
 * ranking, so there is a real thing to look at and nothing has to be overwritten to see it.
 */
export function SavedRankingsPanel({
  criteriaSetId,
  levelId,
}: {
  criteriaSetId: string | null;
  levelId: string | null;
}) {
  const headingId = useId();
  const noteId = useId();
  const saved = useSavedRankings(criteriaSetId, levelId);

  // **Which one is open lives in the address, not in a hook.** The sidebar lists the same
  // saved rankings and links here with the one that was clicked, so "open" has to be
  // something a link can say. It also survives a reload, which local state does not.
  const [parameters, setParameters] = useSearchParams();
  const open = requestedSavedRanking(parameters.get("saved"));
  const close = () => {
    const next = new URLSearchParams(parameters);
    next.delete("saved");
    setParameters(next, { replace: true });
  };

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h3 id={headingId} className="panel__heading">
        Save this ranking
      </h3>
      <p className="panel__hint">
        Nothing is kept until you save it. A saved ranking freezes the criteria
        and the score scale it used, so it still means what it meant however the
        weights move afterwards. Saved ones are listed in the sidebar.
      </p>

      <div className="saved__save">
        <label className="field__label" htmlFor={noteId}>
          Why this one is worth keeping
        </label>
        <input
          id={noteId}
          className="field__control"
          type="text"
          value={saved.note}
          placeholder="Optional"
          onChange={(event) => saved.setNote(event.target.value)}
        />
        <button
          type="button"
          className="button button--primary"
          disabled={!saved.canSave}
          onClick={() => void saved.save()}
        >
          {saved.saving ? "Saving…" : "Save this ranking"}
        </button>
      </div>

      {saved.error != null && (
        <ErrorNotice error={saved.error} onRetry={saved.reload} />
      )}

      {open !== null && (
        <>
          <button type="button" className="button" onClick={close}>
            Close this saved ranking
          </button>
          <SavedRankingView evaluationId={open} />
        </>
      )}
    </section>
  );
}
