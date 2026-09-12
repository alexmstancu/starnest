-- Catalog: a second opinion about the same 43 attributes -- `remote_only`.
--
-- **This is what a criteria set is for** (reqs.md 3.4, Q191). Nothing measured changes: the
-- attributes, the figures and their provenance are untouched. What changes is how much each
-- counts, and switching between the two sets re-ranks instantly from stored data without
-- fetching anything (reqs.md 5.6). devplan.md 8 lists it as "already satisfied by the MVP":
-- re-weighted rows, no new attributes and no new machinery.
--
-- **The scenario it encodes.** You work remotely for an employer outside the country you live
-- in. So the local job market stops deciding where you can live, and three things that were
-- secondary become decisive: whether a tax treaty makes remote work viable at all, whether the
-- connection is good enough to work over, and whether you can get residency without a local
-- employer sponsoring you.
--
-- **Every number here is provisional**, exactly as 0104 says of `local_employment`. They are
-- one reading of the scenario and the household's to tune -- which is the whole reason weights
-- are rows rather than code.
--
-- **A set is a full copy, never a sparse overlay** (reqs.md Q191). The criteria are therefore
-- copied from `local_employment` by SELECT rather than retyped: a hand-typed list would silently
-- omit an attribute the day one is added, and the omission would look like a deliberate
-- exclusion. The differences are then applied as explicit updates, each one a sentence about
-- the scenario, and the arithmetic is asserted at the end.
-- depends: 0468-a-band-needs-the-method-that-can-draw-it

INSERT INTO criteria_set (id, name) VALUES
    ('remote_only', 'Remote only')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The eleven pillars, summing to 100 within the country level and independently of any other
-- (reqs.md 3.2). Against `local_employment` in brackets:
--
--   career        4 (14)  -- the local job market no longer decides anything
--   connectivity 13  (8)  -- the connection is the job; air links are how you visit home
--   economics    16 (14)  -- income is fixed abroad, so local prices decide what it buys
--   governance   10  (8)  -- residency without a local employer is harder, and it is a gate
--   housing      12 (10)  -- you are home far more of the day
--   climate       8  (7)  -- likewise
--   culture       6  (6)
--   family        4  (4)
--   health        8  (9)
--   nature        8  (8)
--   safety       11 (12)
--
-- Nothing is locked. A lock is something the household decides, and shipping one would pin a
-- provisional number against the rebalancing meant to move it.
INSERT INTO pillar_weight (criteria_set, pillar, level, weight) VALUES
    ('remote_only', 'economics', 'country', 16),
    ('remote_only', 'housing', 'country', 12),
    ('remote_only', 'career', 'country', 4),
    ('remote_only', 'safety', 'country', 11),
    ('remote_only', 'health', 'country', 8),
    ('remote_only', 'climate', 'country', 8),
    ('remote_only', 'connectivity', 'country', 13),
    ('remote_only', 'nature', 'country', 8),
    ('remote_only', 'culture', 'country', 6),
    ('remote_only', 'governance', 'country', 10),
    ('remote_only', 'family', 'country', 4)
ON CONFLICT (criteria_set, pillar, level) DO UPDATE SET weight = EXCLUDED.weight;

-- Every criterion of `local_employment`, copied whole: the goal, the band, the method, the
-- blocking flag. Only the weights are revisited below, because only the weights are what a
-- scenario changes -- a cost is still a cost and a benefit still a benefit whoever employs you.
INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, breakdown_option, is_scored, weight,
    goal, target_range_min, target_range_max, zero_score_below, zero_score_above,
    normalisation_method, reducer_mode, blocks_if_missing)
SELECT 'remote_only', c.attribute, c.pillar, c.value_type, c.breakdown_option, c.is_scored,
       c.weight, c.goal, c.target_range_min, c.target_range_max, c.zero_score_below,
       c.zero_score_above, c.normalisation_method, c.reducer_mode, c.blocks_if_missing
FROM   criterion AS c
WHERE  c.criteria_set = 'local_employment'
ON CONFLICT DO NOTHING;

-- The scale anchors too, which matter more than they look: eight criteria normalise `fixed`
-- with anchors the household chose against real figures (Q206, Q209), and a copy without them
-- would score nothing at all on exactly those eight.
INSERT INTO criterion_scale_anchor (criterion, input_value, score, label)
SELECT copied.id, anchor.input_value, anchor.score, anchor.label
FROM   criterion_scale_anchor AS anchor
JOIN   criterion AS original ON original.id = anchor.criterion
JOIN   criterion AS copied
       ON  copied.criteria_set = 'remote_only'
       AND copied.attribute = original.attribute
WHERE  original.criteria_set = 'local_employment'
ON CONFLICT DO NOTHING;

-- --- what the scenario actually changes, pillar by pillar -----------------------------
--
-- Each block sums to 100 within its pillar, which the assertion at the end enforces rather
-- than trusts.

