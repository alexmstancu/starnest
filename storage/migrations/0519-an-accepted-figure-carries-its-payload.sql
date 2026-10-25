-- An accepted figure carries its payload, and a share composition sums to 100 (PL-168: ST-15;
-- decision D60).
--
-- depends: 0516-a-set-holds-each-rule-as-a-gate-or-a-warning
--
-- **The type-agreement chain (`0005`, `0006`) says which payload a figure may carry, never that
-- it carries one.** A value accepted with no payload row, a LabelSet or ShareComposition with no
-- label, or a composition summing to 80 were all storable -- and the domain refuses each on read
-- (`MalformedValueError`, the `ShareComposition` validator). `select_active_values` reads a whole
-- level, so one such row made the ranking, the values screen and every comparison at that level
-- answer 500. The application's single writer always kept the rule; `psql`, a restore or a second
-- client need not.
--
-- Both rules span rows -- a parent and its children, or a composition's shares -- which neither a
-- foreign key nor a CHECK can express. So these are the schema's **first functions and
-- triggers**, and they are **deferred constraint triggers**: a figure and its payload are written
-- as two statements, so the rule is judged at COMMIT, when the writer's own payload is visible.
--
--   * **completeness**: a value with no `rejection_reason` has the payload its type declares --
--     one row for the eight scalar types, at least one for LabelSet and ShareComposition. Judged
--     when a value is inserted or re-accepted (`0473`'s rollback re-accepts), and when a payload
--     row is deleted or moved away from its figure. A figure deleted with its payload passes.
--   * **the share sum**: every stored composition, **accepted or rejected**, sums to 100 within
--     0.5 -- the domain reads a rejected one's payload too. The tolerance is `SHARE_SUM_TOLERANCE`
--     in `data/payloads.py`; `test_payload_completeness_behaviour` tests this boundary with that
--     constant, so the two cannot drift.
--
-- **A stored figure already breaking either rule stops the migration and is named** -- never
-- given a payload or rejected here: which figure was meant is not this migration's to decide.

-- **Locked first** (BE-A1): `CREATE TRIGGER` does not look at stored rows, so a figure committed
-- between the check below and the triggers would escape both. SHARE ROW EXCLUSIVE is what
-- `CREATE TRIGGER` takes anyway, so nothing is upgraded later; reads go on.
LOCK TABLE value,
           value_monetary,
           value_quantity,
           value_count,
           value_ratio,
           value_index,
           value_labelset,
           value_sharecomp,
           value_boolean,
           value_score,
           value_text
           IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(offender, '; ' ORDER BY offender) INTO offenders
    FROM (
        SELECT format('%s accepted %s figure(s) with no payload (value %s)',
                      count(*), v.value_type,
                      array_to_string((array_agg(v.id ORDER BY v.id))[1:5], ', '))
        FROM   value AS v
        WHERE  v.rejection_reason IS NULL
          AND  NOT CASE v.value_type
                   WHEN 'Monetary'         THEN EXISTS (SELECT 1 FROM value_monetary AS p
                                                        WHERE p.value_id = v.id)
                   WHEN 'Quantity'         THEN EXISTS (SELECT 1 FROM value_quantity AS p
                                                        WHERE p.value_id = v.id)
                   WHEN 'Count'            THEN EXISTS (SELECT 1 FROM value_count AS p
                                                        WHERE p.value_id = v.id)
                   WHEN 'Ratio'            THEN EXISTS (SELECT 1 FROM value_ratio AS p
                                                        WHERE p.value_id = v.id)
                   WHEN 'Index'            THEN EXISTS (SELECT 1 FROM value_index AS p
                                                        WHERE p.value_id = v.id)
                   WHEN 'LabelSet'         THEN EXISTS (SELECT 1 FROM value_labelset AS p
                                                        WHERE p.value_id = v.id)
                   WHEN 'ShareComposition' THEN EXISTS (SELECT 1 FROM value_sharecomp AS p
                                                        WHERE p.value_id = v.id)
                   WHEN 'Boolean'          THEN EXISTS (SELECT 1 FROM value_boolean AS p
                                                        WHERE p.value_id = v.id)
                   WHEN 'AssignedScore'    THEN EXISTS (SELECT 1 FROM value_score AS p
                                                        WHERE p.value_id = v.id)
                   WHEN 'Text'             THEN EXISTS (SELECT 1 FROM value_text AS p
                                                        WHERE p.value_id = v.id)
                   ELSE false
               END
        GROUP  BY v.value_type
        UNION ALL
        SELECT format('%s share composition(s) not summing to 100 within 0.5 (%s)',
                      count(*),
                      array_to_string((array_agg(format('value %s sums to %s', total.value_id,
                                                        total.shares)
                                                 ORDER BY total.value_id))[1:5], ', '))
        FROM   (SELECT s.value_id, sum(s.share) AS shares
                FROM   value_sharecomp AS s
                GROUP  BY s.value_id
                HAVING abs(sum(s.share) - 100) > 0.5) AS total
        HAVING count(*) > 0
    ) AS incomplete (offender);
    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'cannot apply 0519: an accepted figure carries its payload and a share composition '
            'sums to 100, and these do not: %. Give each its payload, reject it, or correct its '
            'shares, then migrate again; this migration will not choose. Nothing was changed.',
            offenders;
    END IF;
END $$;

-- Whether value `figure`, of type `kind`, has the payload its type declares. A type this does not
-- name has none, so a new type fails closed until it is added here.
CREATE FUNCTION value_carries_its_payload(figure bigint, kind text) RETURNS boolean
    LANGUAGE sql STABLE
AS $$
    SELECT CASE kind
        WHEN 'Monetary'         THEN EXISTS (SELECT 1 FROM value_monetary   WHERE value_id = figure)
        WHEN 'Quantity'         THEN EXISTS (SELECT 1 FROM value_quantity   WHERE value_id = figure)
        WHEN 'Count'            THEN EXISTS (SELECT 1 FROM value_count      WHERE value_id = figure)
        WHEN 'Ratio'            THEN EXISTS (SELECT 1 FROM value_ratio      WHERE value_id = figure)
        WHEN 'Index'            THEN EXISTS (SELECT 1 FROM value_index      WHERE value_id = figure)
        WHEN 'LabelSet'         THEN EXISTS (SELECT 1 FROM value_labelset   WHERE value_id = figure)
        WHEN 'ShareComposition' THEN EXISTS (SELECT 1 FROM value_sharecomp  WHERE value_id = figure)
        WHEN 'Boolean'          THEN EXISTS (SELECT 1 FROM value_boolean    WHERE value_id = figure)
        WHEN 'AssignedScore'    THEN EXISTS (SELECT 1 FROM value_score      WHERE value_id = figure)
        WHEN 'Text'             THEN EXISTS (SELECT 1 FROM value_text       WHERE value_id = figure)
        ELSE false
    END
$$;

-- Refuses an accepted figure without its payload. Judged on the row as it stands at COMMIT, so a
-- figure deleted in the same transaction, or rejected after all, passes.
CREATE FUNCTION value_is_complete() RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    figure bigint;
    kind   text;
BEGIN
    IF TG_TABLE_NAME = 'value' THEN
        figure := NEW.id;
    ELSE
        figure := OLD.value_id;
    END IF;
    SELECT v.value_type INTO kind
    FROM   value AS v
    WHERE  v.id = figure AND v.rejection_reason IS NULL;
    IF kind IS NOT NULL AND NOT value_carries_its_payload(figure, kind) THEN
        RAISE EXCEPTION 'value % is an accepted % figure with no payload: give it its payload '
                        'or a rejection reason, in the same transaction', figure, kind
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END
$$;

-- Refuses a composition, accepted or rejected, whose shares do not sum to 100 within 0.5 -- the
-- domain's `SHARE_SUM_TOLERANCE`. A composition with no shares left is the rule above's to judge.
CREATE FUNCTION value_shares_sum_to_100() RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    figure bigint;
    total  numeric;
BEGIN
    IF TG_OP = 'DELETE' THEN
        figure := OLD.value_id;
    ELSE
        figure := NEW.value_id;
    END IF;
    SELECT sum(s.share) INTO total FROM value_sharecomp AS s WHERE s.value_id = figure;
    IF total IS NOT NULL AND abs(total - 100) > 0.5 THEN
        RAISE EXCEPTION 'value % is a share composition summing to %, not to 100 within 0.5',
                        figure, total
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.value_id <> NEW.value_id THEN
        SELECT sum(s.share) INTO total FROM value_sharecomp AS s WHERE s.value_id = OLD.value_id;
        IF total IS NOT NULL AND abs(total - 100) > 0.5 THEN
            RAISE EXCEPTION 'value % is a share composition summing to %, not to 100 within 0.5',
                            OLD.value_id, total
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER value_is_complete
    AFTER INSERT OR UPDATE OF rejection_reason ON value
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

-- A payload row deleted, or moved to another figure, may leave its accepted figure without one.
CREATE CONSTRAINT TRIGGER value_monetary_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_monetary
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_quantity_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_quantity
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_count_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_count
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_ratio_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_ratio
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_index_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_index
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_labelset_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_labelset
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_sharecomp_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_sharecomp
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_boolean_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_boolean
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_score_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_score
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_text_leaves_its_figure_complete
    AFTER UPDATE OF value_id OR DELETE ON value_text
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_is_complete();

CREATE CONSTRAINT TRIGGER value_sharecomp_sums_to_100
    AFTER INSERT OR UPDATE OR DELETE ON value_sharecomp
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION value_shares_sum_to_100();
