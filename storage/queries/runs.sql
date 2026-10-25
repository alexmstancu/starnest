-- RunStore (arch.md 6.3): create a run with its planned scope, append what each item produced,
-- and read status, cost, progress and failures back. It also keeps the gate-research spend
-- ledger (BE-34): research spends money and is not a run, so its bill is kept beside the runs'.
--
-- A run is one programmatic pass that fetches from sources and writes value rows -- nothing
-- else is a run (reqs.md 3.8). The values themselves are appended through values.sql carrying
-- this run's id; nothing in this file writes a value, because a run is the occasion for a write
-- and not the owner of one.
--
-- The scope stored here is PLANNED, not achieved. Deriving it from the values a run wrote would
-- report an empty scope for a run that failed entirely, which is exactly the case where the
-- scope matters most: selective retry and the dry-run estimate both need to know what was meant
-- to happen.
--
-- "Null means every candidate at the level" is a shape the contract accepts and this file does
-- not: the planner expands it into rows before the run starts, so the scope on disk is always
-- explicit. A run whose scope rows were never written reports no planned work, which is honest
-- and visibly wrong rather than quietly approximate.

-- name: insert_run(started_at, triggered_by, run_status, level, plan_recorded_at, estimate_ceiling_eur, spend_cap_eur, accepted_uncapped)<!
-- Open a run. It starts `running` and with zero spend; both are advanced by the statements
-- below as the work proceeds, so a run being watched shows real progress rather than a status
-- that jumps at the end. Its ceiling, cap and uncapped acceptance are recorded as they stand now
-- (0512, D17): all null, with plan_recorded_at, only for a run recorded the old way.
INSERT INTO data_acquisition_run (started_at, triggered_by, run_status, level,
                                  plan_recorded_at, estimate_ceiling_eur, spend_cap_eur,
                                  accepted_uncapped)
VALUES (:started_at, :triggered_by, :run_status, :level,
        :plan_recorded_at, :estimate_ceiling_eur, :spend_cap_eur, :accepted_uncapped)
RETURNING id;

-- name: insert_run_candidates(data_acquisition_run, candidates)!
-- The candidates the run means to cover. ON CONFLICT DO NOTHING so a scope assembled from two
-- overlapping sources -- a retry of two failed items on the same candidate, say -- does not
-- have to be deduplicated by the caller first.
INSERT INTO data_acquisition_run_candidate (data_acquisition_run, candidate)
SELECT :data_acquisition_run, candidate
FROM   unnest(:candidates::text[]) AS candidate
ON CONFLICT DO NOTHING;

-- name: insert_run_attributes(data_acquisition_run, attributes)!
INSERT INTO data_acquisition_run_attribute (data_acquisition_run, attribute)
SELECT :data_acquisition_run, attribute
FROM   unnest(:attributes::text[]) AS attribute
ON CONFLICT DO NOTHING;

-- name: insert_run_items_as_rectangle(data_acquisition_run)!
-- A sweep asks about every candidate crossed with every attribute, so its items are that
-- rectangle (BE-11). Run after the two scope lists are written, from which it reads -- so the
-- caller resolves the scope once and this derives the pairs rather than being handed them.
INSERT INTO data_acquisition_run_item (data_acquisition_run, candidate, attribute)
SELECT c.data_acquisition_run, c.candidate, a.attribute
FROM   data_acquisition_run_candidate AS c
JOIN   data_acquisition_run_attribute AS a
       ON a.data_acquisition_run = c.data_acquisition_run
WHERE  c.data_acquisition_run = :data_acquisition_run
ON CONFLICT DO NOTHING;

-- name: insert_run_items(data_acquisition_run, pairs)!
-- The exact (candidate, attribute) pairs a retry asks about -- a subset of the rectangle its two
-- scope lists would span, so the corners no source is asked about are never recorded and so never
-- counted unanswered (BE-11). Idempotent on the pair, like the scope lists above.
INSERT INTO data_acquisition_run_item (data_acquisition_run, candidate, attribute)
SELECT :data_acquisition_run, pair.candidate, pair.attribute
FROM   jsonb_to_recordset(:pairs::jsonb) AS pair(candidate text, attribute text)
ON CONFLICT DO NOTHING;

-- name: insert_run_plan(data_acquisition_run, planned)!
-- What each source will be asked, per attribute, written with the scope in the run's opening
-- transaction (0512, C04-N6). Each row starts unfinished; mark_run_plan_asked finishes it.
INSERT INTO data_acquisition_run_plan (data_acquisition_run, data_source, attribute, items_planned)
SELECT :data_acquisition_run, planned.data_source, planned.attribute, planned.items_planned
FROM   jsonb_to_recordset(:planned::jsonb)
           AS planned(data_source text, attribute text, items_planned integer);

