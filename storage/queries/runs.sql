-- RunStore (arch.md 6.3): create a run with its planned scope, append what each item produced,
-- and read status, cost, progress and failures back.
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

-- name: insert_run(started_at, triggered_by, run_status, level)<!
-- Open a run. It starts `running` and with zero spend; both are advanced by the statements
-- below as the work proceeds, so a run being watched shows real progress rather than a status
-- that jumps at the end.
INSERT INTO data_acquisition_run (started_at, triggered_by, run_status, level)
VALUES (:started_at, :triggered_by, :run_status, :level)
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

-- Reading runs.

-- name: select_runs(limit_rows, offset_rows)
-- The run history, newest first.
SELECT r.id,
       r.run_status,
       r.triggered_by,
       r.started_at,
       r.finished_at,
       r.llm_call_count,
       r.cost_eur,
       r.level
FROM   data_acquisition_run AS r
ORDER  BY r.started_at DESC, r.id DESC
LIMIT  :limit_rows OFFSET :offset_rows;

-- name: count_runs()$
-- The `total` beside the page above.
SELECT count(*) FROM data_acquisition_run;

-- name: select_run(data_acquisition_run)^
-- One run with its planned scope and live progress, in a single read -- this is what a screen
-- polls while a run is in flight, so it must not cost four queries per poll.
--
-- items_total is the planned cross product: every attribute in scope, for every candidate in
-- scope. items_completed counts the distinct pairs that actually produced a value row, which
-- includes values stored as rejected -- the item was fetched and answered, and whether the
-- answer survived validation is a separate question the value itself records.
--
-- items_failed counts the pairs some source failed on and NO source answered, so it never
-- overlaps items_completed. Where OECD failed and the estimate answered, the item is complete;
-- OECD's failure is still listed by select_run_failures, source and all, because it is still a
-- thing worth retrying. A run with a thousand failures should not make its own status
-- unreadable, so they are counted here and listed there.
SELECT r.id,
       r.run_status,
       r.triggered_by,
       r.started_at,
       r.finished_at,
       r.llm_call_count,
       r.cost_eur,
       r.level,
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
       (SELECT count(*) FROM data_acquisition_run_candidate AS scope
        WHERE  scope.data_acquisition_run = r.id)
       * (SELECT count(*) FROM data_acquisition_run_attribute AS scope
          WHERE  scope.data_acquisition_run = r.id) AS items_total,
       (SELECT count(DISTINCT (v.candidate, v.attribute))
        FROM   value AS v
        WHERE  v.data_acquisition_run = r.id) AS items_completed,
       (SELECT count(DISTINCT (f.candidate, f.attribute))
        FROM   data_acquisition_failure AS f
        WHERE  f.data_acquisition_run = r.id
          AND  NOT EXISTS (SELECT 1 FROM value AS v
                           WHERE  v.data_acquisition_run = r.id
                             AND  v.candidate = f.candidate
                             AND  v.attribute = f.attribute)) AS items_failed,
       -- items_unanswered closes the arithmetic (reqs.md Q217): a pair the scope names that
       -- produced neither a value nor a failure. Eurostat answers with a whole indicator and
       -- simply omits Liechtenstein, so the adapter records no figure and, rightly, no failure
       -- either -- and before this the item belonged to none of the three counts.
       --
       -- Derived, not stored. It is the absence of two rows, and a table recording that absence
       -- could disagree with the rows themselves.
       (SELECT count(*)
        FROM   data_acquisition_run_candidate AS scope_c
        JOIN   data_acquisition_run_attribute AS scope_a
               ON scope_a.data_acquisition_run = scope_c.data_acquisition_run
        WHERE  scope_c.data_acquisition_run = r.id
          AND  NOT EXISTS (SELECT 1 FROM value AS v
                           WHERE  v.data_acquisition_run = r.id
                             AND  v.candidate = scope_c.candidate
                             AND  v.attribute = scope_a.attribute)
          AND  NOT EXISTS (SELECT 1 FROM data_acquisition_failure AS f
                           WHERE  f.data_acquisition_run = r.id
                             AND  f.candidate = scope_c.candidate
                             AND  f.attribute = scope_a.attribute)) AS items_unanswered
FROM   data_acquisition_run AS r
WHERE  r.id = :data_acquisition_run;

-- name: select_run_failures(data_acquisition_run)
-- What a run failed on, item by item and source by source. This is both the failure list on
-- the run screen and the scope of the retry run, which asks only these sources about these items.
SELECT f.data_source,
       f.candidate,
       f.attribute,
       f.error_message
FROM   data_acquisition_failure AS f
WHERE  f.data_acquisition_run = :data_acquisition_run
ORDER  BY f.candidate, f.attribute, f.data_source;

-- name: select_run_unanswered(data_acquisition_run)
-- The items nobody answered, so the household can ask again about them (reqs.md Q217).
--
-- The same derivation items_unanswered counts, listed rather than counted: every pair the scope
-- names with no value row and no failure row for this run. There is no source column because no
-- source failed -- each one asked answered, with nothing for that candidate -- so asking again
-- means asking whoever can answer the attribute, which the adapters declare and the database
-- does not.
SELECT scope_c.candidate,
       scope_a.attribute
FROM   data_acquisition_run_candidate AS scope_c
JOIN   data_acquisition_run_attribute AS scope_a
       ON scope_a.data_acquisition_run = scope_c.data_acquisition_run
WHERE  scope_c.data_acquisition_run = :data_acquisition_run
  AND  NOT EXISTS (SELECT 1 FROM value AS v
                   WHERE  v.data_acquisition_run = :data_acquisition_run
                     AND  v.candidate = scope_c.candidate
                     AND  v.attribute = scope_a.attribute)
  AND  NOT EXISTS (SELECT 1 FROM data_acquisition_failure AS f
                   WHERE  f.data_acquisition_run = :data_acquisition_run
                     AND  f.candidate = scope_c.candidate
                     AND  f.attribute = scope_a.attribute)
ORDER  BY scope_c.candidate, scope_a.attribute;

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
-- When each candidate/attribute pair was last fetched, whatever came of it. The run planner
-- compares this against the attribute's max_age to decide what is worth fetching, which is what
-- keeps a re-run from paying for data that is still fresh.
--
-- Read from `value` rather than from `active_value`: the question is when we last ASKED, and a
-- value that lost the active-value comparison or failed validation was still an answer we paid
-- for.
SELECT v.candidate,
       v.attribute,
       max(v.retrieval_date)      AS last_retrieval_date,
       max(v.reference_period_end) AS last_reference_period_end
FROM   value AS v
JOIN   candidate AS c ON c.id = v.candidate
WHERE  (:level::text IS NULL OR c.level = :level)
  AND  (:candidates::text[] IS NULL OR v.candidate = ANY(:candidates))
  AND  (:attributes::text[] IS NULL OR v.attribute = ANY(:attributes))
GROUP  BY v.candidate, v.attribute
ORDER  BY v.candidate, v.attribute;

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
