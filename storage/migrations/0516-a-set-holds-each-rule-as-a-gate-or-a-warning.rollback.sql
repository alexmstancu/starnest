-- Undo 0516: every rule does what the catalog says again, in every set and every saved ranking.
--
-- **This rollback refuses while anything depends on the outcome being per set**, and that is
-- the point. A set holding a rule otherwise than by default -- a gate as a warning, a compound
-- rule against its catalog outcome -- would silently start doing the opposite of what its
-- owner chose; a saved ranking that froze such a choice, or a gate warning, would stop
-- explaining its own statuses (0107). Outcomes held at their default carry nothing the
-- catalog does not, so they go quietly.
--
-- **Locked before it counts** (BE-A1, following 0507): a choice committed between the count and
-- the drop would escape the refusal -- and so would a catalog outcome changed under the count.
LOCK TABLE criteria_set_match_rule, criteria_set_compound_rule, compound_rule,
           evaluation_match_rule, evaluation_compound_rule, candidate_gate_warning
           IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    chosen integer;
    frozen integer;
BEGIN
    SELECT (SELECT count(*) FROM criteria_set_match_rule WHERE outcome = 'warning')
         + (SELECT count(*)
            FROM   criteria_set_compound_rule AS applied
            JOIN   compound_rule AS rule ON rule.id = applied.compound_rule
            WHERE  applied.outcome <> rule.outcome)
    INTO   chosen;
    SELECT (SELECT count(*) FROM evaluation_match_rule WHERE outcome = 'warning')
         + (SELECT count(*)
            FROM   evaluation_compound_rule AS applied
            JOIN   compound_rule AS rule ON rule.id = applied.compound_rule
            WHERE  applied.outcome <> rule.outcome)
         + (SELECT count(*) FROM candidate_gate_warning)
    INTO   frozen;

    IF chosen + frozen > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0516: % criteria set rule(s) and % saved-ranking row(s) hold a rule '
            'as a gate or a warning otherwise than the catalog does, and this drops the columns '
            'that say so. Put each set''s rules back to their default outcome, or restore from '
            'the backup make migrate took, instead of forcing this.', chosen, frozen;
    END IF;
END $$;

DROP TABLE IF EXISTS candidate_gate_warning;

ALTER TABLE evaluation_compound_rule DROP COLUMN IF EXISTS outcome;
ALTER TABLE evaluation_match_rule DROP COLUMN IF EXISTS outcome;
ALTER TABLE criteria_set_compound_rule DROP COLUMN IF EXISTS outcome;
ALTER TABLE criteria_set_match_rule DROP COLUMN IF EXISTS outcome;
