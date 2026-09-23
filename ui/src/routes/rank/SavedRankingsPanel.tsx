import { useId } from "react";
import { useSearchParams } from "react-router-dom";
import { requestedSavedRanking } from "../../format/savedRanking";
import { SavedRankingView } from "./SavedRankingView";

/**
 * The saved ranking somebody opened, and nothing when nobody has.
 *
 * **The three parts of keeping a ranking live in three places, and each is where it belongs.**
 * Saving one is an act about the ranking in front of you, so it sits in that ranking's header;
 * the list of what has been kept is about the whole session, so it sits in the sidebar, in
 * reach from Configure while a weight is being moved; and the one you opened is a thing to
 * look at, so it appears here, under the live table it is being compared against.
 *
 * **Opening a saved ranking shows it. It does not restore it.** The design's prototype
 * treated one as a weight vector to load back, which would overwrite whatever criteria set is
 * being worked on -- the very thing the design's own round-2 review flags as the most
 * destructive unrecorded action (R6). Our contract makes a better answer available: an
 * evaluation freezes the criteria *and* the score scale it used, and reads back as a whole
 * ranking, so there is a real thing to look at and nothing has to be overwritten to see it.
 */
export function SavedRankingsPanel() {
  const headingId = useId();

  // **Which one is open lives in the address, not in a hook.** The sidebar lists the same
  // saved rankings and links here with the one that was clicked, so "open" has to be
  // something a link can say. It also survives a reload, which local state does not.
  const [parameters, setParameters] = useSearchParams();
  const open = requestedSavedRanking(parameters.get("saved"));
  if (open === null) return null;

  const close = () => {
    const next = new URLSearchParams(parameters);
    next.delete("saved");
    setParameters(next, { replace: true });
  };

  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel__head">
        <h3 id={headingId} className="panel__heading">
          A saved ranking
        </h3>
        <button type="button" className="action" onClick={close}>
          Close
        </button>
      </div>
      <SavedRankingView evaluationId={open} />
    </section>
  );
}