-- ECONOMICS. The treaty is the precondition: remote work for a foreign employer is only
-- viable where one country's rules let you do it, so it rises from 20 to 35 and becomes the
-- heaviest thing in the pillar alongside prices. The local total tax rate falls, because which
-- country taxes you is what the treaty decides.
UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('country.remote_work_tax_treaty',   35),
    ('country.cost_of_living_index',     35),
    ('country.total_tax_rate_effective', 20),
    ('country.economic_outlook',         10)
) AS declared (attribute, weight)
WHERE  criterion.criteria_set = 'remote_only' AND criterion.attribute = declared.attribute;

-- CONNECTIVITY. Broadband stops being a convenience and becomes the job: it rises from 25 to
-- 40. Air links rise too, because visiting the home country is now a flight rather than a
-- commute. Rail and road density fall -- and both are down for a post-MVP rethink anyway
-- (devplan.md 8), because length over land area punishes a country for its empty space.
UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('country.broadband_coverage',             40),
    ('country.international_air_connectivity', 30),
    ('country.rail_network_density',           20),
    ('country.road_network_quality',           10)
) AS declared (attribute, weight)
WHERE  criterion.criteria_set = 'remote_only' AND criterion.attribute = declared.attribute;

-- GOVERNANCE. Residency admin rises from 15 to 25: without a local employer to sponsor you,
-- the paperwork is the obstacle rather than a formality somebody else handles.
UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('country.residency_admin_ease',     25),
    ('country.naturalisation_pathway',   25),
    ('country.rule_of_law',              20),
    ('country.control_of_corruption',    15),
    ('country.press_freedom',            10),
    ('country.pension_portability',       5)
) AS declared (attribute, weight)
WHERE  criterion.criteria_set = 'remote_only' AND criterion.attribute = declared.attribute;

-- CAREER. The pillar is down to 4, and within it the ordering inverts. Named international
-- employers now matter most, as the fallback if remote work ends -- somebody to join without
-- leaving. Working hours and paid leave are your employer's terms, not the country's, so they
-- fall to the bottom rather than being excluded: they still describe the place you live in.
UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('country.international_employers',  40),
    ('country.tech_employment_share',    20),
    ('country.tech_product_jobs',        15),
    ('country.tech_software_jobs',       15),
    ('country.average_working_hours',     5),
    ('country.statutory_paid_leave',      5)
) AS declared (attribute, weight)
WHERE  criterion.criteria_set = 'remote_only' AND criterion.attribute = declared.attribute;

-- --- the arithmetic, asserted rather than trusted -------------------------------------
--
-- A set whose weights do not sum to 100 does not fail loudly: it produces a ranking computed
-- from the wrong total, which is the failure this application exists to prevent. The domain
-- refuses to load such a set (`CriteriaSet`), so a migration that wrote one would take the
-- application down at its next read -- better to refuse here, where the transaction rolls back.
--
-- **Every criterion counts, scored or not.** `is_scored = false` redistributes weight at
-- scoring time (reqs.md 5.3); it does not renumber the row's siblings, so the stored weights
-- still have to sum. Filtering them out here was this block's first version, and it disagreed
-- with `CriteriaSet._reject_weights_that_do_not_sum` -- which is the rule.
--
-- **Rounded, because SQL is stricter here than the domain is.** `numeric` is
-- arbitrary-precision and keeps every digit of a rebalance: `local_employment`'s housing pillar
-- is stored as 75 + 15.38461538461538461538461539 + 9.615384615384615384615384612, which SQL
-- sums to 100.000000000000000000000000002. Python's `Decimal` works in a 28-significant-digit
-- context where that residue falls off the end, so the domain reads exactly 100 and accepts the
-- set. An assertion on `= 100` therefore refuses data the application is happy with -- which is
-- what it did on its first run. Ten decimal places is far beyond any weight anybody types and
-- far short of where the arithmetic dust lives.
DO $$
DECLARE
    offending text;
    pillar_total numeric;
BEGIN
    SELECT string_agg(pillar || ' = ' || total, ', ')
    INTO   offending
    FROM   (SELECT pillar, SUM(weight) AS total
            FROM   criterion
            WHERE  criteria_set = 'remote_only'
            GROUP  BY pillar) AS sums
    WHERE  round(total, 10) <> 100;

    IF offending IS NOT NULL THEN
        RAISE EXCEPTION 'remote_only criterion weights do not sum to 100: %', offending;
    END IF;

    SELECT SUM(weight) INTO pillar_total
    FROM   pillar_weight
    WHERE  criteria_set = 'remote_only' AND level = 'country';

    IF round(pillar_total, 10) <> 100 THEN
        RAISE EXCEPTION 'remote_only pillar weights sum to % rather than 100', pillar_total;
    END IF;
END $$;
