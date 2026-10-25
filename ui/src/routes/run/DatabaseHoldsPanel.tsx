import { useCallback } from "react";
import {
  fetchRanking,
  fetchSettings,
  type Holdings,
  type Run,
} from "../../api/endpoints";
import { combine, type Idle, type Read } from "../../api/read";
import { useRead } from "../../api/useRead";
import { formatDateTime } from "../../format/display";
import { noRankingBecause, tallyMatchStatus } from "../../shell/candidateCounts";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { useSelection } from "../../shell/SelectionContext";
import { alwaysAsked } from "./alwaysAsked";
import {
  holdingsFigures,
  lastFilledBy,
  runningNow,
  scoredFigure,
  type Tile,
} from "./databaseHolds";
import { useVersionOf } from "./useVersionOf";

/**
 * What the database holds, at the top of Acquire.
 *
 * **The screen opens with what is already known.** Every other section here is about changing
 * that -- retrying what broke, asking again about what nobody answered, refreshing what has
 * aged -- and none of them mean anything without the number they would change. The design
 * leads with this for that reason, and so does this.
 *
 * **Database facts, never one acquisition's accounting** (PL-051). Values stored, values past
 * their allowed age and this month's spend -- runs and gate research together (PL-052) -- come
 * whole from the holdings read; candidates scored is the ranking's tally, counted as the
 * sidebar counts it (C04-N4). Opening, dismissing or retrying a run moves none of them.
 *
 * **Every figure waits for the read it comes from** (PL-001). A read still on its way is a
 * skeleton, and one that never came is said to have failed -- never "0 of 0", never "no cap is
 * set". Read again, the figures stay, marked busy (PL-010).
 */
export function DatabaseHoldsPanel({
  history,
  holdings,
  onRetryHistory,
  onRetryHoldings,
}: {
  history: Read<readonly Run[]>;
  holdings: Read<Holdings> | Idle;
  onRetryHistory: () => Promise<void>;
  onRetryHoldings: () => Promise<void>;
}) {
  return (
    <section className="panel" aria-labelledby="database-holds">
      <div className="panel__head">
        <h2 id="database-holds" className="panel__heading">
          What the database holds
        </h2>
      </div>
      {/* The screen's one full card when the history cannot be read (P1-06): every other
          region on Acquire that fails with it says so in a line. */}
      <LoadedRegion
        read={history}
        what="The acquisition history"
        skeleton="lines"
        onRetry={onRetryHistory}
      >
        {(runs) => <LastAcquisitions runs={runs} />}
      </LoadedRegion>
      {holdings.state === "idle" ? (
        <p className="panel__hint">Choose a level to see what the database holds.</p>
      ) : (
        <Figures holdings={holdings} onRetryHoldings={onRetryHoldings} />
      )}
    </section>
  );
}

function LastAcquisitions({ runs }: { runs: readonly Run[] }) {
  const newest = lastFilledBy(runs);
  const running = runningNow(runs);
  return (
    <dl className="meta-row">
      <Meta
        label="Last filled by"
        value={newest === undefined ? "Nothing yet" : `Acquisition ${newest.id}`}
      />
      <Meta
        label="Finished"
        value={newest?.finished_at == null ? "—" : formatDateTime(newest.finished_at)}
      />
      {/* **One at a time**, which the API enforces rather than this screen: starting a
          second acquisition while one is in flight is refused. */}
      <Meta
        label="Running now"
        value={running === undefined ? "None — one at a time" : `Acquisition ${running.id}`}
      />
    </dl>
  );
}

/**
 * The four figures. Separate from the panel because the settings -- for the cap's caption --
 * are read only once there is a level to read holdings at.
 */
function Figures({
  holdings,
  onRetryHoldings,
}: {
  holdings: Read<Holdings>;
  onRetryHoldings: () => Promise<void>;
}) {
  const settings = useRead(
    useCallback((signal: AbortSignal) => fetchSettings({ signal }), []),
  );
  return (
    <LoadedRegion
      read={combine(holdings, alwaysAsked(settings.read))}
      what="What the database holds"
      skeleton="acquire-stats"
      prominence="region"
      onRetry={async () => {
        await Promise.all([onRetryHoldings(), settings.reload()]);
      }}
    >
      {([held, { run_spend_cap_eur: cap }]) => {
        const { stored, aged, spent } = holdingsFigures(held, cap);
        return (
          <div className="big-stats">
            <BigStat {...stored} />
            <ScoredStat holdings={held} />
            <BigStat {...aged} />
            <BigStat {...spent} />
          </div>
        );
      }}
    </LoadedRegion>
  );
}

/**
 * How many candidates the active set scores, from the ranking the sidebar tallies (C04-N4), so
 * the two can never disagree. Read again when the holdings are, since what is stored moved.
 */
function ScoredStat({ holdings }: { holdings: Holdings }) {
  const { criteriaSetId, criteriaSets } = useSelection();
  const level = holdings.level;
  // Each new answer of the holdings is a new object, so a re-read of them reads this again.
  const freshness = useVersionOf(holdings);
  const ranking = useRead(
    useCallback(
      async (signal: AbortSignal) => {
        // Not reachable while disabled; the guard is here so the type is honest.
        if (criteriaSetId === null) throw new Error("no criteria set");
        return tallyMatchStatus((await fetchRanking(criteriaSetId, level, { signal })).candidates);
      },
      [criteriaSetId, level],
    ),
    { enabled: criteriaSetId !== null, freshness },
  );
  const label = "Candidates scored";
  if (ranking.read.state === "idle") {
    return <BigStat label={label} value="—" note="choose a criteria set to score candidates" />;
  }
  // A ranking refused by design -- the score range unset -- is a state to say, not a fault.
  const unranked = ranking.read.state === "failed" ? noRankingBecause(ranking.read.error) : null;
  if (unranked !== null) return <BigStat label={label} value="—" note={unranked} />;
  const setName =
    criteriaSets.find((set) => set.id === criteriaSetId)?.name ?? criteriaSetId ?? "";
  return (
    <LoadedRegion
      read={ranking.read}
      what="Candidates scored"
      skeleton="lines"
      prominence="region"
      onRetry={ranking.reload}
    >
      {(counts) => <BigStat {...scoredFigure(counts, setName)} />}
    </LoadedRegion>
  );
}

function BigStat({ label, value, note, tone }: Tile) {
  return (
    <div className={tone ? `big-stat big-stat--${tone}` : "big-stat"}>
      <span className="big-stat__label">{label}</span>
      <span className="big-stat__value">{value}</span>
      <span className="big-stat__note">{note}</span>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-row__item">
      <dt className="meta-row__label">{label}</dt>
      <dd className="meta-row__value">{value}</dd>
    </div>
  );
}
