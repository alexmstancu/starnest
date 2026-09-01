-- EvaluationStore (arch.md 6.3): persist a ranking that was deliberately kept, and read it back
-- exactly as it was computed.
--
-- Nothing here computes anything. A ranking is computed in `evaluation/` from two reads and
-- pure arithmetic (arch.md 7.2) and is never written; a row in these tables is one the user
-- asked to keep (reqs.md 3.4a). So this file is a writer and a reader of results, and there is
-- no query that scores, ranks or redistributes.
--
-- The freeze covers the whole interpretation, not just the weights. A criteria set stays
-- editable -- that is the point of saving one -- so the criteria, their anchors, the per-
-- attribute detail and the exact value row behind every contribution are all copied in. Reopen
-- a year later, after an anchor has been revised, and the total still reproduces from its own
-- drill-down.
--
-- The bulk writes take a jsonb array rather than a dozen parallel arrays. Zipping twelve
-- unnests is a length-mismatch bug waiting to happen and reads as nothing at all;
-- jsonb_to_recordset names and types every column in the statement, which is the same
-- information a row type would carry and is visible where the insert is.

-- name: insert_evaluation(criteria_set, level, computed_at)<!
-- The header. An evaluation runs at one level, so a comparison drawn from it can never mix
-- levels (reqs.md 3.4a).
INSERT INTO evaluation (criteria_set, level, computed_at)
VALUES (:criteria_set, :level, :computed_at)
RETURNING id;

-- name: insert_evaluation_criteria(evaluation, criteria)!
-- The criteria snapshot: weight, pillar weight, goal, band, zero points, normalisation method,
-- breakdown choice and blocking flag, per attribute. Recording which attributes were in scope
-- is what keeps the coverage figure meaningful after the catalog grows.
INSERT INTO evaluation_criterion (
    evaluation, attribute, pillar, is_scored, weight, pillar_weight, goal,
    target_range_min, target_range_max, zero_score_below, zero_score_above,
    normalisation_method, breakdown_option, reducer_mode, blocks_if_missing)
SELECT :evaluation, frozen.attribute, frozen.pillar, frozen.is_scored, frozen.weight,
       frozen.pillar_weight, frozen.goal, frozen.target_range_min, frozen.target_range_max,
       frozen.zero_score_below, frozen.zero_score_above, frozen.normalisation_method,
       frozen.breakdown_option, frozen.reducer_mode, frozen.blocks_if_missing
FROM   jsonb_to_recordset(:criteria::jsonb) AS frozen(
           attribute            text,
           pillar               text,
           is_scored            boolean,
           weight               numeric,
           pillar_weight        numeric,
           goal                 text,
           target_range_min     numeric,
           target_range_max     numeric,
           zero_score_below     numeric,
           zero_score_above     numeric,
           normalisation_method text,
           breakdown_option     text,
           reducer_mode         text,
           blocks_if_missing    boolean);

-- name: insert_evaluation_scale_anchors(evaluation, anchors)!
-- The frozen twin of criterion_scale_anchor, keyed on the attribute rather than on a criterion
-- id because the criterion it was copied from stays editable and may since have been deleted.
-- A `fixed` scale is not reproducible without these, so freezing the method and not the points
-- would freeze half of an answer.
INSERT INTO evaluation_scale_anchor (evaluation, attribute, input_value, score)
SELECT :evaluation, anchor.attribute, anchor.input_value, anchor.score
FROM   jsonb_to_recordset(:anchors::jsonb) AS anchor(
           attribute   text,
           input_value numeric,
           score       integer);

-- name: insert_candidate_results(evaluation, results)
-- Every candidate's outcome in one statement, returning the generated id beside the candidate
-- it belongs to -- which is what the per-attribute scores, the non-match reasons and the
-- warnings all hang off. Inserting one candidate at a time to learn its id would be a round
-- trip per candidate for a write that is conceptually one.
--
-- score is null only for insufficient_data: never fabricate a total from what is missing. A
-- non-matching candidate keeps its score and stays visible (reqs.md 5.4).
INSERT INTO candidate_result (
    evaluation, candidate, score, coverage, match_status, parent_not_matching, rank)
SELECT :evaluation, result.candidate, result.score, result.coverage, result.match_status,
       result.parent_not_matching, result.rank
FROM   jsonb_to_recordset(:results::jsonb) AS result(
           candidate           text,
           score               integer,
           coverage            numeric,
           match_status        text,
           parent_not_matching boolean,
           rank                integer)
