-- CriteriaStore and MatchRuleResultStore (arch.md 6.3): the subjective half of the model, plus
-- the gate answers the `criteria` module reads to decide eligibility.
--
-- Both seams live in this file because arch.md 6.3 declares both interfaces in `criteria/`.
-- A match rule's ANSWER is objective -- whether a visa route exists is a fact -- but whether
-- the gate is enforced is a preference, and the module that holds the preference is the module
-- that reads the answer.
--
-- Nothing here is ever referenced from the objective side, which is what makes switching sets
-- pure arithmetic over stored rows and why it can never trigger a fetch (arch.md 3.6).
--
-- Weights are percentages, 0-100. That they sum to 100 within a pillar and within a level is a
-- domain invariant `criteria/` owns; rebalancing passes through intermediate states, so no
-- query here asserts it.

-- name: select_criteria_sets()
-- The set picker. Header rows only -- reading one whole is a separate, heavier query.
SELECT s.id,
       s.name
FROM   criteria_set AS s
ORDER  BY s.id;

-- name: select_criteria_set(criteria_set, level)^
-- Query one of the two the ranking read path is allowed (arch.md 7.2 step 1): the whole set --
-- its criteria with their anchors and matching thresholds, its pillar weights, its enforced
-- match rules and its applied compound rules -- in a single read.
--
-- One row, four aggregates. Splitting it into four queries would be four round trips on the
-- path a slider drag takes, and the set is small enough that assembling it in the database is
-- cheaper than assembling it over the wire.
--
-- :level narrows the criteria and the pillar weights to one level, because weights sum to 100
-- WITHIN a level and mixing two levels into one read would produce a set that sums to 200. Pass
-- NULL to read the set entire, which is what the criteria screen shows.
--
-- The matching threshold is one of four shapes chosen by the attribute's value type (reqs.md
-- 3.4), so it comes back as one nullable object per shape rather than as a union the database
-- would have to discriminate. Exactly one can be non-empty: the composite keys of 0009 refuse
-- the others.
SELECT s.id,
       s.name,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                       'attribute',            c.attribute,
                       'pillar',               a.pillar,
                       'level',                a.level,
                       'value_type',           c.value_type,
                       'is_scored',            c.is_scored,
                       'weight',               c.weight,
                       'weight_locked',        c.weight_locked,
                       'goal',                 c.goal,
                       'target_range_min',     c.target_range_min,
                       'target_range_max',     c.target_range_max,
                       'zero_score_below',     c.zero_score_below,
                       'zero_score_above',     c.zero_score_above,
                       'normalisation_method', c.normalisation_method,
                       'breakdown_option',     c.breakdown_option,
                       'reducer_mode',         c.reducer_mode,
                       'blocks_if_missing',    c.blocks_if_missing,
                       'scale_anchors', COALESCE(
                           (SELECT jsonb_agg(jsonb_build_object(
                                       'input_value', anchor.input_value,
                                       'score',       anchor.score,
                                       'label',       anchor.label)
                                    ORDER BY anchor.input_value)
                            FROM   criterion_scale_anchor AS anchor
                            WHERE  anchor.criterion = c.id), '[]'::jsonb),
                       'threshold_range',
                           (SELECT jsonb_build_object(
                                       'min_value', range_threshold.min_value,
                                       'max_value', range_threshold.max_value)
                            FROM   criterion_threshold_range AS range_threshold
                            WHERE  range_threshold.criterion = c.id),
                       'threshold_boolean',
                           (SELECT jsonb_build_object(
                                       'required_value', boolean_threshold.required_value)
                            FROM   criterion_threshold_boolean AS boolean_threshold
                            WHERE  boolean_threshold.criterion = c.id),
                       'threshold_labels', COALESCE(
                           (SELECT jsonb_agg(jsonb_build_object(
                                       'label',            label_threshold.label,
                                       'containment_rule', label_threshold.containment_rule)
                                    ORDER BY label_threshold.label)
                            FROM   criterion_threshold_label AS label_threshold
                            WHERE  label_threshold.criterion = c.id), '[]'::jsonb),
                       'threshold_shares', COALESCE(
                           (SELECT jsonb_agg(jsonb_build_object(
                                       'label',     share_threshold.label,
                                       'min_share', share_threshold.min_share,
                                       'max_share', share_threshold.max_share)
                                    ORDER BY share_threshold.label)
                            FROM   criterion_threshold_share AS share_threshold
                            WHERE  share_threshold.criterion = c.id), '[]'::jsonb))
                     ORDER BY a.pillar NULLS LAST, c.attribute)
            FROM   criterion AS c
            JOIN   attribute AS a ON a.id = c.attribute
            WHERE  c.criteria_set = s.id
              AND  (:level::text IS NULL OR a.level = :level)),
           '[]'::jsonb) AS criteria,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                       'pillar',        w.pillar,
                       'level',         w.level,
                       'weight',        w.weight,
                       'weight_locked', w.weight_locked)
                     ORDER BY w.level, w.pillar)
            FROM   pillar_weight AS w
            WHERE  w.criteria_set = s.id
              AND  (:level::text IS NULL OR w.level = :level)),
           '[]'::jsonb) AS pillar_weights,
       COALESCE(
           (SELECT jsonb_agg(m.match_rule ORDER BY m.match_rule)
            FROM   criteria_set_match_rule AS m
            WHERE  m.criteria_set = s.id AND m.is_enforced),
           '[]'::jsonb) AS enforced_match_rules,
       COALESCE(
           (SELECT jsonb_agg(r.compound_rule ORDER BY r.compound_rule)
            FROM   criteria_set_compound_rule AS r
            WHERE  r.criteria_set = s.id AND r.is_applied),
           '[]'::jsonb) AS applied_compound_rules