-- name: mark_run_plan_asked(data_acquisition_run, data_source, attribute, finished_at)!
-- A source has been asked about an attribute to its last batch. The first mark stands: a second
-- adapter of the same source finishing later does not move it.
UPDATE data_acquisition_run_plan
SET    finished_at = COALESCE(finished_at, :finished_at)
WHERE  data_acquisition_run = :data_acquisition_run
  AND  data_source = :data_source
  AND  attribute = :attribute;

-- name: update_run_status(data_acquisition_run, run_status, finished_at)!
-- Close a run, or move it to halted_on_spend_cap. finished_at is the caller's clock rather than
-- now(), so a run's duration is testable without waiting (arch.md 6.3, Clock).
UPDATE data_acquisition_run
SET    run_status  = :run_status,
       finished_at = :finished_at
WHERE  id = :data_acquisition_run;

-- name: add_run_spend(data_acquisition_run, llm_call_count, cost_eur)<!
-- Accrue what a completed call cost, and return the running totals.
--
-- An increment rather than a write of the total, because two adapters may be in flight at once
-- and a read-modify-write would lose one of their costs. The totals come back so the caller can
-- compare them against the spend cap and halt without a second read -- the cap is a stop, and a
-- stop decided from a stale number is not a cap.
UPDATE data_acquisition_run
SET    llm_call_count = llm_call_count + :llm_call_count,
       cost_eur       = cost_eur + :cost_eur
WHERE  id = :data_acquisition_run
RETURNING llm_call_count, cost_eur;

-- name: upsert_run_failure(data_acquisition_run, data_source, candidate, attribute, error_message)!
-- One failure per source per item per run. A run continues past a failure (reqs.md 6.4), and
-- a source asked about one candidate's attribute is exactly the unit selective retry needs
-- (0461): asking OECD again is a different act from asking the estimate again.
--
-- Upsert rather than insert because an item may be attempted more than once within a run --
-- the retry-with-backoff of arch.md 5.3 -- and the failure that matters is the last one, not a
-- pile of identical rows.
INSERT INTO data_acquisition_failure
       (data_acquisition_run, data_source, candidate, attribute, error_message)
VALUES (:data_acquisition_run, :data_source, :candidate, :attribute, :error_message)
ON CONFLICT (data_acquisition_run, data_source, candidate, attribute) DO UPDATE
SET error_message = EXCLUDED.error_message;

-- name: clear_run_failure(data_acquisition_run, data_source, candidate, attribute)!
-- An item that failed and then succeeded from the same source on a later attempt inside the
-- same run is not a failure of that run. Retry across runs never uses this: a retry is a NEW run
-- whose scope is the old one's failures (openapi.yaml), and the old run keeps its record of what
-- went wrong.
DELETE FROM data_acquisition_failure
WHERE  data_acquisition_run = :data_acquisition_run
  AND  data_source = :data_source
  AND  candidate = :candidate
  AND  attribute = :attribute;

-- name: insert_run_reuse(data_acquisition_run, data_source, pairs)!
-- Record the (candidate, attribute) pairs a run re-confirmed from a source that answered but
-- stored no new row -- a transcribed table re-read as the same observation (ST-09). The
-- accounting reads these so the pair counts completed rather than unanswered, and the breakdown
-- credits the source named here (NEW-54). Idempotent: a pair one source re-confirmed twice in
-- one run is the one row the primary key allows. Each pair names the stored row it restated, or
-- null where that is not one row (PL-049), so the diff can show the figure the run produced.
-- **A later batch merges rather than being skipped**: a pair restated through two different rows,
-- or once through an unknown one, names none -- the same verdict one batch reaches over the same
-- input -- and the same row twice still names it. One statement, so a racing batch waits on the
-- row and merges with what committed.
INSERT INTO data_acquisition_run_reuse
       (data_acquisition_run, data_source, candidate, attribute, value)
SELECT :data_acquisition_run, :data_source, pair.candidate, pair.attribute, pair.value
FROM   jsonb_to_recordset(:pairs::jsonb) AS pair(candidate text, attribute text, value bigint)
ON CONFLICT ON CONSTRAINT data_acquisition_run_reuse_pkey DO UPDATE
SET    value = CASE WHEN data_acquisition_run_reuse.value = EXCLUDED.value
                    THEN data_acquisition_run_reuse.value END;

