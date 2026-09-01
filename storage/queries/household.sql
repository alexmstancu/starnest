-- HouseholdStore (arch.md 6.3): the two single-row tables -- who is asking, and how the
-- application is tuned.
--
-- Both are singletons with a CHECK pinning the primary key to 1, so there is no id parameter
-- anywhere in this file and no list query. There is one household because there is one
-- user, running locally, with no accounts and no multi-tenancy.
--
-- Neither table is seeded. Every number in both is provisional (reqs.md 3.9, 3.10), so a read
-- before the user has configured anything returns no row at all -- which the caller must
-- handle, because the honest answer to "what is the household?" before it is set is nothing,
-- not a row of zeroes.

-- name: select_household()^
-- The household with its citizenships and the display names of the places it names. The names
-- come along because the screen shows "Romania" rather than `country.romania`, and a second
-- read per field would be three round trips for one form.
--
-- Citizenships are a list, therefore a table, therefore an aggregate here. eu_free_movement and
-- the UK and Swiss gates are all decided by a join against it rather than by parsing a string
-- (reqs.md 7.3).
SELECT h.id,
       h.net_income,
       h.number_adults,
       h.number_children,
       h.target_monthly_spend,
       h.max_rent,
       h.home_country_candidate,
       home_country.name AS home_country_name,
       h.home_city_candidate,
       home_city.name    AS home_city_name,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                       'candidate', citizenship.candidate,
                       'name',      citizenship_candidate.name)
                     ORDER BY citizenship.candidate)
            FROM   household_citizenship AS citizenship
            JOIN   candidate AS citizenship_candidate
                   ON citizenship_candidate.id = citizenship.candidate
            WHERE  citizenship.household = h.id),
           '[]'::jsonb) AS citizenships
FROM   household AS h
JOIN   candidate AS home_country ON home_country.id = h.home_country_candidate
LEFT   JOIN candidate AS home_city ON home_city.id = h.home_city_candidate
WHERE  h.id = 1;

-- name: upsert_household(net_income, number_adults, number_children, target_monthly_spend, max_rent, home_country_candidate, home_city_candidate)!
-- PUT replaces the record, so this is one upsert rather than an insert and an update the caller
-- has to choose between. The id is written as the literal 1: it is the constraint's value, not
-- a parameter, and offering it as one would invite a second household that the CHECK would
-- reject anyway.
--
-- target_monthly_spend and max_rent are guideline ceilings and stay nullable. Clearing one is
-- passing NULL, not passing zero -- a zero ceiling is a household that may spend nothing.
INSERT INTO household (
    id, net_income, number_adults, number_children, target_monthly_spend, max_rent,
    home_country_candidate, home_city_candidate)
VALUES (1, :net_income, :number_adults, :number_children, :target_monthly_spend, :max_rent,
        :home_country_candidate, :home_city_candidate)
ON CONFLICT (id) DO UPDATE
SET net_income             = EXCLUDED.net_income,
    number_adults          = EXCLUDED.number_adults,
    number_children        = EXCLUDED.number_children,
    target_monthly_spend   = EXCLUDED.target_monthly_spend,
    max_rent               = EXCLUDED.max_rent,
    home_country_candidate = EXCLUDED.home_country_candidate,
    home_city_candidate    = EXCLUDED.home_city_candidate;

-- name: replace_household_citizenships(candidates)!
-- The whole list, replaced in one statement. A PUT that replaced the household but added
-- citizenships incrementally would accumulate the ones a correction was meant to remove.
--
-- An empty array leaves no rows, which the contract forbids (at least one citizenship is
-- required, because an empty set makes every visa gate pass or fail silently rather than
-- visibly). That rule produces a message worth reading, so it belongs in `household/`, not in a
-- constraint here that could only say "violates check".
-- The delete takes only the citizenships the new list drops, and the insert lets the ones it
-- keeps conflict harmlessly. Both halves of a single statement share one snapshot, so a CTE
-- that deleted every row would be invisible to the insert beside it: the unique index would
-- still hold the old rows and re-saving an unchanged list would fail with a duplicate key.
WITH cleared AS (
    DELETE FROM household_citizenship
    WHERE  household = 1
      AND  candidate <> ALL (:candidates::text[])
)
INSERT INTO household_citizenship (household, candidate)
SELECT 1, candidate
FROM   unnest(:candidates::text[]) AS candidate
ON CONFLICT DO NOTHING;

-- name: select_settings()^
-- How the application is tuned. Typed columns rather than a key/value table, so each one comes
-- back as the type it is (reqs.md 3.10).
--
-- Every column is nullable and unseeded. A NULL comparator_limit is not "5" -- the default the
-- contract names is the caller's to apply, and the bound stays configurable rather than
-- hardcoded anywhere.
SELECT s.id,
       s.min_coverage,
       s.score_scale_max,
       s.comparator_limit,
       s.run_spend_cap_eur
FROM   settings AS s
WHERE  s.id = 1;

-- name: upsert_settings(min_coverage, score_scale_max, comparator_limit, run_spend_cap_eur)!
-- The same replace-the-row shape as the household above, and the same literal 1.
INSERT INTO settings (id, min_coverage, score_scale_max, comparator_limit, run_spend_cap_eur)
VALUES (1, :min_coverage, :score_scale_max, :comparator_limit, :run_spend_cap_eur)
ON CONFLICT (id) DO UPDATE
SET min_coverage      = EXCLUDED.min_coverage,
    score_scale_max   = EXCLUDED.score_scale_max,
    comparator_limit  = EXCLUDED.comparator_limit,
    run_spend_cap_eur = EXCLUDED.run_spend_cap_eur;