FROM   criteria_set AS s
WHERE  s.id = :criteria_set;

-- name: select_criterion(criteria_set, attribute)^
-- One criterion by its natural key, for the PATCH that adjusts it. The generated id is what the
-- anchor and threshold children hang off, so it travels with the row.
SELECT c.id,
       c.criteria_set,
       c.attribute,
       a.pillar,
       c.value_type,
       c.is_scored,
       c.weight,
       c.weight_locked,
       c.goal,
       c.target_range_min,
       c.target_range_max,
       c.zero_score_below,
       c.zero_score_above,
       c.normalisation_method,
       c.breakdown_option,
       c.reducer_mode,
       c.blocks_if_missing
FROM   criterion AS c
JOIN   attribute AS a ON a.id = c.attribute
WHERE  c.criteria_set = :criteria_set
  AND  c.attribute = :attribute;

-- name: select_criteria_in_pillar(criteria_set, pillar, level)
-- The siblings a weight change rebalances against, with their locks. Rebalancing is arithmetic
-- over this list and is performed in `criteria/`, not here: the PATCH response returns every
-- criterion in the pillar with its new weight (openapi.yaml), so the caller needs them all
-- before it can decide any of them.
SELECT c.id,
       c.attribute,
       c.weight,
       c.weight_locked,
       c.is_scored
FROM   criterion AS c
JOIN   attribute AS a ON a.id = c.attribute
WHERE  c.criteria_set = :criteria_set
  AND  a.pillar = :pillar
  AND  (:level::text IS NULL OR a.level = :level)
ORDER  BY c.attribute;

-- Writing a criteria set.

-- name: insert_criteria_set(criteria_set, name)!
INSERT INTO criteria_set (id, name)
VALUES (:criteria_set, :name);

-- name: update_criteria_set_name(criteria_set, name)!
-- A set is renamed, never re-identified: the id is assigned once (arch.md 3.2a).
UPDATE criteria_set
SET    name = :name
WHERE  id = :criteria_set;