-- name: insert_research_spend(match_rule, candidate, data_source, llm_call_count, cost_eur)!
-- What one gate-research call billed (BE-34). Research writes gate answers, not values, so it is
-- not a run (reqs.md 3.8) and its spend has no run row to accrue on; this is its ledger. Written
-- per call as the call returns, so a pass that dies keeps the record of every call it paid for.
-- `researched_at` is the database's clock: the moment the record was kept. The API never reads
-- the rows back; select_holdings serves their monthly sum (C04-N1, revisiting Q236).
INSERT INTO match_rule_research_spend (match_rule, candidate, data_source, llm_call_count, cost_eur)
VALUES (:match_rule, :candidate, :data_source, :llm_call_count, :cost_eur);

-- Reading runs.

-- name: select_runs(limit_rows, offset_rows)
-- The run history, newest first, with what each pass reached.
--
-- The three counts are the same arithmetic select_run does and mean exactly the same thing --
-- see its comment for why items_failed never overlaps items_completed. They are here because a
-- history that lists only status and cost cannot answer "which of these actually filled
-- anything", which is the question a list of past runs exists to answer. Bounded by the page
-- size, so this is a handful of correlated counts and not a scan.
--
-- The scope is summarised rather than listed: it is stored expanded, one row per candidate and
-- one per attribute, and a history row wants its size, not its contents.
--
-- **Only a pair among the run's items counts** (FU-A1), here as in select_run: a row naming any
-- other pair is evidence the run should never have written, and counting it read "3 of 2".
SELECT r.id,
       r.run_status,
       r.triggered_by,
       r.started_at,
       r.finished_at,
       r.llm_call_count,
       r.cost_eur,
       r.level,
       r.stop_requested_at,
       (SELECT count(*) FROM data_acquisition_run_candidate AS scope
        WHERE  scope.data_acquisition_run = r.id) AS scope_candidates,
       (SELECT count(*) FROM data_acquisition_run_attribute AS scope
        WHERE  scope.data_acquisition_run = r.id) AS scope_attributes,
       (SELECT count(*) FROM data_acquisition_run_item AS item
        WHERE  item.data_acquisition_run = r.id) AS items_total,
       (SELECT count(*)
        FROM   (SELECT v.candidate, v.attribute
                FROM   value AS v
                WHERE  v.data_acquisition_run = r.id
                UNION
                SELECT reuse.candidate, reuse.attribute
                FROM   data_acquisition_run_reuse AS reuse
                WHERE  reuse.data_acquisition_run = r.id) AS answered
        WHERE  EXISTS (SELECT 1 FROM data_acquisition_run_item AS item
                       WHERE  item.data_acquisition_run = r.id
                         AND  item.candidate = answered.candidate
                         AND  item.attribute = answered.attribute)) AS items_completed,
       (SELECT count(DISTINCT (f.candidate, f.attribute))
        FROM   data_acquisition_failure AS f
        WHERE  f.data_acquisition_run = r.id
          AND  EXISTS (SELECT 1 FROM data_acquisition_run_item AS item
                       WHERE  item.data_acquisition_run = r.id
                         AND  item.candidate = f.candidate
                         AND  item.attribute = f.attribute)
          AND  NOT EXISTS (SELECT 1 FROM value AS v
                           WHERE  v.data_acquisition_run = r.id
                             AND  v.candidate = f.candidate
                             AND  v.attribute = f.attribute)
          AND  NOT EXISTS (SELECT 1 FROM data_acquisition_run_reuse AS reuse
                           WHERE  reuse.data_acquisition_run = r.id
                             AND  reuse.candidate = f.candidate
                             AND  reuse.attribute = f.attribute)) AS items_failed
FROM   data_acquisition_run AS r
ORDER  BY r.started_at DESC, r.id DESC
LIMIT  :limit_rows OFFSET :offset_rows;

-- name: count_runs()$
-- The `total` beside the page above.
SELECT count(*) FROM data_acquisition_run;

