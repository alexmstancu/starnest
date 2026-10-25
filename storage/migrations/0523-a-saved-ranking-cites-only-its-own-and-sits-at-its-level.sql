-- A saved ranking cites only its own candidate's evidence, and sits at its own level (PL-147:
-- ST-13, SV-N6; PL-148: ST-14, SV-N7).
--
-- depends: 0513-a-runs-evidence-is-pinned-to-its-items
--
-- `0108` pinned a result to its evaluation's level and a reason to its evaluation's frozen
-- criterion, and stopped there. So a contribution could cite another candidate's figure, or a
-- figure of another attribute, or an attribute its evaluation never froze -- and the reopened
-- drill-down then read a NULL pillar and answered 500. A refusal's figure or gate answer, a gate
-- warning's answer and a compound rule's input figures could each be another candidate's; a
-- refusal's inputs needed no refusal at all. A frozen criterion carried no level, and neither did
-- a frozen rule list, so a set saved whole froze another level's slice beside its own.
--
-- **Keys, in the idiom `candidate_level_key` set** (0002, 0108, 0460, 0513), never a trigger:
-- - `value` gains `UNIQUE (id, candidate, attribute)` and `UNIQUE (id, candidate)`, and a result
--   `UNIQUE (id, candidate)`, for the pins below to name;
-- - a contribution carries its result's evaluation and candidate, copied from the result: it
--   names a criterion its evaluation froze, and a figure of its own candidate and attribute;
-- - a refusal, a gate warning and a compound rule's inputs carry their result's candidate: a
--   refusal's figure is its own candidate's for its own attribute, a gate answer is its own
--   candidate's, an input figure is its own candidate's, and a refusal's inputs hang off the
--   refusal by their rule. The inputs carry no attribute, and pinning them to a live rule
--   condition would tie a frozen record to an editable catalog row (D4);
-- - a frozen criterion carries its evaluation's level, and its attribute must sit at it
--   (`attribute_level_key`, 0460, reused);
-- - a frozen gate or compound rule carries the catalog's level for it, which must be its
--   evaluation's. A gate asked at every level has none and pins nothing: that residue is
--   recorded in `known-issues.md` (D5).
--
-- Keys into the evaluation tree cascade (0482); keys to `value` and to the catalog never do.
-- A figure in `used_value` or `value_id` that is NULL pins nothing, by `MATCH SIMPLE`.
--
-- **It refuses before changing anything** when a saved row breaks a rule, naming each kind with
-- its count and one example. Such a row cannot be repaired here: what it should have cited is
-- not recorded anywhere.