-- name: delete_criteria_set(criteria_set)!
-- One statement, because the children must go first and a partial delete would leave a set that
-- half exists. The referential-integrity checks are AFTER-row triggers fired at the end of the
-- statement, so every CTE below has already run by the time any of them looks.
--
-- An unreferenced CTE still executes -- that is guaranteed for data-modifying CTEs, and it is
-- what lets the four threshold tables be cleared without being joined to anything.
--
-- A set an evaluation still points at will not delete: non_match_reason.criterion references
-- criterion, and the foreign key raises rather than cascading. That failure is the 409 the
-- contract promises, and it is the database's answer rather than a check this file repeats.
WITH targeted AS (
    SELECT id FROM criterion WHERE criteria_set = :criteria_set
),
cleared_anchors AS (
    DELETE FROM criterion_scale_anchor
    WHERE  criterion IN (SELECT id FROM targeted)
),
cleared_ranges AS (
    DELETE FROM criterion_threshold_range
    WHERE  criterion IN (SELECT id FROM targeted)
),
cleared_labels AS (
    DELETE FROM criterion_threshold_label
    WHERE  criterion IN (SELECT id FROM targeted)
),
cleared_booleans AS (
    DELETE FROM criterion_threshold_boolean
    WHERE  criterion IN (SELECT id FROM targeted)
),
cleared_shares AS (
    DELETE FROM criterion_threshold_share
    WHERE  criterion IN (SELECT id FROM targeted)
),
cleared_criteria AS (
    DELETE FROM criterion WHERE criteria_set = :criteria_set
),
cleared_weights AS (
    DELETE FROM pillar_weight WHERE criteria_set = :criteria_set
),
cleared_match_rules AS (
    DELETE FROM criteria_set_match_rule WHERE criteria_set = :criteria_set
),
cleared_compound_rules AS (
    DELETE FROM criteria_set_compound_rule WHERE criteria_set = :criteria_set
)
DELETE FROM criteria_set WHERE id = :criteria_set;

-- name: duplicate_criteria_set(criteria_set, new_criteria_set, name)$
-- A criteria set is a full copy, never a sparse overlay on another set (reqs.md 3.4, Q191).
-- Everything the source holds is copied: every criterion with its whole interpretation, its
-- scale anchors, whichever of the four matching thresholds it carries, every pillar weight at
-- every level, and both rule opinions. Copying a subset would make the copy read differently
-- from the original the moment the original changed, which is the exact failure the full copy
-- exists to prevent.
--
-- One statement, because a criterion's id is generated and its children hang off it: `copied`
-- returns the new ids, and `mapping` pairs each with the source criterion it came from through
-- the natural key (criteria_set, attribute), which is unique. The source rows the mapping reads
-- are the pre-statement snapshot, so the new rows cannot match themselves.
--
-- It returns how many criteria were copied, which is the one number worth checking: a copy with
-- fewer criteria than its source is a copy that will score differently.
WITH copied_set AS (
    INSERT INTO criteria_set (id, name)
    VALUES (:new_criteria_set, :name)
),
copied_weights AS (
    INSERT INTO pillar_weight (criteria_set, pillar, level, weight, weight_locked)
    SELECT :new_criteria_set, w.pillar, w.level, w.weight, w.weight_locked
    FROM   pillar_weight AS w
    WHERE  w.criteria_set = :criteria_set
),
copied_match_rules AS (
    INSERT INTO criteria_set_match_rule (criteria_set, match_rule, is_enforced)
    SELECT :new_criteria_set, m.match_rule, m.is_enforced
    FROM   criteria_set_match_rule AS m
    WHERE  m.criteria_set = :criteria_set
),
copied_compound_rules AS (
    INSERT INTO criteria_set_compound_rule (criteria_set, compound_rule, is_applied)
    SELECT :new_criteria_set, r.compound_rule, r.is_applied
    FROM   criteria_set_compound_rule AS r
    WHERE  r.criteria_set = :criteria_set
),
copied AS (
    INSERT INTO criterion (
        criteria_set, attribute, value_type, breakdown_option, is_scored, weight,
        weight_locked, goal, target_range_min, target_range_max, zero_score_below,
        zero_score_above, normalisation_method, reducer_mode, blocks_if_missing)
    SELECT :new_criteria_set, c.attribute, c.value_type, c.breakdown_option, c.is_scored,
           c.weight, c.weight_locked, c.goal, c.target_range_min, c.target_range_max,
           c.zero_score_below, c.zero_score_above, c.normalisation_method, c.reducer_mode,
           c.blocks_if_missing
    FROM   criterion AS c
    WHERE  c.criteria_set = :criteria_set
    RETURNING id, attribute, value_type
),
mapping AS (
    SELECT source.id AS source_criterion,
           copied.id AS copied_criterion,
           copied.value_type
    FROM   copied
    JOIN   criterion AS source
           ON source.criteria_set = :criteria_set
          AND source.attribute = copied.attribute
),
copied_anchors AS (
    INSERT INTO criterion_scale_anchor (criterion, input_value, score)
    SELECT mapping.copied_criterion, anchor.input_value, anchor.score
    FROM   criterion_scale_anchor AS anchor
    JOIN   mapping ON mapping.source_criterion = anchor.criterion
),
copied_ranges AS (
    INSERT INTO criterion_threshold_range (criterion, value_type, min_value, max_value)
    SELECT mapping.copied_criterion, mapping.value_type,
           range_threshold.min_value, range_threshold.max_value
    FROM   criterion_threshold_range AS range_threshold
    JOIN   mapping ON mapping.source_criterion = range_threshold.criterion
),
copied_labels AS (
    INSERT INTO criterion_threshold_label (criterion, value_type, label, containment_rule)
    SELECT mapping.copied_criterion, mapping.value_type,
           label_threshold.label, label_threshold.containment_rule
    FROM   criterion_threshold_label AS label_threshold
    JOIN   mapping ON mapping.source_criterion = label_threshold.criterion
),
copied_booleans AS (
    INSERT INTO criterion_threshold_boolean (criterion, value_type, required_value)
    SELECT mapping.copied_criterion, mapping.value_type, boolean_threshold.required_value
    FROM   criterion_threshold_boolean AS boolean_threshold
    JOIN   mapping ON mapping.source_criterion = boolean_threshold.criterion
),
copied_shares AS (
    INSERT INTO criterion_threshold_share (criterion, value_type, label, min_share, max_share)
    SELECT mapping.copied_criterion, mapping.value_type,
           share_threshold.label, share_threshold.min_share, share_threshold.max_share
    FROM   criterion_threshold_share AS share_threshold
    JOIN   mapping ON mapping.source_criterion = share_threshold.criterion
)
SELECT count(*) FROM mapping;