RETURNING id, candidate;

-- name: insert_candidate_attribute_scores(scores)!
-- The per-attribute detail behind every total, stored rather than recomputed. The criteria
-- snapshot freezes the weights but not the code that applies them, so storing the outcome makes
-- a saved evaluation read identically however the scoring engine later changes.
--
-- used_value pins the exact value row behind one contribution, which is what closes the
-- provenance chain from a total down to a source and a date. It is null when no value was
-- available and the weight was redistributed away.
INSERT INTO candidate_attribute_score (
    candidate_result, attribute, used_value, normalised_score, effective_weight, contribution)
SELECT detail.candidate_result, detail.attribute, detail.used_value, detail.normalised_score,
       detail.effective_weight, detail.contribution
FROM   jsonb_to_recordset(:scores::jsonb) AS detail(
           candidate_result bigint,
           attribute        text,
           used_value       bigint,
           normalised_score integer,
           effective_weight numeric,
           contribution     numeric);

-- name: insert_non_match_reasons(reasons)!
-- Why a candidate is out. Both mechanisms feed one surface, so the user never looks in two
-- places: a criterion's matching threshold, a match rule, or a compound rule -- exactly one per
-- row, which the schema enforces rather than this statement.
INSERT INTO non_match_reason (candidate_result, criterion, match_rule, compound_rule, reason_detail)
SELECT reason.candidate_result, reason.criterion, reason.match_rule, reason.compound_rule,
       reason.reason_detail
FROM   jsonb_to_recordset(:reasons::jsonb) AS reason(
           candidate_result bigint,
           criterion        bigint,
           match_rule       text,
           compound_rule    text,
           reason_detail    text);

-- name: insert_candidate_warnings(warnings)!
-- A warning flags without ruling anything out. It never changes the score and never makes a
-- candidate not match; it is stored with the result so a saved evaluation reads the same later
-- (reqs.md 5.3).
INSERT INTO candidate_warning (candidate_result, compound_rule, detail)
SELECT warning.candidate_result, warning.compound_rule, warning.detail
FROM   jsonb_to_recordset(:warnings::jsonb) AS warning(
           candidate_result bigint,
           compound_rule    text,
           detail           text);

-- Reading a saved evaluation back.

-- name: select_evaluations()
-- The list of kept results, newest first.
SELECT e.id,
       e.criteria_set,
       e.level,
       e.computed_at
FROM   evaluation AS e
ORDER  BY e.computed_at DESC, e.id DESC;

-- name: select_evaluation(evaluation)^
-- One evaluation's header, for the ranking's own criteria_set, level and computed_at.
SELECT e.id,
       e.criteria_set,
       e.level,
       e.computed_at
FROM   evaluation AS e
WHERE  e.id = :evaluation;

-- name: select_evaluation_results(evaluation)
-- The whole ranking in one read: every candidate's score, coverage, match status, rank and
-- flags, with its display name, its warnings and its non-match reasons.
--
-- Non-matching candidates are returned with their scores. They are never filtered out here and
-- must not be filtered out downstream: the reason a candidate is out is a thing the product
-- exists to show (reqs.md 5.4).
--
-- The ordering puts ranked candidates first in rank order and unranked ones after, by score,
-- so a result set read straight through is already the dashboard's order.
SELECT r.id,
       r.candidate,
       c.name AS candidate_name,
       r.score,
       r.coverage,
       r.match_status,
       r.parent_not_matching,
       r.rank,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                       'criterion',     reason.criterion,
                       'attribute',     reason_criterion.attribute,
                       'match_rule',    reason.match_rule,
                       'compound_rule', reason.compound_rule,
                       'detail',        reason.reason_detail)
                     ORDER BY reason.id)
            FROM   non_match_reason AS reason
            LEFT   JOIN criterion AS reason_criterion ON reason_criterion.id = reason.criterion
            WHERE  reason.candidate_result = r.id),
           '[]'::jsonb) AS non_match_reasons,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                       'compound_rule', warning.compound_rule,
                       'detail',        warning.detail)
                     ORDER BY warning.compound_rule)
            FROM   candidate_warning AS warning
            WHERE  warning.candidate_result = r.id),
           '[]'::jsonb) AS warnings
FROM   candidate_result AS r
JOIN   candidate AS c ON c.id = r.candidate
WHERE  r.evaluation = :evaluation
ORDER  BY r.rank NULLS LAST, r.score DESC NULLS LAST, c.name;