-- **Locked first** (BE-A1, P98): the check reads every table it then keys, and the backfills copy
-- a parent's column, so a row saved in between would escape the check or break a key. In the
-- order a save writes them, so a save in flight finishes first rather than deadlocking.
LOCK TABLE evaluation,
           evaluation_criterion,
           evaluation_match_rule,
           evaluation_compound_rule,
           candidate_result,
           candidate_attribute_score,
           non_match_reason,
           candidate_gate_warning,
           candidate_warning_input,
           non_match_input,
           value,
           attribute,
           match_rule,
           compound_rule,
           match_rule_answer
    IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s: %s, e.g. %s', kind, how_many, example), '; ' ORDER BY kind)
    INTO   offenders
    FROM (
        SELECT 'a contribution citing a figure not its own' AS kind, count(*) AS how_many,
               min(format('result %s, %s cites value %s (%s, %s)',
                          s.candidate_result, s.attribute, v.id, v.candidate, v.attribute))
                   AS example
        FROM   candidate_attribute_score AS s
        JOIN   candidate_result AS r ON r.id = s.candidate_result
        JOIN   value AS v ON v.id = s.used_value
        WHERE  (v.candidate, v.attribute) <> (r.candidate, s.attribute)
        UNION ALL
        SELECT 'a contribution for an attribute its evaluation did not freeze', count(*),
               min(format('result %s, %s', s.candidate_result, s.attribute))
        FROM   candidate_attribute_score AS s
        JOIN   candidate_result AS r ON r.id = s.candidate_result
        WHERE  NOT EXISTS (SELECT 1 FROM evaluation_criterion AS c
                           WHERE  (c.evaluation, c.attribute) = (r.evaluation, s.attribute))
        UNION ALL
        SELECT 'a refusal citing a figure not its own', count(*),
               min(format('reason %s cites value %s (%s, %s)',
                          n.id, v.id, v.candidate, v.attribute))
        FROM   non_match_reason AS n
        JOIN   candidate_result AS r ON r.id = n.candidate_result
        JOIN   value AS v ON v.id = n.used_value
        WHERE  (v.candidate, v.attribute) IS DISTINCT FROM (r.candidate, n.attribute)
        UNION ALL
        SELECT 'a refusal citing another candidate''s gate answer', count(*),
               min(format('reason %s cites answer %s (%s)', n.id, a.id, a.candidate))
        FROM   non_match_reason AS n
        JOIN   candidate_result AS r ON r.id = n.candidate_result
        JOIN   match_rule_answer AS a ON a.id = n.match_rule_answer
        WHERE  a.candidate <> r.candidate
        UNION ALL
        SELECT 'a gate warning citing another candidate''s answer', count(*),
               min(format('result %s, %s cites answer %s (%s)',
                          w.candidate_result, w.match_rule, a.id, a.candidate))
        FROM   candidate_gate_warning AS w
        JOIN   candidate_result AS r ON r.id = w.candidate_result
        JOIN   match_rule_answer AS a ON a.id = w.match_rule_answer
        WHERE  a.candidate <> r.candidate
        UNION ALL
        SELECT 'a compound rule''s input from another candidate', count(*),
               min(format('result %s, %s cites value %s (%s)',
                          i.candidate_result, i.compound_rule, v.id, v.candidate))
        FROM   (SELECT candidate_result, compound_rule, value_id FROM candidate_warning_input
                UNION ALL
                SELECT candidate_result, compound_rule, value_id FROM non_match_input) AS i
        JOIN   candidate_result AS r ON r.id = i.candidate_result
        JOIN   value AS v ON v.id = i.value_id
        WHERE  v.candidate <> r.candidate
        UNION ALL
        SELECT 'an input to a refusal its result does not hold', count(*),
               min(format('result %s, %s', i.candidate_result, i.compound_rule))
        FROM   non_match_input AS i
        WHERE  NOT EXISTS (SELECT 1 FROM non_match_reason AS n
                           WHERE  (n.candidate_result, n.compound_rule)
                                  = (i.candidate_result, i.compound_rule))
        UNION ALL
        SELECT 'a result refused twice by one compound rule', count(*),
               min(format('result %s, %s', twice.candidate_result, twice.compound_rule))
        FROM   (SELECT candidate_result, compound_rule FROM non_match_reason
                WHERE  compound_rule IS NOT NULL
                GROUP  BY candidate_result, compound_rule
                HAVING count(*) > 1) AS twice
        UNION ALL
        SELECT 'a frozen criterion at another level than its evaluation', count(*),
               min(format('evaluation %s (%s) froze %s (%s)', e.id, e.level, a.id, a.level))
        FROM   evaluation_criterion AS c
        JOIN   evaluation AS e ON e.id = c.evaluation
        JOIN   attribute AS a ON a.id = c.attribute
        WHERE  a.level <> e.level
        UNION ALL
        SELECT 'a frozen rule at another level than its evaluation', count(*),
               min(format('evaluation %s (%s) froze %s (%s)', e.id, e.level, frozen.id, frozen.level))
        FROM   (SELECT f.evaluation, m.id, m.level
                FROM   evaluation_match_rule AS f JOIN match_rule AS m ON m.id = f.match_rule
                UNION ALL
                SELECT f.evaluation, k.id, k.level
                FROM   evaluation_compound_rule AS f
                JOIN   compound_rule AS k ON k.id = f.compound_rule) AS frozen
        JOIN   evaluation AS e ON e.id = frozen.evaluation
        WHERE  frozen.level <> e.level
    ) AS offence
    WHERE  how_many > 0;

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'nothing was changed: a saved ranking must cite only its own candidates'' evidence '
            'and freeze only its own level. Found %. What such a row should have cited is not '
            'recorded, so delete the saved ranking it belongs to -- then migrate again.',
            offenders;
    END IF;
END $$;