-- name: insert_criterion(criteria_set, attribute, value_type, breakdown_option, is_scored, weight, weight_locked, goal, target_range_min, target_range_max, zero_score_below, zero_score_above, normalisation_method, reducer_mode, blocks_if_missing)<!
-- Attach a criterion to an attribute in a set. The set's own criteria are seeded by migration
-- (arch.md 1.2); this exists for a set built from nothing rather than duplicated.
INSERT INTO criterion (
    criteria_set, attribute, value_type, breakdown_option, is_scored, weight, weight_locked,
    goal, target_range_min, target_range_max, zero_score_below, zero_score_above,
    normalisation_method, reducer_mode, blocks_if_missing)
VALUES (
    :criteria_set, :attribute, :value_type, :breakdown_option, :is_scored, :weight,
    :weight_locked, :goal, :target_range_min, :target_range_max, :zero_score_below,
    :zero_score_above, :normalisation_method, :reducer_mode, :blocks_if_missing)
RETURNING id;

-- name: update_criterion(criteria_set, attribute, is_scored, weight, weight_locked, goal, target_range_min, target_range_max, zero_score_below, zero_score_above, normalisation_method, breakdown_option, reducer_mode, blocks_if_missing)!
-- The whole editable interpretation, written at once. The contract's PATCH changes only the
-- fields present (openapi.yaml), so the caller reads the criterion, applies the change it was
-- given, and writes the result back -- which keeps the merge in `criteria/`, where the
-- rebalancing rules that decide what a weight change means already live.
--
-- value_type is absent deliberately: it is the attribute's, it is immutable, and changing it
-- would break every threshold child pinned to it (arch.md 3.3b).
UPDATE criterion
SET    is_scored            = :is_scored,
       weight               = :weight,
       weight_locked        = :weight_locked,
       goal                 = :goal,
       target_range_min     = :target_range_min,
       target_range_max     = :target_range_max,
       zero_score_below     = :zero_score_below,
       zero_score_above     = :zero_score_above,
       normalisation_method = :normalisation_method,
       breakdown_option     = :breakdown_option,
       reducer_mode         = :reducer_mode,
       blocks_if_missing    = :blocks_if_missing
