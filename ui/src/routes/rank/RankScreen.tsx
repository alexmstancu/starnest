import { useCallback, useState } from "react";
import { fetchRanking, type Ranking } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import type { RouteDefinition } from "../../navigation/routes";
import { UnsetSetting } from "../../shell/UnsetSetting";
import { AttributeDrillDown } from "./AttributeDrillDown";
import { CandidateDetail } from "./CandidateDetail";
import { type OpenRow, toggleRow } from "./openRows";
import { RankingMeta, RankingTable } from "./RankingTable";
import { SaveControl } from "./SaveControl";
import { SavedRankingsPanel } from "./SavedRankingsPanel";
import { useSelection } from "../../shell/SelectionContext";

/**
 * The ranking table: every candidate the selected criteria set was run against, with its
 * score, its coverage and its match status.
 *
 * **Every figure on this screen came from `GET /v1/rankings`.** Nothing is computed here, not
 * even a re-sort: the order, the ranks, the scores and the coverage percentages are the
 * server's, and the interface's whole job is to print them without changing what they mean.
 *
 * Two rules from `reqs.md` shape what it shows, and they are the reason the screen exists:
 *
 * 1. **Non-matching candidates stay visible, keeping their score, with the reason shown**
 *    (5.4). Filtering them out would hide exactly what a rule is costing you.
 * 2. **A candidate with insufficient data shows no number** (5.3). Not a zero, not a rounded
 *    guess -- its coverage is shown instead, because coverage is what explains the status.
 */
export function RankScreen({ route }: { route: RouteDefinition }) {
  const { criteriaSetId, levelId } = useSelection();

  return (
    <section className="screen" aria-labelledby="screen-heading">
      {/* Keyed by the selection, the way `ConfigureScreen` keys its panels: the open
          drill-down is state about *this* ranking, and a switch of level or criteria set
          makes it state about a ranking nobody is looking at (P53). It used to survive the
          switch -- a provenance panel for Portugal sitting under a table of cities, with no
          row matching it, so no button read "Hide figures" and nothing could close it. A
          key rather than an effect, because React resets state on identity and clearing it
          from an effect is a render the screen does not need. */}
      <TheRanking
        key={`${criteriaSetId}-${levelId}`}
        label={route.label}
        criteriaSetId={criteriaSetId}
        levelId={levelId}
      />

      {/* **Outside the key, deliberately.** A ranking is arithmetic over stored values,
          recomputed on every request, so keeping one has to be a deliberate act -- but the
          list of what has been kept is not about the current selection. `GET /evaluations`
          takes no filter, and remounting this with the table would re-fetch the same list
          every time a criteria set is switched. */}
      {/* Only when one has been opened from the sidebar; nothing otherwise. */}
      <SavedRankingsPanel />
    </section>
  );
}

function TheRanking({
  label,
  criteriaSetId,
  levelId,
}: {
  label: string;
  criteriaSetId: string | null;
  levelId: string | null;
}) {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<Ranking> => {
      // Not reachable while disabled; the guard is here so the type is honest.
      if (!criteriaSetId || !levelId) throw new Error("no selection");
      return fetchRanking(criteriaSetId, levelId, { signal });
    },
    [criteriaSetId, levelId],
  );

  const { resource, reload } = useResource(
    fetcher,
    criteriaSetId !== null && levelId !== null,
  );
  // Which candidates' evidence is open. Client state in the sense `arch.md` 8.1 permits: it
  // decides nothing, and the evidence itself is fetched.
  const [open, setOpen] = useState<readonly OpenRow[]>([]);
  const toggle = useCallback(
    (row: OpenRow) => setOpen((already) => toggleRow(already, row)),
    [],
  );

  return (
    <>
      {/* **The title and the provenance on one line.** Which criteria set, which level and
          when it was computed are what make a ranking a particular ranking rather than
          "the ranking" -- so they belong beside its name, not in a caption under the table
          somebody has already started reading. */}
      <header className="screen__header screen__header--split">
        <div className="screen__titles">
          <h2 id="screen-heading" className="screen__heading">
            {label}
          </h2>
          <p className="screen__summary">
            The ranking table, the non-matching rows, and every value behind a
            score.
          </p>
        </div>
        <div className="screen__actions">
          {resource.status === "ready" && <RankingMeta ranking={resource.data} />}
          {/* **In the header, beside what identifies the ranking.** Saving is an act about
              the whole ranking rather than about anything under the table, and a control for
              it below 32 rows is a control nobody finds. */}
          <SaveControl criteriaSetId={criteriaSetId} levelId={levelId} />
        </div>
      </header>

      {resource.status === "idle" && (
        <p className="screen__note">
          Choose a criteria set and a level to see the ranking.
        </p>
      )}
      {resource.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}
      {/* **A setting nobody has decided is not a fault.** A score has no meaning without a
          top of the range, so a fresh installation ranks nothing -- and that is the state to
          explain, not an error to report. */}
      {resource.status === "error" && (
        <UnsetSetting
          error={resource.error}
          title="No ranking"
          detail="A score has no meaning without a top of the range, so nothing is scored and nothing is ranked. This is an unset setting rather than a fault — set the top of the score range and the ranking returns."
          onRetry={reload}
        />
      )}
      {resource.status === "ready" && (
        <RankingTable
          ranking={resource.data}
          open={open}
          onToggle={toggle}
          detail={(row) => (
            <CandidateDetail
              candidate={row.candidate}
              name={row.name}
              pillars={row.pillars}
            />
          )}
        />
      )}

      {/* The other axis (`reqs.md` 8.4). A candidate's detail says what we know about one
          country; this says who has a figure for one attribute at all -- the question behind a
          pillar that scores badly for want of data rather than for want of merit. */}
      <AttributeDrillDown levelId={levelId} />

    </>
  );
}
