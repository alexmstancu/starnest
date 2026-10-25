import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCandidates, fetchRanking, type Ranking } from "../../api/endpoints";
import type { Idle, Read } from "../../api/read";
import { useRead } from "../../api/useRead";
import { useValueCount } from "../../api/useValueCount";
import type { RouteDefinition } from "../../navigation/routes";
import { EmptyCard, UnlessNothingStored } from "../../shell/EmptyCard";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { NothingSelected } from "../../shell/NothingSelected";
import { UnsetSetting } from "../../shell/UnsetSetting";
import { isUnsetSetting } from "../../shell/unsetStates";
import { type FocusRegion, useFocusRegion, useFocusWhenLost } from "../../shell/useFocusWhenLost";
import { AttributeDrillDown } from "./AttributeDrillDown";
import { CandidateDetail } from "./CandidateDetail";
import { RankingMeta, RankingTable } from "./RankingTable";
import { codesByCandidate, type HomeRead } from "./rankTable";
import { useHome } from "./useHome";
import { SaveControl } from "./SaveControl";
import { useOpenRows } from "./useOpenRows";
import { addressNoticeWords, useAddressedRow } from "./useAddressedRow";
import { SavedRankingsPanel } from "./SavedRankingsPanel";
import { useSelection } from "../../shell/SelectionContext";

/**
 * The ranking table: every candidate the selected criteria set was run against, with its
 * score, its coverage and its match status.
 *
 * **Every figure on this screen came from `GET /v1/rankings`.** Nothing is computed here, and
 * the ranking is never re-sorted: its order, the ranks, the scores and the coverage percentages
 * are the server's, and the interface's whole job is to print them without changing what they
 * mean. (A candidate's drill-down does order its evidence rows, by the catalog's pillar order
 * and names -- `drillRows.ts` -- which is a layout of the figures, not a ranking of anything.)
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
  // Read once for both tables: the live ranking and a saved one take Δ home against the same
  // household, and opening a saved ranking must not read it again.
  const home = useHome();
  const focusRegion = useFocusRegion();

  return (
    // The region a notice inherits focus from, when it replaces a control pressed in here.
    <section className="screen" aria-labelledby="screen-heading" onFocus={focusRegion.claim}>
      {/* Keyed by the selection, so each ranking is read afresh. **What the reader has open is
          not held here** (PL-016): it lives above the routes, survives a criteria-set switch
          (P1-20) and is reset by a level change, where a panel for Portugal would sit under a
          table of cities with no row to close it (P53). */}
      <TheRanking
        key={`${criteriaSetId}-${levelId}`}
        label={route.label}
        criteriaSetId={criteriaSetId}
        levelId={levelId}
        home={home}
        focusRegion={focusRegion}
      />

      {/* **Outside the key, deliberately.** A ranking is arithmetic over stored values,
          recomputed on every request, so keeping one has to be a deliberate act -- but the
          list of what has been kept is not about the current selection. `GET /evaluations`
          takes no filter, and remounting this with the table would re-fetch the same list
          every time a criteria set is switched. */}
      {/* Only when one has been opened from the sidebar; nothing otherwise. */}
      <SavedRankingsPanel home={home} />
    </section>
  );
}