WHERE  criteria_set = :criteria_set
  AND  attribute = :attribute;

-- name: update_criterion_weight(criteria_set, attribute, weight)!
-- One weight, on its own. Separate from the update above because this is the movement the
-- product is built around: a slider drag writes this and reads a ranking, and nothing else
-- about the criterion is in question.
UPDATE criterion
SET    weight = :weight
WHERE  criteria_set = :criteria_set
  AND  attribute = :attribute;

-- name: update_criterion_weights(criteria_set, attributes, weights)!
-- Rebalancing writes the whole pillar, not one criterion: moving one weight moves every
-- unlocked sibling (reqs.md 5.2). The two arrays are zipped by unnest, so the pillar is written
-- in one statement and can never be observed half-rebalanced.
--
-- A length mismatch produces a NULL weight and the NOT NULL constraint rejects the write, which
-- is the right failure: half a rebalance is worse than none.
UPDATE criterion AS c
SET    weight = replacement.weight
FROM   unnest(:attributes::text[], :weights::numeric[]) AS replacement(attribute, weight)
WHERE  c.criteria_set = :criteria_set
  AND  c.attribute = replacement.attribute;

-- name: delete_criterion(criteria_set, attribute)!
-- Detaching a criterion makes its attribute descriptive again -- present in the catalog, never
-- scored. Its anchors and thresholds go with it, in the same statement, for the same reason
-- delete_criteria_set is one statement.
WITH targeted AS (
    SELECT id FROM criterion WHERE criteria_set = :criteria_set AND attribute = :attribute
),
cleared_anchors AS (
    DELETE FROM criterion_scale_anchor WHERE criterion IN (SELECT id FROM targeted)
),
cleared_ranges AS (
    DELETE FROM criterion_threshold_range WHERE criterion IN (SELECT id FROM targeted)
),
cleared_labels AS (
    DELETE FROM criterion_threshold_label WHERE criterion IN (SELECT id FROM targeted)
),
cleared_booleans AS (
    DELETE FROM criterion_threshold_boolean WHERE criterion IN (SELECT id FROM targeted)
),
cleared_shares AS (
    DELETE FROM criterion_threshold_share WHERE criterion IN (SELECT id FROM targeted)
)
DELETE FROM criterion WHERE id IN (SELECT id FROM targeted);

-- name: upsert_pillar_weight(criteria_set, pillar, level, weight, weight_locked)!
-- One pillar's weight at one level. The level is part of the key: a set holds one opinion about
-- `housing` at country level and a different one at city level (reqs.md Q187).
INSERT INTO pillar_weight (criteria_set, pillar, level, weight, weight_locked)
VALUES (:criteria_set, :pillar, :level, :weight, :weight_locked)
ON CONFLICT (criteria_set, pillar, level) DO UPDATE
SET weight        = EXCLUDED.weight,
    weight_locked = EXCLUDED.weight_locked;

-- name: update_pillar_weights(criteria_set, level, pillars, weights)!
-- The whole level's pillar weights at once, for the same reason update_criterion_weights writes
-- the whole pillar: they sum to 100 within a level, so they move together or the sum is wrong
-- between the two statements.
UPDATE pillar_weight AS w
SET    weight = replacement.weight
FROM   unnest(:pillars::text[], :weights::numeric[]) AS replacement(pillar, weight)
WHERE  w.criteria_set = :criteria_set
  AND  w.level = :level
  AND  w.pillar = replacement.pillar;

