-- A criterion carries one share bound and one label threshold at most (PL-169: ST-17, IN-LABEL;
-- decision D62).
--
-- depends: 0510-a-gate-answer-is-kept-once-written
--
-- **The two tables were keyed for several bounds, and every other layer models one**: the domain
-- (`ShareThreshold`, `LabelThreshold`), the API, and the contract, whose `labels` stays a
-- one-entry array. `0009` keyed both on (criterion, label), so the schema admitted what nothing
-- could read:
--
--   * a second **share** bound was read as the first and the rest ignored -- then deleted by the
--     next whole-set rewrite, an edit to anything at all;
--   * a second **label** threshold made the reader refuse the criterion, so the whole set, every
--     ranking under it and every edit to it answered 500.
--
-- So each table now holds one row per criterion. **A criterion that already carries several
-- stops the migration and is named**, with its set, its attribute and every label it carries --
-- never resolved by keeping one: which bound was meant is the household's to say. Remove the
-- extras from Configure or `psql`, then migrate again.

-- **Locked first, and exclusively** (BE-A1): a bound written between the check and the
-- constraint would meet a raw unique violation rather than the refusal below. ACCESS EXCLUSIVE,
-- because adding a unique constraint takes it anyway, and upgrading to it from a weaker lock can
-- deadlock against a reader that means to write. `criterion` is read to name the offenders.
LOCK TABLE criterion_threshold_share, criterion_threshold_label, criterion
           IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(offender, '; ' ORDER BY offender) INTO offenders
    FROM (
        SELECT format('%s in set %s has %s share bounds (on %s)',
                      c.attribute, c.criteria_set, count(*),
                      string_agg(bound.label, ', ' ORDER BY bound.label))
        FROM   criterion_threshold_share AS bound
        JOIN   criterion AS c ON c.id = bound.criterion
        GROUP  BY c.id, c.attribute, c.criteria_set
        HAVING count(*) > 1
        UNION ALL
        SELECT format('%s in set %s has %s label thresholds (%s)',
                      c.attribute, c.criteria_set, count(*),
                      string_agg(format('%s %s', bound.containment_rule, bound.label), ', '
                                 ORDER BY bound.label))
        FROM   criterion_threshold_label AS bound
        JOIN   criterion AS c ON c.id = bound.criterion
        GROUP  BY c.id, c.attribute, c.criteria_set
        HAVING count(*) > 1
    ) AS several (offender);
    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot apply 0520: a criterion carries one share bound and one label threshold, and '
            'these carry more: %. Keep the one that was meant and remove the rest, then migrate '
            'again; this migration will not choose. Nothing was changed.', offenders;
    END IF;
END $$;

ALTER TABLE criterion_threshold_share
    ADD CONSTRAINT criterion_threshold_share_one_per_criterion UNIQUE (criterion);

ALTER TABLE criterion_threshold_label
    ADD CONSTRAINT criterion_threshold_label_one_per_criterion UNIQUE (criterion);