function TheRanking({
  label,
  criteriaSetId,
  levelId,
  home,
  focusRegion,
}: {
  label: string;
  criteriaSetId: string | null;
  levelId: string | null;
  home: HomeRead;
  focusRegion: FocusRegion;
}) {
  const { acquisitionsEnded, lastEndedRun, criteriaSets } = useSelection();
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<Ranking> => {
      // Not reachable while disabled; the guard is here so the type is honest.
      if (!criteriaSetId || !levelId) throw new Error("no selection");
      return fetchRanking(criteriaSetId, levelId, { signal });
    },
    [criteriaSetId, levelId],
  );
  // **Read again when an acquisition ends** (UI-11), keeping the table on screen meanwhile
  // (PL-010): new figures make it stale, and a ranking is arithmetic over stored figures.
  const ranking = useRead(fetcher, {
    enabled: criteriaSetId !== null && levelId !== null,
    freshness: acquisitionsEnded,
  });
  const readAgain = useReadAgainAnnouncement(ranking.read, acquisitionsEnded, lastEndedRun);
  // **Nothing stored, nothing to rank** (PL-011): every candidate would read No score.
  const stored = useValueCount(acquisitionsEnded);
  const nothingStored = stored.read.state === "ready" && stored.read.data === 0;

  // The roster, for the flag beside each name and the total the attribute panel counts
  // against. One read, and only once a level is chosen. **A failure is silence here**: a row
  // without its flag and a count without its total claim nothing, and the sidebar says why.
  const roster = useRead(
    useCallback(
      (signal: AbortSignal) =>
        fetchCandidates(levelId ?? undefined, { signal }),
      [levelId],
    ),
    { enabled: levelId !== null },
  );
  const candidates = roster.read.state === "ready" ? roster.read.data.items : null;
  const codes = codesByCandidate(candidates);
  const setNames = new Map(criteriaSets.map((set) => [set.id, set.name]));
  const { open, toggle, choose, openAt } = useOpenRows();

  // **A setting nobody has decided is not a fault, and it is the whole screen** (PL-005): a
  // score has no meaning without a top of the range, so a fresh installation ranks nothing --
  // and that is the state to explain, said first and alone, whether the first read said it or
  // a read since did.
  const unset = unsetRefusal(ranking.read);
  const drawn = ranking.read.state === "ready" && unset === null ? ranking.read.data : null;
  // Once the ranking has answered, a read of it again does not take the attribute panel away:
  // remounted, its own reads would be answered, and every answer re-asks a ranking the server
  // did not answer (PL-002) -- a loop.
  const [answeredOnce, setAnsweredOnce] = useState(false);
  if (!answeredOnce && ranking.read.state !== "pending") setAnsweredOnce(true);
  // A candidate and pillar the address names (PL-084), opened once this ranking holds them.
  const addressed = useAddressedRow(drawn, openAt);
  const rosterNames = new Map((candidates ?? []).map((each) => [each.id, each.name]));

  return (
    <>
      {/* **The title and the provenance on one line.** Which criteria set, which level and
          when it was computed are what make a ranking a particular ranking rather than
          "the ranking" -- so they belong beside its name, not in a caption under the table
          somebody has already started reading. */}
      <header className="screen__header screen__header--split">
        <div className="screen__titles">
          <h1 id="screen-heading" className="screen__heading">
            {label}
          </h1>
          <p className="screen__summary">
            The ranking table, the non-matching rows, and every value behind a
            score.
          </p>
        </div>
        <div className="screen__actions">
          {drawn !== null && !nothingStored && <RankingMeta ranking={drawn} sets={setNames} />}
          {/* **In the header, beside what identifies the ranking.** Saving is an act about
              the whole ranking rather than about anything under the table, and a control for
              it below 32 rows is a control nobody finds. */}
          {drawn !== null && !nothingStored && (
            <SaveControl
              criteriaSetId={criteriaSetId}
              levelId={levelId}
              ranked={drawn.candidates.length}
            />
          )}
        </div>
      </header>

      {/* **Polite, and always there** (PL-015): rows may have moved under the reader, so the
          re-read is said, once it has landed. */}
      <p className="visually-hidden" role="status">
        {readAgain}
      </p>

      {ranking.read.state === "idle" ? (
        <NothingSelected
          toSee="to see the ranking"
          skeleton="rank-table"
          takesFocusFrom={focusRegion}
        />
      ) : (
        <UnlessNothingStored
          stored={stored.read}
          onRetry={stored.reload}
          card={<NothingToRankYet />}
        >
          {unset !== null ? (
            <NoRanking error={unset} region={focusRegion} />
          ) : (
            <>
              <p className="rank-address" role="status">
                {addressed.notice !== null && addressNoticeWords(addressed.notice, rosterNames)}
              </p>
              <LoadedRegion
                read={ranking.read}
                what="The ranking"
                skeleton="rank-table"
                onRetry={ranking.reload}
                // In place of a Try again that read the selection again (NothingSelected).
                takesFocusFrom={focusRegion}
              >
                {(data) => (
                  <RankingTable
                    ranking={data}
                    open={open}
                    onToggle={toggle}
                    codes={codes}
                    household={home}
                    onChoosePillar={choose}
                    arrivedAt={addressed.arrivedAt}
                    onArrived={addressed.arrived}
                    detail={(row) => (
                      <CandidateDetail
                        candidate={row.candidate}
                        name={row.name}
                        pillars={row.pillars}
                        scaleMax={data.score_scale_max}
                        chosen={row.chosenPillar ?? null}
                        onChoose={(pillar) => choose(row, pillar)}
                      />
                    )}
                  />
                )}
              </LoadedRegion>

              {/* The other axis (`reqs.md` 8.4). A candidate's detail says what we know about one
                  country; this says who has a figure for one attribute at all -- the question
                  behind a pillar that scores badly for want of data rather than for want of merit.
                  **Not before the ranking has answered**, which may yet say there is no ranking. */}
              {answeredOnce && (
                <AttributeDrillDown
                  levelId={levelId}
                  criteriaSetId={criteriaSetId}
                  rosterSize={candidates?.length}
                />
              )}
            </>
          )}
        </UnlessNothingStored>
      )}
    </>
  );
}