-- name: select_run(data_acquisition_run)^
-- One run with its planned scope, its live progress and the three lists behind it -- what a
-- screen polls while a run is in flight.
--
-- **One statement, so one snapshot** (ST-11). Under READ COMMITTED each statement sees the
-- database as it stood when that statement began, so a count read by one statement and its list
-- read by the next straddled any commit between them: a failure landing there read two
-- unanswered beside a list of one. Every count and list here comes from the same CTEs, so they
-- agree however many connections or processes write while a poll reads (NEW-21).
--
-- **Driven from the run's items** (FU-A1). Every count and list starts at
-- data_acquisition_run_item, so a value, re-confirmation or failure stamped with the run for a
-- pair it never asked about is neither counted nor listed -- a retry's borrow written outside its
-- pairs once read "3 of 2". The answered and failed pairs are sets joined to the items, never a
-- probe per item into `value`, which has no index on a run's pairs.
--
-- items_total counts the items: the rectangle a sweep's scope spans, or the exact pairs a retry
-- asked about (BE-11). items_completed counts the items that produced a value row or were
-- re-confirmed (ST-09), values stored as rejected included: the item was fetched and answered,
-- and whether the answer survived validation is a separate question the value itself records.
--
-- items_failed counts the items some source failed on and NO source answered, so it never
-- overlaps items_completed. Where OECD failed and the estimate answered, the item is complete;
-- OECD's failure is still in `failures`, source and all, because it is still worth retrying --
-- that list is the scope of a retry, which asks only these sources about these items.
--
-- An item with neither is unanswered or not reached, and the two close the arithmetic (reqs.md
-- Q217, C04-N6). Eurostat answers with a whole indicator and simply omits Liechtenstein, so the
-- adapter records no figure and, rightly, no failure either: unanswered. But a source that was
-- never asked leaves the same absence, so an empty item is **unanswered only once its attribute
-- is settled** -- it has at least one plan row (0512) and every one is finished, never vacuously
-- -- and **not reached** otherwise. A run from before 0512 (`plan_recorded_at` null) has no plan
-- to read: its empty items are unanswered if it completed and not reached if it did not. Derived,
-- not stored: a table recording that absence could disagree with the rows themselves. Both are
-- listed so the household can ask again, with no source because none failed: asking again asks
-- whoever can answer the attribute, which the adapters declare and the database does not.
--
-- `by_source` is what each source stored and failed on, derived like the rest, and it lists every
-- source with either: one that only failed is the one a reader came looking for. Its two counts
-- are independent and sum to nothing: OECD may fail on an item the estimate then answers, and
-- both are true of the run. **A rejected figure is its source's failure, not stored** (BE-08). It
-- is read from the value row itself, so a run older than BE-08, or a figure rejected after its
-- run as `0473` rejected 156, reads as a new run does (NEW-30). The failure list, and so a retry,
-- stay the failure rows: a paid source must not be re-asked about a figure rejected long after it
-- answered. **A re-read figure is stored by the source that re-read it** (NEW-54), unless that
-- source failed on it too, as a re-read rejection does: stored and failed at once is the double
-- count `85d545d` removed.
--
-- Once the plan was recorded, `by_source` also lists every source the run planned to ask, with
-- `items_planned` and `items_asked` (PL-055): an attribute it finished counts all its planned
-- items, one it did not counts the items it stored or failed on, capped at the plan. Both are null
-- for a run from before 0512, whose plan nobody recorded -- never zero.
--
-- `reconfirmed` lists the run's re-confirmations, each naming the stored value it restated, or
-- null where the run did not record which (PL-049): with the run's own values, it is what the
-- run produced, which the acquisition diff compares.
WITH run AS (
    SELECT r.plan_recorded_at IS NOT NULL AS plan_recorded,
           r.run_status = 'completed'      AS is_completed
    FROM   data_acquisition_run AS r
    WHERE  r.id = :data_acquisition_run
),
plan AS (
    SELECT p.data_source, p.attribute, p.items_planned, p.finished_at
    FROM   data_acquisition_run_plan AS p
    WHERE  p.data_acquisition_run = :data_acquisition_run
),
settled AS (
    SELECT plan.attribute
    FROM   plan
    GROUP  BY plan.attribute
    HAVING bool_and(plan.finished_at IS NOT NULL)
),
item AS (
    SELECT candidate, attribute
    FROM   data_acquisition_run_item
    WHERE  data_acquisition_run = :data_acquisition_run
),
answered AS (
    SELECT v.candidate, v.attribute
    FROM   value AS v
    WHERE  v.data_acquisition_run = :data_acquisition_run
    UNION
    SELECT reuse.candidate, reuse.attribute
    FROM   data_acquisition_run_reuse AS reuse
    WHERE  reuse.data_acquisition_run = :data_acquisition_run
),
failure AS (
    SELECT f.data_source, f.candidate, f.attribute, f.error_message
    FROM   data_acquisition_failure AS f
    JOIN   item USING (candidate, attribute)
    WHERE  f.data_acquisition_run = :data_acquisition_run
),
item_state AS (
    SELECT item.candidate,
           item.attribute,
           answered.candidate IS NOT NULL AS is_answered,
           failed.candidate IS NOT NULL   AS has_failed,
           CASE WHEN run.plan_recorded THEN settled.attribute IS NOT NULL
                ELSE run.is_completed
           END                            AS is_settled
    FROM   item
    CROSS  JOIN run
    LEFT   JOIN answered USING (candidate, attribute)
    LEFT   JOIN (SELECT DISTINCT candidate, attribute FROM failure) AS failed
           USING (candidate, attribute)
    LEFT   JOIN settled ON settled.attribute = item.attribute
),
progress AS (
    SELECT count(*)                                                AS items_total,
           count(*) FILTER (WHERE is_answered)                     AS items_completed,
           count(*) FILTER (WHERE has_failed AND NOT is_answered)  AS items_failed,
           count(*) FILTER (WHERE NOT (is_answered OR has_failed) AND is_settled)
                                                                   AS items_unanswered,
           count(*) FILTER (WHERE NOT (is_answered OR has_failed OR is_settled))
                                                                   AS items_not_reached,
           COALESCE(
               jsonb_agg(jsonb_build_object('candidate', candidate, 'attribute', attribute)
                         ORDER BY candidate, attribute)
                   FILTER (WHERE NOT (is_answered OR has_failed) AND is_settled),
               '[]'::jsonb)                                        AS unanswered,
           COALESCE(
               jsonb_agg(jsonb_build_object('candidate', candidate, 'attribute', attribute)
                         ORDER BY candidate, attribute)
                   FILTER (WHERE NOT (is_answered OR has_failed OR is_settled)),
               '[]'::jsonb)                                        AS not_reached
    FROM   item_state
),
stored AS (
    SELECT v.data_source, v.candidate, v.attribute
    FROM   value AS v
    WHERE  v.data_acquisition_run = :data_acquisition_run
      AND  v.rejection_reason IS NULL
    UNION
    (SELECT reuse.data_source, reuse.candidate, reuse.attribute
     FROM   data_acquisition_run_reuse AS reuse
     WHERE  reuse.data_acquisition_run = :data_acquisition_run
     EXCEPT
     SELECT failure.data_source, failure.candidate, failure.attribute
     FROM   failure)
),
failed_on AS (
    SELECT failure.data_source, failure.candidate, failure.attribute
    FROM   failure
    UNION
    SELECT v.data_source, v.candidate, v.attribute
    FROM   value AS v
    WHERE  v.data_acquisition_run = :data_acquisition_run
      AND  v.rejection_reason IS NOT NULL
),
outcome AS (
    SELECT evidence.*
    FROM   (SELECT stored.*, true AS is_stored FROM stored
            UNION ALL
            SELECT failed_on.*, false FROM failed_on) AS evidence
    JOIN   item USING (candidate, attribute)
),
asked AS (
    SELECT plan.data_source,
           sum(plan.items_planned) AS items_planned,
           sum(CASE WHEN plan.finished_at IS NOT NULL THEN plan.items_planned
                    ELSE LEAST(plan.items_planned,
                               (SELECT count(DISTINCT outcome.candidate)
                                FROM   outcome
                                WHERE  outcome.data_source = plan.data_source
                                  AND  outcome.attribute = plan.attribute))
               END)                AS items_asked
    FROM   plan
    GROUP  BY plan.data_source
),
reach AS (
    SELECT data_source,
           COALESCE(counted.items_stored, 0) AS items_stored,
           COALESCE(counted.items_failed, 0) AS items_failed,
           CASE WHEN run.plan_recorded THEN COALESCE(asked.items_planned, 0) END
                                             AS items_planned,
           CASE WHEN run.plan_recorded THEN COALESCE(asked.items_asked, 0) END
                                             AS items_asked
    FROM   (SELECT outcome.data_source,
                   count(*) FILTER (WHERE outcome.is_stored)     AS items_stored,
                   count(*) FILTER (WHERE NOT outcome.is_stored) AS items_failed
            FROM   outcome
            GROUP  BY outcome.data_source) AS counted
    FULL   JOIN asked USING (data_source)
    CROSS  JOIN run
)
SELECT r.id,
       r.run_status,
       r.triggered_by,
       r.started_at,
       r.finished_at,
       r.llm_call_count,
       r.cost_eur,
       r.level,
       r.stop_requested_at,
       r.plan_recorded_at IS NOT NULL AS plan_recorded,
       r.estimate_ceiling_eur,
       r.spend_cap_eur,
       r.accepted_uncapped,
       COALESCE(
           (SELECT jsonb_agg(scope.candidate ORDER BY scope.candidate)
            FROM   data_acquisition_run_candidate AS scope
            WHERE  scope.data_acquisition_run = r.id),
           '[]'::jsonb) AS scope_candidates,
       COALESCE(
           (SELECT jsonb_agg(scope.attribute ORDER BY scope.attribute)
            FROM   data_acquisition_run_attribute AS scope
            WHERE  scope.data_acquisition_run = r.id),
           '[]'::jsonb) AS scope_attributes,
       progress.items_total,
       progress.items_completed,
       progress.items_failed,
       progress.items_unanswered,
       progress.items_not_reached,
       progress.unanswered,
       progress.not_reached,
       COALESCE(
           (SELECT jsonb_agg(to_jsonb(failure)
                             ORDER BY failure.candidate, failure.attribute, failure.data_source)
            FROM   failure),
           '[]'::jsonb) AS failures,
       COALESCE(
           (SELECT jsonb_agg(to_jsonb(reach) ORDER BY reach.data_source) FROM reach),
           '[]'::jsonb) AS by_source,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object('data_source', reuse.data_source,
                                                'candidate', reuse.candidate,
                                                'attribute', reuse.attribute,
                                                'value', reuse.value)
                             ORDER BY reuse.candidate, reuse.attribute, reuse.data_source)
            FROM   data_acquisition_run_reuse AS reuse
            JOIN   item USING (candidate, attribute)
            WHERE  reuse.data_acquisition_run = :data_acquisition_run),
           '[]'::jsonb) AS reconfirmed
