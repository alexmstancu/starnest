import { useId, useState } from "react";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { SavedRankingView } from "./SavedRankingView";
import { describeSaved, detailOf } from "./savedRankings";
import { useSavedRankings } from "./useSavedRankings";

/**
 * Rankings kept on purpose, and the control that keeps one.
 *
 * **`GET /rankings` computes and stores nothing.** That is what makes re-weighting instant,
 * and it is why saving has to be a deliberate act rather than a side effect of looking. The
 * live ranking moves under you as you change a weight; a saved one does not.
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
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h3 id={headingId} className="panel__heading">
        Saved rankings
      </h3>

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

      {saved.status === "loading" && <p className="screen__note">Loading…</p>}

      {saved.status === "ready" && saved.saved.length === 0 && (
        <p className="screen__note">
          No ranking has been saved yet. The live ranking recomputes every time
          a weight moves, so nothing is kept until you keep it.
        </p>
      )}

      {saved.saved.length > 0 && (
        <ul className="saved__list">
          {saved.saved.map((entry) => (
            <li key={entry.id} className="saved__entry">
              <button
                type="button"
                className={
                  open === entry.id ? "button button--current" : "button"
                }
                onClick={() => setOpen(open === entry.id ? null : entry.id)}
              >
                {open === entry.id ? "Hide" : "Open"}
              </button>
              <span className="saved__name">{describeSaved(entry)}</span>
              <span className="saved__detail">{detailOf(entry)}</span>
            </li>
          ))}
        </ul>
      )}

      {open !== null && <SavedRankingView evaluationId={open} />}
    </section>
  );
}
