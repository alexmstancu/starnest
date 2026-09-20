-- Career's weights, stated rather than divided.
--
-- **`0476` redistributed by proportional division and left 99.9999999999999999.** Its own guard
-- passed, because the guard rounds to ten decimals -- and `CriteriaSet` does not: Python's
-- `Decimal` compares the sum to 100 exactly and refused to read the set at all, which took Gate
-- A's catalog test down with it.
--
-- **This is `known-issues.md` P33 from the other side.** P33 found that an SQL `CHECK` on
-- `SUM(weight) = 100` is *stricter* than the domain, because `numeric` keeps a rebalance's last
-- digits where `Decimal` drops them. Here the rounding in the guard made SQL *laxer*, and the
-- domain caught what the migration did not. The lesson is the same either way: a weight
-- redistribution must produce numbers that sum to 100 as written, not numbers that round to it.
--
-- So the five weights per set are written out, in the proportions `0476` intended, with the
-- rounding residual placed on the largest -- which is what the application's own rebalance does
-- when a user drags a slider.
--
-- depends: 0476-statutory-leave-is-descriptive

UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    -- local_employment: 22/22/18/15/13 of 90, scaled to 100. The residual goes to the largest.
    ('local_employment', 'country.tech_product_jobs',       24.45),
    ('local_employment', 'country.tech_software_jobs',      24.44),
    ('local_employment', 'country.international_employers', 20.00),
    ('local_employment', 'country.average_working_hours',   16.67),
    ('local_employment', 'country.tech_employment_share',   14.44),
    -- remote_only: 40/20/15/15/5 of 95, scaled to 100. These divide evenly at two decimals.
    ('remote_only',      'country.international_employers', 42.11),
    ('remote_only',      'country.tech_employment_share',   21.05),
    ('remote_only',      'country.tech_product_jobs',       15.79),
    ('remote_only',      'country.tech_software_jobs',      15.79),
    ('remote_only',      'country.average_working_hours',    5.26)
) AS declared (criteria_set, attribute, weight)
WHERE  criterion.criteria_set = declared.criteria_set
  AND  criterion.attribute = declared.attribute;

-- **Rounded to ten decimals, as every guard since `0469` has been** -- and the reason is now
-- demonstrated rather than assumed. An exact `<> 100` was tried here first and failed on
-- `remote_only.housing = 100.000000000000000000000000002`, a residue an earlier rebalance left
-- and which the domain has always read without complaint: Python's `Decimal` carries 28
-- significant digits and drops the tail, where `numeric` keeps it. The guard has to be as
-- tolerant as the reader, or it refuses catalogs the application is perfectly happy with.
--
-- What it must still catch is a sum that is wrong at the tenth decimal, which is what `0476`
-- produced and what took Gate A down.
DO $$
DECLARE
    offending text;
BEGIN
    SELECT string_agg(criteria_set || '.' || pillar || ' = ' || total, ', ')
    INTO   offending
    FROM   (SELECT criteria_set, pillar, SUM(weight) AS total
            FROM   criterion GROUP BY criteria_set, pillar) AS sums
    WHERE  round(total, 10) <> 100;

    IF offending IS NOT NULL THEN
        RAISE EXCEPTION 'criterion weights do not sum to 100: %', offending;
    END IF;
END $$;