FROM   data_acquisition_run AS r
CROSS  JOIN progress
WHERE  r.id = :data_acquisition_run;

-- name: select_run_values(data_acquisition_run)
-- What a run produced, as ids and their pairs. The full values are read through values.sql;
-- this answers "which items did this run answer?" without dragging payloads along with it.
SELECT v.id,
       v.candidate,
       v.attribute,
       v.breakdown_option,
       v.data_source,
       v.rejection_reason
FROM   value AS v
WHERE  v.data_acquisition_run = :data_acquisition_run
ORDER  BY v.candidate, v.attribute, v.breakdown_option NULLS FIRST, v.id;

-- name: select_last_retrieval_dates(level, candidates, attributes)
-- When each candidate/attribute pair last got an accepted answer from a switched-on source.
-- The run planner compares this against the refetch age to decide what is worth fetching,
-- which is what keeps a re-run from paying for data that is still fresh.
--
-- **A rejected figure is not an answer, so it is not fresh** (BE-08, NEW-27). A run records a
-- figure that fails validation as a failure precisely so that it is asked about again; counted
-- here as well, it made its own pair look fresh, and a plan or a scoped run then skipped the
-- one item the failure exists to bring back.
--
-- **Nor is a switched-off source's figure** (NEW-35): it stays stored but never scores (Q232,
-- `active_value` requires `source_is_enabled`). Counted here, it kept fresh an attribute that
-- nothing scores, so switching off the only source with a fresh figure left the attribute
-- unasked until the age ran out. Switching the source back on makes it an answer again.
--
-- Read from `value` rather than from `active_value` all the same: a figure that lost the
-- active-value comparison was accepted, and asking its source again for it would pay twice
-- for one answer.
SELECT v.candidate,
       v.attribute,
       max(v.retrieval_date)      AS last_retrieval_date,
       max(v.reference_period_end) AS last_reference_period_end