-- name: select_evaluation_criteria(evaluation)
-- The criteria this evaluation was computed with, anchors included. The criteria set it names
-- stays editable, so this is the only record of what the weights and the scale actually were
-- when the ranking was produced.
SELECT ec.attribute,
       ec.pillar,
       ec.is_scored,
       ec.weight,
       ec.pillar_weight,
       ec.goal,
       ec.target_range_min,
       ec.target_range_max,
       ec.zero_score_below,
       ec.zero_score_above,
       ec.normalisation_method,
       ec.breakdown_option,
       ec.reducer_mode,
       ec.blocks_if_missing,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                       'input_value', anchor.input_value,
                       'score',       anchor.score)
                     ORDER BY anchor.input_value)
            FROM   evaluation_scale_anchor AS anchor
            WHERE  anchor.evaluation = ec.evaluation
              AND  anchor.attribute = ec.attribute),
           '[]'::jsonb) AS scale_anchors
FROM   evaluation_criterion AS ec
WHERE  ec.evaluation = :evaluation
ORDER  BY ec.pillar, ec.attribute;

-- name: select_candidate_result(evaluation, candidate)^
-- One candidate's outcome, for the head of the drill-down.
SELECT r.id,
       r.candidate,
       c.name AS candidate_name,
       r.score,
       r.coverage,
       r.match_status,
       r.parent_not_matching,
       r.rank
FROM   candidate_result AS r
JOIN   candidate AS c ON c.id = r.candidate
WHERE  r.evaluation = :evaluation
  AND  r.candidate = :candidate;

-- name: select_candidate_attribute_scores(evaluation, candidate)
-- Why this candidate scored what it scored: every attribute's normalised score, its effective
-- weight after redistribution, its contribution, and the provenance of the exact value used.
--
-- The value's payload is not joined here. Pass the returned used_value ids to
-- select_value_payloads (values.sql) rather than repeating the ten-way CASE a third time; this
-- screen is not on the hot path and can afford the round trip.
--
-- The frozen pillar and weight come from evaluation_criterion rather than from the live
-- catalog, so the drill-down reproduces the total it is explaining.
SELECT s.attribute,
       ec.pillar,
       ec.weight,
       s.normalised_score,
       s.effective_weight,
       s.contribution,
       s.used_value,
       used.data_source            AS used_value_data_source,
       used.value_type             AS used_value_type,
       used.breakdown_option       AS used_value_breakdown_option,
       used.reference_period_start AS used_value_reference_period_start,
       used.reference_period_end   AS used_value_reference_period_end,
       used.retrieval_date         AS used_value_retrieval_date,
       used.confidence_level       AS used_value_confidence_level,
       used.quote                  AS used_value_quote,
       COALESCE(
           (SELECT jsonb_agg(citation.url ORDER BY citation.url)
            FROM   value_citation AS citation
            WHERE  citation.value = used.id),
           '[]'::jsonb)            AS used_value_citations
FROM   candidate_result AS r
JOIN   candidate_attribute_score AS s ON s.candidate_result = r.id
LEFT   JOIN evaluation_criterion AS ec
            ON ec.evaluation = r.evaluation AND ec.attribute = s.attribute
LEFT   JOIN value AS used ON used.id = s.used_value
WHERE  r.evaluation = :evaluation
  AND  r.candidate = :candidate
ORDER  BY ec.pillar NULLS LAST, s.attribute;

-- name: delete_evaluation(evaluation)!
-- A kept result may be discarded. One statement, children first, for the same reason
-- delete_criteria_set is one statement: the referential-integrity checks fire at the end of it,
-- by which time every CTE has run.
WITH targeted_results AS (
    SELECT id FROM candidate_result WHERE evaluation = :evaluation
),
cleared_scores AS (
    DELETE FROM candidate_attribute_score
    WHERE  candidate_result IN (SELECT id FROM targeted_results)
),
cleared_reasons AS (
    DELETE FROM non_match_reason
    WHERE  candidate_result IN (SELECT id FROM targeted_results)
),
cleared_warnings AS (
    DELETE FROM candidate_warning
    WHERE  candidate_result IN (SELECT id FROM targeted_results)
),
cleared_results AS (
    DELETE FROM candidate_result WHERE evaluation = :evaluation
),
cleared_anchors AS (
    DELETE FROM evaluation_scale_anchor WHERE evaluation = :evaluation
),
cleared_criteria AS (
    DELETE FROM evaluation_criterion WHERE evaluation = :evaluation
)
DELETE FROM evaluation WHERE id = :evaluation;