-- name: upsert_criteria_set_match_rule(criteria_set, match_rule, is_enforced)!
-- Whether a gate is enforced is a preference, so it is stored per set and never on the rule.
INSERT INTO criteria_set_match_rule (criteria_set, match_rule, is_enforced)
VALUES (:criteria_set, :match_rule, :is_enforced)
ON CONFLICT (criteria_set, match_rule) DO UPDATE SET is_enforced = EXCLUDED.is_enforced;

-- name: upsert_criteria_set_compound_rule(criteria_set, compound_rule, is_applied)!
INSERT INTO criteria_set_compound_rule (criteria_set, compound_rule, is_applied)
VALUES (:criteria_set, :compound_rule, :is_applied)
ON CONFLICT (criteria_set, compound_rule) DO UPDATE SET is_applied = EXCLUDED.is_applied;

-- Scale anchors and matching thresholds. Both are children of one criterion and both are
-- replaced wholesale rather than patched: an anchor list with one point edited and another
-- forgotten is a scale nobody wrote, and the four threshold tables are mutually exclusive, so
-- setting one means clearing whichever was there before.

-- name: replace_criterion_scale_anchors(criterion, input_values, scores, labels)!
-- The whole scale, replaced in one statement, so it is never momentarily empty and a concurrent
-- reader cannot see half of it.
--
-- The delete removes only the points the new scale does not name, and the insert upserts the
-- ones it does. It is written that way because the two halves of a single statement share one
-- snapshot: a CTE that deleted every point would not be visible to the insert beside it, the
-- unique index would still hold the old rows, and re-saving an unchanged scale would fail with
-- a duplicate key. Splitting the keys between the two halves means neither touches the other's
-- rows and there is nothing to conflict over.
--
-- An empty scale is a legal argument: every point is unnamed, so every point is deleted.
WITH cleared AS (
    DELETE FROM criterion_scale_anchor
    WHERE  criterion = :criterion
      AND  input_value <> ALL (:input_values::numeric[])
)
INSERT INTO criterion_scale_anchor (criterion, input_value, score, label)
SELECT :criterion, anchor.input_value, anchor.score, anchor.label
FROM   unnest(:input_values::numeric[], :scores::integer[], :labels::text[])
           AS anchor(input_value, score, label)
ON CONFLICT (criterion, input_value)
DO UPDATE SET score = EXCLUDED.score, label = EXCLUDED.label;

-- name: clear_criterion_thresholds(criterion)!
-- Null clears the matching threshold (openapi.yaml), and which of the four tables held it is
-- not the caller's business. All four are cleared; at most one had a row.
--
-- The row count this returns is the last DELETE's alone -- almost always zero, since the share
-- table is almost never the one that held the threshold. Do not read it as a report of what was
-- cleared. The same is true of every multi-statement delete in this file.
WITH cleared_ranges AS (
    DELETE FROM criterion_threshold_range WHERE criterion = :criterion
),
cleared_labels AS (
    DELETE FROM criterion_threshold_label WHERE criterion = :criterion
),
cleared_booleans AS (
    DELETE FROM criterion_threshold_boolean WHERE criterion = :criterion
)
DELETE FROM criterion_threshold_share WHERE criterion = :criterion;

-- name: insert_criterion_threshold_range(criterion, value_type, min_value, max_value)!
-- For the six numeric types. The composite foreign key refuses to attach it to a LabelSet or a
-- Boolean criterion, so nothing here re-checks the type (arch.md 3.3b).
INSERT INTO criterion_threshold_range (criterion, value_type, min_value, max_value)
VALUES (:criterion, :value_type, :min_value, :max_value);

-- name: insert_criterion_threshold_labels(criterion, labels, containment_rules)!
-- A LabelSet threshold is a list of label/rule pairs, written in one statement.
INSERT INTO criterion_threshold_label (criterion, value_type, label, containment_rule)
SELECT :criterion, 'LabelSet', pair.label, pair.containment_rule
FROM   unnest(:labels::text[], :containment_rules::text[]) AS pair(label, containment_rule);

-- name: insert_criterion_threshold_boolean(criterion, required_value)!
INSERT INTO criterion_threshold_boolean (criterion, value_type, required_value)
VALUES (:criterion, 'Boolean', :required_value);