FROM   value AS v
JOIN   candidate AS c ON c.id = v.candidate
JOIN   data_source AS s ON s.id = v.data_source
WHERE  v.rejection_reason IS NULL
  AND  s.is_enabled
  AND  (:level::text IS NULL OR c.level = :level)
  AND  (:candidates::text[] IS NULL OR v.candidate = ANY(:candidates))
  AND  (:attributes::text[] IS NULL OR v.attribute = ANY(:attributes))
GROUP  BY v.candidate, v.attribute
ORDER  BY v.candidate, v.attribute;

-- name: select_holdings(level, declared, stand_in_source, since)^
-- What the database holds at a level, not what one run did (PL-051, PL-054). **One statement**,
-- so values stored plus the three gap lists is the pairs total in every snapshot (map-C04 2.3).
-- **Everything it filters on is read here too** -- the source switches, the stand-ins and the
-- refetch age: read beforehand, a switch flipped in between paired the old pairs with the new
-- values, a state the database was never in.
--
-- The pairs are the level's candidates against the attributes a switched-on source declares
-- (the caller passes every (source, attribute) its adapters declare, which the database does
-- not hold, Q235; a source missing from the catalog is kept, as `switched_on` keeps it), the
-- pairs a stand-in can lend while the stand-in source is on, and any pair already holding a
-- value in use. Retired attributes are not counted.
--
-- A gap is a pair with no value in use, classified by the LATEST run whose items include it,
-- never by the newest run overall. `failed`: that run has a failure row for it, or stored a
-- figure that cannot be used (rejected, or from a source since switched off). `unanswered`:
-- that run completed and nobody had a row. `not_reached`: it did not complete -- with no record
-- of which sources finished, a halted run cannot say nobody had a row (C04-N6) -- or no run has
-- ever asked (`data_acquisition_run` null).
--
-- Spend is every run started and every research call ledgered at or after `since`, the reader's
-- month start (C04-N10): the ledger's sum is served, never its rows (C04-N1).
WITH attribute_here AS (
    SELECT a.id
    FROM   attribute AS a
    WHERE  a.level = :level
      AND  a.lifecycle_status = 'active'
),
switched_off AS (
    SELECT s.id FROM data_source AS s WHERE NOT s.is_enabled
),
askable AS (
    SELECT d.attribute
    FROM   jsonb_to_recordset(:declared::jsonb) AS d(data_source text, attribute text)
    WHERE  d.data_source NOT IN (SELECT id FROM switched_off)
),
in_use AS (
    SELECT av.candidate, av.attribute, bool_or(NOT av.is_fresh) AS is_past_allowed_age
    FROM   active_value AS av
    JOIN   candidate AS c ON c.id = av.candidate AND c.level = :level
    JOIN   attribute_here AS a ON a.id = av.attribute
    GROUP  BY av.candidate, av.attribute
),
pair AS (
    SELECT c.id AS candidate, a.id AS attribute
    FROM   candidate AS c
    CROSS  JOIN attribute_here AS a
    WHERE  c.level = :level
      AND  a.id IN (SELECT attribute FROM askable)
    UNION
    SELECT lent.candidate, lent.attribute
    FROM   stand_in AS lent
    JOIN   candidate AS c ON c.id = lent.candidate AND c.level = :level
    JOIN   attribute_here AS a ON a.id = lent.attribute
    WHERE  :stand_in_source::text NOT IN (SELECT id FROM switched_off)
    UNION
    SELECT candidate, attribute FROM in_use
),
gap AS (
    SELECT pair.candidate, pair.attribute
    FROM   pair
    LEFT   JOIN in_use USING (candidate, attribute)
    WHERE  in_use.candidate IS NULL
),
latest AS (
    SELECT DISTINCT ON (item.candidate, item.attribute)
           item.candidate, item.attribute, item.data_acquisition_run, r.run_status
    FROM   data_acquisition_run_item AS item
    JOIN   gap USING (candidate, attribute)
    JOIN   data_acquisition_run AS r ON r.id = item.data_acquisition_run
    ORDER  BY item.candidate, item.attribute, item.data_acquisition_run DESC
),
-- Each source's reason once: its failure row where it has one, else why its figure is unusable.
cause AS (
    SELECT DISTINCT ON (latest.candidate, latest.attribute, said.data_source)
           latest.candidate, latest.attribute, said.data_source, said.error_message
    FROM   latest
    CROSS  JOIN LATERAL (
        SELECT 1 AS precedence, f.data_source, f.error_message
        FROM   data_acquisition_failure AS f
        WHERE  (f.data_acquisition_run, f.candidate, f.attribute)
               = (latest.data_acquisition_run, latest.candidate, latest.attribute)
        UNION ALL
        SELECT 2, v.data_source, COALESCE(v.rejection_reason, 'its source is switched off')
        FROM   value AS v
        JOIN   data_source AS s ON s.id = v.data_source
        WHERE  (v.data_acquisition_run, v.candidate, v.attribute)
               = (latest.data_acquisition_run, latest.candidate, latest.attribute)
          AND  (v.rejection_reason IS NOT NULL OR NOT s.is_enabled)
        UNION ALL
        SELECT 2, reuse.data_source, 'its source is switched off'
        FROM   data_acquisition_run_reuse AS reuse
        JOIN   data_source AS s ON s.id = reuse.data_source
        WHERE  (reuse.data_acquisition_run, reuse.candidate, reuse.attribute)
               = (latest.data_acquisition_run, latest.candidate, latest.attribute)
          AND  NOT s.is_enabled
    ) AS said
    ORDER  BY latest.candidate, latest.attribute, said.data_source, said.precedence
),
classified AS (
    SELECT gap.candidate,
           gap.attribute,
           latest.data_acquisition_run,
           CASE WHEN failures.listed IS NOT NULL THEN 'failed'
                WHEN latest.run_status = 'completed' THEN 'unanswered'
                ELSE 'not_reached'
           END AS outcome,
           failures.listed AS failures
    FROM   gap
    LEFT   JOIN latest USING (candidate, attribute)
    LEFT   JOIN (SELECT candidate, attribute,
                        jsonb_agg(jsonb_build_object('data_source', data_source,
                                                     'error_message', error_message)
                                  ORDER BY data_source) AS listed
                 FROM   cause
                 GROUP  BY candidate, attribute) AS failures USING (candidate, attribute)
),
refetch AS (
    SELECT (SELECT s.refetch_older_than_days FROM settings AS s WHERE s.id = 1) AS days
)
SELECT (SELECT count(*) FROM pair)                                       AS pairs_total,
       (SELECT count(*) FROM in_use)                                     AS values_stored,
       (SELECT count(*) FROM in_use WHERE is_past_allowed_age)           AS values_past_allowed_age,
       CASE WHEN (SELECT days FROM refetch) IS NOT NULL THEN
           (SELECT count(*)
            FROM   in_use, refetch
            WHERE  (SELECT max(v.retrieval_date)
                    FROM   value AS v
                    JOIN   data_source AS s ON s.id = v.data_source
                    WHERE  (v.candidate, v.attribute) = (in_use.candidate, in_use.attribute)
                      AND  v.rejection_reason IS NULL
                      AND  s.is_enabled)
                   <= now() - make_interval(days => refetch.days))
       END                                                               AS values_older_than_refetch_age,
       (SELECT COALESCE(sum(r.cost_eur), 0)
        FROM   data_acquisition_run AS r
        WHERE  r.started_at >= :since)                                   AS runs_eur,
       (SELECT COALESCE(sum(spend.cost_eur), 0)
        FROM   match_rule_research_spend AS spend
        WHERE  spend.researched_at >= :since)                            AS research_eur,
       COALESCE(
           (SELECT jsonb_agg(to_jsonb(classified) ORDER BY candidate, attribute)
            FROM   classified),
           '[]'::jsonb)                                                  AS gaps;

