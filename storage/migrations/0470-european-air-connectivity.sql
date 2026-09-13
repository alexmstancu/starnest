-- Air connectivity splits into two attributes, because one name was answering two questions.
-- Decided by the household on 2026-09-13 (Q227).
--
-- **What went wrong with one.** `country.international_air_connectivity` counts "international
-- destinations served", and the source that would answer it -- Eurostat `avia_paocc` -- carries
-- a partner list of **35 European countries and three aggregates**. No Brazil, no United
-- States, no Gulf hub. A count from it is European connectivity wearing the word
-- "international", which is the fault `0442` fixed for `crime_safety_index`: a name that
-- promises one quantity over a figure that measures another.
--
-- **Two attributes, each measuring what its name says.** The European one is counted from
-- Eurostat and is a published figure. The international one keeps its name and its meaning, and
-- is answered by the LLM fallback with the pages it read -- `low` confidence, ranked last, and
-- visibly so (reqs.md 6.10 use 1).
--
-- **The pair carries the weight the single one did.** They overlap: a country well connected
-- within Europe is usually well connected beyond it, so weighting both at the old figure would
-- let air travel count twice in the connectivity pillar. The existing weight is therefore
-- *split* between them rather than duplicated, in both criteria sets. Which way the split
-- should lean is the household's to tune, like every other weight here.
-- depends: 0469-remote-only-criteria-set

INSERT INTO attribute (id, pillar, level, value_type, name, description, max_age, manual_entry) VALUES
    ('country.european_air_connectivity', 'connectivity', 'country', 'Count',
     'European air connectivity',
     'European countries served by direct passenger flights',
     interval '24 months', false)
ON CONFLICT (id) DO NOTHING;

-- 35 partner countries is the ceiling Eurostat's own list imposes, and the range is recorded so
-- a figure above it reads as the source changing rather than as a country gaining continents.
INSERT INTO attribute_allowed_range (attribute, min_value, max_value) VALUES
    ('country.european_air_connectivity', 0, 35)
ON CONFLICT DO NOTHING;

-- One source, ranked first. `attribute_source_priority` is where an attribute names who may
-- answer it: there is no separate list of permitted sources, and the rank is what decides which
-- figure is active when two of them answer (reqs.md 3.6).
INSERT INTO attribute_source_priority (attribute, data_source, rank) VALUES
    ('country.european_air_connectivity', 'eurostat', 1)
ON CONFLICT (attribute, data_source) DO UPDATE SET rank = EXCLUDED.rank;

-- --- the criterion, in both sets, splitting the weight rather than adding to it -------
--
-- `local_employment` connectivity was rail 30, international air 25, broadband 25, road 20.
-- `remote_only` was broadband 40, international air 30, rail 20, road 10 -- the connection is
-- the job there, and flights are how you visit home.
--
-- The split leans slightly towards the European measure in both, because it is the published
-- figure and because every candidate is in Europe: how many European countries you can reach
-- directly is the question a move within Europe actually asks.

INSERT INTO criterion (
    criteria_set, attribute, pillar, value_type, is_scored, weight, goal,
    normalisation_method, blocks_if_missing)
SELECT declared.criteria_set, 'country.european_air_connectivity', 'connectivity', 'Count',
       true, declared.weight, 'maximise', 'fixed', false
FROM   (VALUES
    ('local_employment', 13),
    ('remote_only',      15)
) AS declared (criteria_set, weight)
ON CONFLICT DO NOTHING;

UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('local_employment', 12),
    ('remote_only',      15)
) AS declared (criteria_set, weight)
WHERE  criterion.attribute = 'country.international_air_connectivity'
  AND  criterion.criteria_set = declared.criteria_set;

-- The same guard `0469` carries, and for the same reason: a pillar that does not sum to 100
-- produces a ranking computed from the wrong total rather than an error anybody sees. Rounded
-- because `numeric` keeps a rebalance's last digits where Python's `Decimal` drops them
-- (`known-issues.md` P33), so `= 100` would refuse data the application is happy with.
DO $$
DECLARE
    offending text;
BEGIN
    SELECT string_agg(criteria_set || '.' || pillar || ' = ' || total, ', ')
    INTO   offending
    FROM   (SELECT criteria_set, pillar, SUM(weight) AS total
            FROM   criterion
            GROUP  BY criteria_set, pillar) AS sums
    WHERE  round(total, 10) <> 100;

    IF offending IS NOT NULL THEN
        RAISE EXCEPTION 'criterion weights no longer sum to 100: %', offending;
    END IF;
END $$;
