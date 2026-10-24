-- The comparator limit is a whole number from 1 to 20, here as well as in the API (PL-030).
--
-- **Twenty is the product's ceiling** (design DECISIONS, 2026-09-20), and until now no layer
-- held it: 0008 checked only `>= 1`. The API now refuses 21, and its settings body is the
-- response model too -- so without this a limit stored by any other route (a second client,
-- `psql`) would make every settings read a 500 (C02-S7). Holding it in the table is what lets
-- the API bound its answer as well as its question (D-C02-A, option B).
--
-- **A stored limit outside the range stops the migration and is named**, never clamped: what
-- the household meant by 25 is theirs to say, and choosing 20 for them would be this
-- application deciding a setting. Set it from Configure, then migrate again.
--
-- depends: 0508-criteria-sets-are-deleted-in-place-and-named-uniquely

-- **Locked before the read** (BE-A1): a settings save committed between the check and the
-- constraint would otherwise meet a raw check violation rather than this refusal.
LOCK TABLE settings IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    stored integer;
BEGIN
    SELECT comparator_limit INTO stored
    FROM   settings
    WHERE  comparator_limit IS NOT NULL AND comparator_limit NOT BETWEEN 1 AND 20;
    IF FOUND THEN
        RAISE EXCEPTION
            'cannot apply 0509: the stored comparator_limit is %, outside 1 to 20. Set it to a '
            'whole number from 1 to 20 in Configure, then migrate again.', stored;
    END IF;
END $$;

ALTER TABLE settings
    ADD CONSTRAINT settings_comparator_limit_is_one_to_twenty
        CHECK (comparator_limit IS NULL OR comparator_limit BETWEEN 1 AND 20);