-- The keys the pins below name.
ALTER TABLE value
    ADD CONSTRAINT value_candidate_attribute_key UNIQUE (id, candidate, attribute),
    ADD CONSTRAINT value_candidate_key UNIQUE (id, candidate);
ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_candidate_key UNIQUE (id, candidate);
ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_one_per_compound_rule UNIQUE (candidate_result, compound_rule);
ALTER TABLE compound_rule
    ADD CONSTRAINT compound_rule_level_key UNIQUE (id, level);

-- ST-14: the frozen criteria and rule lists, at their evaluation's level.
ALTER TABLE evaluation_criterion ADD COLUMN level text;
UPDATE evaluation_criterion AS c
SET    level = e.level
FROM   evaluation AS e
WHERE  e.id = c.evaluation;
ALTER TABLE evaluation_criterion
    ALTER COLUMN level SET NOT NULL,
    ADD CONSTRAINT evaluation_criterion_is_at_its_evaluations_level
        FOREIGN KEY (evaluation, level) REFERENCES evaluation (id, level) ON DELETE CASCADE,
    ADD CONSTRAINT evaluation_criterion_judges_an_attribute_at_that_level
        FOREIGN KEY (attribute, level) REFERENCES attribute (id, level);

ALTER TABLE evaluation_match_rule ADD COLUMN level text;
UPDATE evaluation_match_rule AS f
SET    level = m.level
FROM   match_rule AS m
WHERE  m.id = f.match_rule;
ALTER TABLE evaluation_match_rule
    ADD CONSTRAINT evaluation_match_rule_is_at_its_evaluations_level
        FOREIGN KEY (evaluation, level) REFERENCES evaluation (id, level) ON DELETE CASCADE,
    ADD CONSTRAINT evaluation_match_rule_is_a_gate_at_that_level
        FOREIGN KEY (match_rule, level) REFERENCES match_rule (id, level);

ALTER TABLE evaluation_compound_rule ADD COLUMN level text;
UPDATE evaluation_compound_rule AS f
SET    level = k.level
FROM   compound_rule AS k
WHERE  k.id = f.compound_rule;
ALTER TABLE evaluation_compound_rule
    ADD CONSTRAINT evaluation_compound_rule_is_at_its_evaluations_level
        FOREIGN KEY (evaluation, level) REFERENCES evaluation (id, level) ON DELETE CASCADE,
    ADD CONSTRAINT evaluation_compound_rule_is_a_rule_at_that_level
        FOREIGN KEY (compound_rule, level) REFERENCES compound_rule (id, level);

-- ST-13: a contribution names its own measurement and a criterion its evaluation froze.
ALTER TABLE candidate_attribute_score ADD COLUMN evaluation bigint, ADD COLUMN candidate text;
UPDATE candidate_attribute_score AS s
SET    evaluation = r.evaluation, candidate = r.candidate
FROM   candidate_result AS r
WHERE  r.id = s.candidate_result;
ALTER TABLE candidate_attribute_score
    ALTER COLUMN evaluation SET NOT NULL,
    ALTER COLUMN candidate SET NOT NULL,
    ADD CONSTRAINT candidate_attribute_score_is_of_its_results_evaluation
        FOREIGN KEY (candidate_result, evaluation) REFERENCES candidate_result (id, evaluation)
        ON DELETE CASCADE,
    ADD CONSTRAINT candidate_attribute_score_is_of_its_results_candidate
        FOREIGN KEY (candidate_result, candidate) REFERENCES candidate_result (id, candidate)
        ON DELETE CASCADE,
    ADD CONSTRAINT candidate_attribute_score_names_a_frozen_criterion
        FOREIGN KEY (evaluation, attribute) REFERENCES evaluation_criterion (evaluation, attribute)
        ON DELETE CASCADE,
    ADD CONSTRAINT candidate_attribute_score_cites_its_own_measurement
        FOREIGN KEY (used_value, candidate, attribute) REFERENCES value (id, candidate, attribute);

-- D4: every other piece of evidence a result keeps is its own candidate's.
ALTER TABLE non_match_reason ADD COLUMN candidate text;
UPDATE non_match_reason AS n
SET    candidate = r.candidate
FROM   candidate_result AS r
WHERE  r.id = n.candidate_result;
ALTER TABLE non_match_reason
    ALTER COLUMN candidate SET NOT NULL,
    ADD CONSTRAINT non_match_reason_is_of_its_results_candidate
        FOREIGN KEY (candidate_result, candidate) REFERENCES candidate_result (id, candidate)
        ON DELETE CASCADE,
    ADD CONSTRAINT non_match_reason_cites_its_own_measurement
        FOREIGN KEY (used_value, candidate, attribute) REFERENCES value (id, candidate, attribute),
    ADD CONSTRAINT non_match_reason_cites_its_own_candidate_s_answer
        FOREIGN KEY (match_rule_answer, match_rule, candidate)
        REFERENCES match_rule_answer (id, match_rule, candidate);