/**
 * "The ranking was read again after acquisition N ended." -- said once the ranking a run's end
 * made stale has been read again, never for the first read, and not for a re-read that failed:
 * the stale line says that one.
 */
function useReadAgainAnnouncement(
  read: Read<Ranking> | Idle,
  acquisitionsEnded: number,
  lastEndedRun: number | null,
): string {
  const [said, setSaid] = useState("");
  const announced = useRef(acquisitionsEnded);
  const landed = read.state === "ready" && read.refresh === "idle";
  useEffect(() => {
    if (!landed || announced.current === acquisitionsEnded) return;
    announced.current = acquisitionsEnded;
    setSaid(
      lastEndedRun === null
        ? "The ranking was read again after an acquisition ended."
        : `The ranking was read again after acquisition ${String(lastEndedRun)} ended.`,
    );
  }, [landed, acquisitionsEnded, lastEndedRun]);
  return said;
}

/** A database nothing has been acquired into (PL-011): Acquire is what fills it. */
function NothingToRankYet() {
  return (
    <EmptyCard
      title="Nothing to rank yet"
      detail={
        "No values have been acquired, so every candidate would read No score. A ranking " +
        "built on nothing would look like an answer and mean nothing."
      }
      action={
        <Link className="button button--primary" to="/acquire">
          Go to Acquire
        </Link>
      }
    />
  );
}

/**
 * "No ranking", in place of everything the ranking would have drawn. **When it replaces a
 * control the reader pressed** -- Try again, or a row's toggle under a ranking read again --
 * it takes the focus that control had; drawn by the first read, before anything was pressed,
 * it takes none.
 */
function NoRanking({ error, region }: { error: unknown; region: FocusRegion }) {
  const notice = useFocusWhenLost<HTMLDivElement>(region);
  return (
    <div ref={notice} tabIndex={-1}>
      <UnsetSetting error={error} title="No ranking" detail={UNSET_DETAIL} />
    </div>
  );
}

const UNSET_DETAIL =
  "A score has no meaning without a top of the range, so nothing is scored and nothing is ranked. This is an unset setting rather than a fault — set the top of the score range and the ranking returns.";

/** The refusal of a setting nobody decided, first read or read again; null for anything else. */
function unsetRefusal(read: Read<Ranking> | Idle): unknown {
  const error =
    read.state === "failed"
      ? read.error
      : read.state === "ready" && typeof read.refresh === "object"
        ? read.refresh.failed
        : null;
  return error !== null && isUnsetSetting(error) ? error : null;
}
