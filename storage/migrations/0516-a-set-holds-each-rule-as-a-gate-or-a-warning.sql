-- A set holds each rule it turns on as a gate or as a warning (PL-157, UF-041, D56).
--
-- depends: 0512-a-run-records-its-plan
--
-- What a rule does when it fires was catalog data: a gate always ruled a candidate out, and a
-- compound rule did whatever `compound_rule.outcome` said, in every set. Whether it counts was
-- already the set's preference (`criteria_set_match_rule`, `criteria_set_compound_rule`); what
-- it does when it counts is a preference of the same kind -- one set may want the Swiss quota
-- to rule Switzerland out while another only wants to be told -- so it moves beside it.
--
-- **Stored with the set's rule association, and only for a rule that is on**, as the sparse
-- model requires: off is the absence of a row, so an outcome exists exactly where the rule is
-- on, and a CHECK says so for any older row still carrying a false flag. A rule the set turns
-- on is seeded with what it did until now -- `not_matching` for a gate, the catalog's outcome
-- for a compound rule -- so this changes no ranking. A migration that later turns a rule on
-- must name the outcome in its upsert.
--
-- **A saved ranking freezes it** beside 0507's frozen rule lists, so it keeps meaning what it
-- meant; and a gate held as a warning keeps its warning in `candidate_gate_warning`, naming
-- the answer version it read, the mirror of a gate refusal's `match_rule_answer` (0510).

-- **Locked first** (BE-A1): an edit committed between the backfill and the CHECK would break it.
LOCK TABLE criteria_set_match_rule, criteria_set_compound_rule,
           evaluation_match_rule, evaluation_compound_rule
           IN SHARE ROW EXCLUSIVE MODE;

-- 1. The live outcome, per set and rule.
ALTER TABLE criteria_set_match_rule ADD COLUMN outcome text;
UPDATE criteria_set_match_rule SET outcome = 'not_matching' WHERE is_enforced;
ALTER TABLE criteria_set_match_rule
    ADD CONSTRAINT criteria_set_match_rule_outcome_is_known
    CHECK (outcome IN ('warning', 'not_matching'));
ALTER TABLE criteria_set_match_rule
    ADD CONSTRAINT criteria_set_match_rule_holds_an_outcome_only_when_on
    CHECK ((outcome IS NOT NULL) = is_enforced);

ALTER TABLE criteria_set_compound_rule ADD COLUMN outcome text;
UPDATE criteria_set_compound_rule AS applied
SET    outcome = rule.outcome
FROM   compound_rule AS rule
WHERE  rule.id = applied.compound_rule AND applied.is_applied;
ALTER TABLE criteria_set_compound_rule
    ADD CONSTRAINT criteria_set_compound_rule_outcome_is_known
    CHECK (outcome IN ('warning', 'not_matching'));
ALTER TABLE criteria_set_compound_rule
    ADD CONSTRAINT criteria_set_compound_rule_holds_an_outcome_only_when_on
    CHECK ((outcome IS NOT NULL) = is_applied);

COMMENT ON COLUMN criteria_set_match_rule.outcome IS
    'What the gate does in this set when a candidate fails it: not_matching rules it out, warning flags it (D56). Set exactly when the gate is enforced.';
COMMENT ON COLUMN criteria_set_compound_rule.outcome IS
    'What the rule does in this set when it fires, overriding compound_rule.outcome (D56). Set exactly when the rule is applied.';

-- 2. The frozen outcome, per saved ranking and rule. Every row already saved was computed with
--    the old fixed outcomes, so that is what it froze. A gate's default is a gate, a fact about
--    gates rather than a copy of catalog data, so it stays the column's default.
ALTER TABLE evaluation_match_rule ADD COLUMN outcome text NOT NULL DEFAULT 'not_matching';
ALTER TABLE evaluation_match_rule
    ADD CONSTRAINT evaluation_match_rule_outcome_is_known
    CHECK (outcome IN ('warning', 'not_matching'));

ALTER TABLE evaluation_compound_rule ADD COLUMN outcome text;
UPDATE evaluation_compound_rule AS applied
SET    outcome = rule.outcome
FROM   compound_rule AS rule
WHERE  rule.id = applied.compound_rule;
ALTER TABLE evaluation_compound_rule ALTER COLUMN outcome SET NOT NULL;
ALTER TABLE evaluation_compound_rule
    ADD CONSTRAINT evaluation_compound_rule_outcome_is_known
    CHECK (outcome IN ('warning', 'not_matching'));

-- 3. A gate a saved ranking held as a warning, and failed: the warning, with the answer version
--    it read. Dies with its result, as every row hanging off one does (0482).
CREATE TABLE candidate_gate_warning (
    candidate_result  bigint NOT NULL REFERENCES candidate_result (id) ON DELETE CASCADE,
    match_rule        text   NOT NULL REFERENCES match_rule (id),
    match_rule_answer bigint NOT NULL,
    detail            text   NOT NULL,

    CONSTRAINT candidate_gate_warning_pkey PRIMARY KEY (candidate_result, match_rule),
    CONSTRAINT candidate_gate_warning_cites_a_version_of_its_gate
        FOREIGN KEY (match_rule_answer, match_rule) REFERENCES match_rule_answer (id, match_rule)
);