ALTER TABLE candidate_gate_warning ADD COLUMN candidate text;
UPDATE candidate_gate_warning AS w
SET    candidate = r.candidate
FROM   candidate_result AS r
WHERE  r.id = w.candidate_result;
ALTER TABLE candidate_gate_warning
    ALTER COLUMN candidate SET NOT NULL,
    ADD CONSTRAINT candidate_gate_warning_is_of_its_results_candidate
        FOREIGN KEY (candidate_result, candidate) REFERENCES candidate_result (id, candidate)
        ON DELETE CASCADE,
    ADD CONSTRAINT candidate_gate_warning_cites_its_own_candidate_s_answer
        FOREIGN KEY (match_rule_answer, match_rule, candidate)
        REFERENCES match_rule_answer (id, match_rule, candidate);

ALTER TABLE candidate_warning_input ADD COLUMN candidate text;
UPDATE candidate_warning_input AS i
SET    candidate = r.candidate
FROM   candidate_result AS r
WHERE  r.id = i.candidate_result;
ALTER TABLE candidate_warning_input
    ALTER COLUMN candidate SET NOT NULL,
    ADD CONSTRAINT candidate_warning_input_is_of_its_results_candidate
        FOREIGN KEY (candidate_result, candidate) REFERENCES candidate_result (id, candidate)
        ON DELETE CASCADE,
    ADD CONSTRAINT candidate_warning_input_cites_its_own_candidate_s_figure
        FOREIGN KEY (value_id, candidate) REFERENCES value (id, candidate);

ALTER TABLE non_match_input ADD COLUMN candidate text;
UPDATE non_match_input AS i
SET    candidate = r.candidate
FROM   candidate_result AS r
WHERE  r.id = i.candidate_result;
ALTER TABLE non_match_input
    ALTER COLUMN candidate SET NOT NULL,
    ADD CONSTRAINT non_match_input_is_of_its_results_candidate
        FOREIGN KEY (candidate_result, candidate) REFERENCES candidate_result (id, candidate)
        ON DELETE CASCADE,
    ADD CONSTRAINT non_match_input_cites_its_own_candidate_s_figure
        FOREIGN KEY (value_id, candidate) REFERENCES value (id, candidate),
    ADD CONSTRAINT non_match_input_belongs_to_a_refusal
        FOREIGN KEY (candidate_result, compound_rule)
        REFERENCES non_match_reason (candidate_result, compound_rule) ON DELETE CASCADE;

COMMENT ON COLUMN evaluation_criterion.level IS
    'The evaluation''s level, which the frozen attribute must share (PL-148).';
COMMENT ON COLUMN evaluation_match_rule.level IS
    'The gate''s own level, which must be the evaluation''s; null for a gate asked at every level (PL-148).';
COMMENT ON COLUMN evaluation_compound_rule.level IS
    'The rule''s own level, which must be the evaluation''s (PL-148).';
COMMENT ON COLUMN candidate_attribute_score.evaluation IS
    'The result''s evaluation, so the contribution can name only a criterion it froze (PL-147).';
COMMENT ON COLUMN candidate_attribute_score.candidate IS
    'The result''s candidate, so the contribution can cite only that candidate''s figure (PL-147).';
COMMENT ON COLUMN non_match_reason.candidate IS
    'The result''s candidate, whose figure or gate answer alone the refusal may cite (PL-147).';
COMMENT ON COLUMN candidate_gate_warning.candidate IS
    'The result''s candidate, whose gate answer alone the warning may cite (PL-147).';
COMMENT ON COLUMN candidate_warning_input.candidate IS
    'The result''s candidate, whose figures alone the warning may cite (PL-147).';
COMMENT ON COLUMN non_match_input.candidate IS
    'The result''s candidate, whose figures alone the refusal may cite (PL-147).';