-- name: insert_criterion_threshold_share(criterion, label, min_share, max_share)!
-- A bound on one named label's share of a composition.
INSERT INTO criterion_threshold_share (criterion, value_type, label, min_share, max_share)
VALUES (:criterion, 'ShareComposition', :label, :min_share, :max_share);

-- MatchRuleResultStore (arch.md 6.3). A gate's answer for a candidate, with the pages it was
-- read from and any override.

-- name: select_match_rule_results(candidate, match_rule, level)
-- Every gate answer the eligibility step needs, in one read. :level returns the whole level at
-- once rather than one candidate at a time -- the ranking decides eligibility for every
-- candidate in the same pass, and a query per candidate would be the shape arch.md 7.2 rules
-- out for the values read.
--
-- Citations travel with the answer. A gate is displayed as the reason a candidate is out, so it
-- carries the same obligation to show its sources that a value does (reqs.md 3.7, 6.9).
SELECT r.match_rule,
       r.candidate,
       r.match_result,
       r.reason,
       r.data_source,
       r.reference_period_start,
       r.reference_period_end,
       r.retrieval_date,
       r.override_reason,
       r.override_date,
       COALESCE(
           (SELECT jsonb_agg(citation.url ORDER BY citation.url)
            FROM   match_rule_result_citation AS citation
            WHERE  citation.match_rule = r.match_rule
              AND  citation.candidate = r.candidate),
           '[]'::jsonb) AS citations
FROM   match_rule_result AS r
JOIN   candidate AS c ON c.id = r.candidate
WHERE  (:candidate::text IS NULL OR r.candidate = :candidate)
  AND  (:match_rule::text IS NULL OR r.match_rule = :match_rule)
  AND  (:level::text IS NULL OR c.level = :level)
ORDER  BY r.candidate, r.match_rule;

-- name: upsert_match_rule_result(match_rule, candidate, match_result, reason, data_source, reference_period_start, reference_period_end, retrieval_date, override_reason, override_date)!
-- One answer per gate per candidate, so a re-run replaces rather than accumulates. This is also
-- how a candidate is ruled out by hand: the not_manually_excluded rule, answered not_matching,
-- with an override reason and the date it was given (reqs.md Q152).
--
-- The override pair is all-or-nothing in the schema, so passing a reason without a date is
-- rejected rather than silently stored as an unattributed exclusion.
INSERT INTO match_rule_result (
    match_rule, candidate, match_result, reason, data_source,
    reference_period_start, reference_period_end, retrieval_date,
    override_reason, override_date)
VALUES (:match_rule, :candidate, :match_result, :reason, :data_source,
        :reference_period_start, :reference_period_end, :retrieval_date,
        :override_reason, :override_date)
ON CONFLICT (match_rule, candidate) DO UPDATE
SET match_result           = EXCLUDED.match_result,
    reason                 = EXCLUDED.reason,
    data_source            = EXCLUDED.data_source,
    reference_period_start = EXCLUDED.reference_period_start,
    reference_period_end   = EXCLUDED.reference_period_end,
    retrieval_date         = EXCLUDED.retrieval_date,
    override_reason        = EXCLUDED.override_reason,
    override_date          = EXCLUDED.override_date;

-- name: replace_match_rule_result_citations(match_rule, candidate, urls)!
-- The pages behind the answer, replaced with it. Old citations belong to the old answer.
--
-- Split between the two halves for the reason replace_criterion_scale_anchors explains: a CTE
-- delete is invisible to the insert beside it, so the delete takes only the URLs the new list
-- drops and the insert lets the ones it keeps conflict harmlessly.
WITH cleared AS (
    DELETE FROM match_rule_result_citation
    WHERE  match_rule = :match_rule
      AND  candidate = :candidate
      AND  url <> ALL (:urls::text[])
)
INSERT INTO match_rule_result_citation (match_rule, candidate, url)
SELECT :match_rule, :candidate, url
FROM   unnest(:urls::text[]) AS url
ON CONFLICT DO NOTHING;
