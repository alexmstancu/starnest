-- `cheap_but_taxed` gets its two numbers, and `local_employment` applies it.
--
-- The rule warns when a country's low prices are offset by a tax burden that removes the
-- advantage. It has shipped undecided since `0103`, which was right: every bound was TBD in
-- `reqs.md` 7.4, and `devplan.md` 0.3 rule 2 says seed it NULL and leave it inactive rather than
-- invent a number. "Cheap" and "taxed" are exactly the judgements this application exists to
-- make, not ones it should ship pre-made.
--
-- **Decided by the household on 2026-09-19, against the figures rather than in the abstract**,
-- which is why it could not happen until all 32 countries had both:
--
--   cheap  = cost of living at or below 80, where the index is EU27 = 100. A strict reading:
--            Bulgaria 62, Romania 65, Poland 73, Hungary 77, Croatia 78. These are the places
--            where the cost difference is large enough to be a reason on its own, rather than
--            everything that happens to sit under the EU average.
--   taxed  = a total rate at or above 40% of the whole cost of employment at 167% of the
--            average wage (Q205) -- employer's share included, which is the distinction that
--            stops Romania being flattered for moving contributions onto the employee.
--
-- Both bounds are inclusive, as `_within` reads them.
--
-- What it says today, and the reason the pair of numbers matters more than either alone:
--
--   Romania   65.1 / 42.8  -> warned
--   Hungary   77.5 / 41.2  -> warned
--   Croatia   78.4 / 43.3  -> warned
--   Bulgaria  62.5 / 33.0  -> cheap, and not taxed. No warning.
--   Poland    73.3 / 39.2  -> cheap, and just under. No warning.
--
-- Bulgaria and Poland are the point: a rule that flagged every cheap country would be saying
-- "cheap", which the cost-of-living criterion already scores. This says something the score
-- does not -- that the advantage is partly taken back.
--
-- **A warning, never a non-match** (`reqs.md` 3.7a): it flags and explains, and changes neither
-- the score nor the match status. Applied by `local_employment` only; `remote_only` is a
-- separate opinion and nobody has given it one.
-- depends: 0446-cheap-but-taxed-judges-the-total-rate

UPDATE compound_rule_condition
SET    threshold_max = 80
WHERE  compound_rule = 'cheap_but_taxed' AND attribute = 'country.cost_of_living_index';

UPDATE compound_rule_condition
SET    threshold_min = 40
WHERE  compound_rule = 'cheap_but_taxed' AND attribute = 'country.total_tax_rate_effective';

INSERT INTO criteria_set_compound_rule (criteria_set, compound_rule, is_applied)
VALUES ('local_employment', 'cheap_but_taxed', true)
ON CONFLICT (criteria_set, compound_rule) DO UPDATE SET is_applied = EXCLUDED.is_applied;

-- A rule is decided only when every number it compares against has been chosen, and applied
-- only when a set says so. Both halves are asserted, because seeding one without the other
-- leaves a rule that looks live in the catalog and fires for nobody.
DO $$
DECLARE
    undecided integer;
    applied   integer;
BEGIN
    SELECT count(*) INTO undecided
    FROM   compound_rule_condition
    WHERE  compound_rule = 'cheap_but_taxed'
      AND  threshold_min IS NULL AND threshold_max IS NULL;

    SELECT count(*) INTO applied
    FROM   criteria_set_compound_rule
    WHERE  compound_rule = 'cheap_but_taxed' AND criteria_set = 'local_employment' AND is_applied;

    IF undecided <> 0 THEN
        RAISE EXCEPTION 'cheap_but_taxed still has % undecided condition(s)', undecided;
    END IF;
    IF applied <> 1 THEN
        RAISE EXCEPTION 'local_employment does not apply cheap_but_taxed';
    END IF;
END $$;
