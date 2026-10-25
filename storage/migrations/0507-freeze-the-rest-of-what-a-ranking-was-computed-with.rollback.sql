-- Undo the extra freeze, returning a reopened ranking to live pillar locks, no recorded rule
-- lists, and a not_matching rule with no input chain. Touches the two columns and three tables
-- 0507 added.
--
-- **This rollback refuses once a saved evaluation has frozen any of it, and that is the point
-- (FU-A5).** The three tables hold a saved ranking's frozen interpretation: which gates it
-- enforced, which compound rules it applied, and the value rows behind a rule that ruled a
-- candidate out. A saved evaluation is a frozen record whose whole promise is that it still
-- explains its score later (0107); dropping these tables would quietly empty that provenance
-- from every saved ranking, breaking a stronger guarantee than the one the rollback restores --
-- exactly the shape of 0478's refusal over frozen figures.
--
-- **The two dropped columns refuse too** (SV-N1, D70). A ranking from a set with no enforced
-- gate and no applied compound rule writes none of the three tables' rows, yet still froze its
-- pillar locks; the tables were not a faithful witness for it. A column takes its whole table's
-- data with it, so any saved criterion row or warning input row is history this would drop.
--
-- **Locked before it counts** (FU-A5, following 0478/0503). The count reads the three tables; a
-- save committed between the read and the drop would escape the refusal. SHARE ROW EXCLUSIVE
-- waits for a write in flight and holds off new ones until this commits, while reads go on.
LOCK TABLE evaluation_match_rule, evaluation_compound_rule, non_match_input,
           evaluation_criterion, candidate_warning_input IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    frozen integer;
BEGIN
    SELECT (SELECT count(*) FROM evaluation_match_rule)
         + (SELECT count(*) FROM evaluation_compound_rule)
         + (SELECT count(*) FROM non_match_input)
    INTO   frozen;

    IF frozen > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0507: % saved-evaluation row(s) freeze which rules a ranking '
            'enforced and applied and the figures behind a not_matching rule, and this drops the '
            'tables that hold them. A saved evaluation must still explain its score (0107), so '
            'restore from the backup make migrate took instead of forcing this.', frozen;
    END IF;
END $$;

DO $$
DECLARE
    frozen integer;
BEGIN
    SELECT (SELECT count(*) FROM evaluation_criterion)
         + (SELECT count(*) FROM candidate_warning_input)
    INTO   frozen;

    IF frozen > 0 THEN
        RAISE EXCEPTION
            'cannot roll back 0507: % saved-evaluation row(s) freeze the pillar locks of a '
            'ranking or the order of the figures behind a warning, and this drops the columns '
            'that hold them. '
            'A saved evaluation must still explain its score (0107), so restore from the backup '
            'make migrate took instead of forcing this.', frozen;
    END IF;
END $$;

-- Below here only runs on a database where no saved ranking froze any of this -- which includes
-- every fresh one and the test database, so the drop path is still exercised.
DROP TABLE IF EXISTS non_match_input;
DROP TABLE IF EXISTS evaluation_compound_rule;
DROP TABLE IF EXISTS evaluation_match_rule;

ALTER TABLE candidate_warning_input DROP COLUMN IF EXISTS ordinal;
ALTER TABLE evaluation_criterion DROP COLUMN IF EXISTS pillar_weight_locked;