-- name: select_run_in_flight()^
-- The run that is currently going, if one is. At most one row by design: nothing else starts a
-- run (reqs.md 10), and `start_run` refuses while this returns anything (P35).
--
-- The same definition `sweep_abandoned_runs` below uses, from the other end -- that one turns
-- what is still running at boot into `failed`, because a run in flight when nothing is running
-- it is a run whose process died. Between them, `running` means exactly what it says.
SELECT r.id,
       r.run_status,
       r.started_at,
       r.triggered_by
FROM   data_acquisition_run AS r
WHERE  r.run_status = 'running'
ORDER  BY r.started_at
LIMIT  1;

-- name: sweep_abandoned_runs(finished_at)
-- Anything still `running` when the application starts was abandoned: nothing else starts a run
-- (reqs.md 10), so a run in flight at boot is one whose process died (arch.md 9.2 step 4).
--
-- Marked `failed` rather than `completed`: it did not finish, and the values it wrote before it
-- died are intact and keep their run id. That is what makes a retry meaningful -- the run's
-- record says what was asked for, the values say what arrived, and the difference is the work
-- left to do.
UPDATE data_acquisition_run
SET    run_status  = 'failed',
       finished_at = :finished_at
WHERE  run_status = 'running'
RETURNING id;

-- name: request_run_stop(data_acquisition_run, asked_at)<!
-- Ask a run to stop, and say whether there was a running one to ask.
--
-- **Only a running run.** Asking a finished one to stop is not an error worth raising -- the
-- outcome the caller wanted is already true -- but it must not stamp a time onto a run that
-- ended on its own, because `stop_requested_at` is read afterwards as "somebody intervened".
--
-- **First ask wins.** A second request leaves the first time in place, so the record is when
-- the stop was asked for rather than when it was last asked for again.
UPDATE data_acquisition_run
SET    stop_requested_at = coalesce(stop_requested_at, :asked_at)
WHERE  id = :data_acquisition_run
  AND  run_status = 'running'
RETURNING id;

-- name: select_run_stop_requested(data_acquisition_run)$
-- Whether somebody has asked this run to stop. Read by the loop between items.
--
-- One boolean per item is a cheap question next to the HTTP fetch it sits beside, and reading
-- it from the row rather than from memory is what lets a stop reach a run whose loop is in a
-- background task -- which every run's is (P35 made the 202 true).
SELECT stop_requested_at IS NOT NULL FROM data_acquisition_run WHERE id = :data_acquisition_run;
