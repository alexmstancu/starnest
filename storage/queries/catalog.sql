-- CatalogStore (arch.md 6.3): the objective catalog, all of it changed only by migration.
--
-- Nothing here is written. The catalog is data in the database (arch.md 1.2), seeded and
-- amended by migrations, so this seam is read-only by construction -- there is no
-- insert_attribute and there must not be one.
--
-- Every list query takes its filters as nullable parameters rather than being split into a
-- filtered and an unfiltered variant. One query with `:level::text IS NULL OR ...` stays one
-- piece of SQL to read, review and paste into psql; two variants drift.

-- name: select_levels()
-- The levels in nesting order. Ordered records, never a hardcoded pair (reqs.md 3.1):
-- depth_order is what tells the caller which level screens first.
SELECT l.id,
       l.depth_order,
       l.parent_level
FROM   level AS l
ORDER  BY l.depth_order;

-- name: select_level(level_id)^
-- One level, for validating a `level` query parameter before anything else is read.
SELECT l.id,
       l.depth_order,
       l.parent_level
FROM   level AS l
WHERE  l.id = :level_id;

-- name: select_pillars()
-- The eleven verticals. A pillar carries no level (reqs.md Q187) -- the level lives on the
-- weight, so this list is the same whichever level is being scored.
--
-- **Ordered by the catalog's own order, never by name.** The eleven read left to right in the
-- Rank table and top to bottom in Configure, and the sequence is a judgement about what gets
-- weighed first -- which is a fact about the catalog, so it is a column rather than a list in
-- the client (`arch.md` 1.2).
SELECT p.id,
       p.name,
       p.description,
       p.display_order
FROM   pillar AS p
ORDER  BY p.display_order;

-- name: select_attributes(level, attribute_id, include_retired)
-- The attribute catalog with every per-attribute declaration attached: its type parameters,
-- its allowed range, its label vocabulary and its source-priority overrides.
--
-- The three type-parameter tables hold at most one row each and are mutually exclusive by
-- construction (arch.md 3.3b), so they are LEFT JOINed as columns rather than aggregated.
-- Serves both the catalog list and a single attribute; pass :attribute_id to narrow it.
SELECT a.id,
       a.pillar,
       a.level,
       a.value_type,
       a.breakdown_scheme,
       a.name,
       a.description,
       a.max_age,
       a.manual_entry,
       a.lifecycle_status,
       quantity_parameter.unit          AS quantity_unit,
       unit.name                        AS quantity_unit_name,
       index_parameter.provider         AS index_provider,
       index_parameter.scale_min        AS index_scale_min,
       index_parameter.scale_max        AS index_scale_max,
       ratio_parameter.basis            AS ratio_basis,
       allowed_range.min_value          AS allowed_min_value,
       allowed_range.max_value          AS allowed_max_value,
       COALESCE(
           (SELECT jsonb_agg(l.label ORDER BY l.label)
            FROM   attribute_allowed_label AS l
            WHERE  l.attribute = a.id),
           '[]'::jsonb)                 AS allowed_labels,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object('data_source', p.data_source, 'rank', p.rank)
                             ORDER BY p.rank)
            FROM   attribute_source_priority AS p
            WHERE  p.attribute = a.id),
           '[]'::jsonb)                 AS source_priority_overrides
FROM   attribute AS a
LEFT   JOIN attribute_quantity_parameter AS quantity_parameter
            ON quantity_parameter.attribute = a.id
LEFT   JOIN unit
            ON unit.id = quantity_parameter.unit
LEFT   JOIN attribute_index_parameter AS index_parameter
            ON index_parameter.attribute = a.id
LEFT   JOIN attribute_ratio_parameter AS ratio_parameter
            ON ratio_parameter.attribute = a.id
LEFT   JOIN attribute_allowed_range AS allowed_range
            ON allowed_range.attribute = a.id
LEFT   JOIN pillar AS listing_pillar ON listing_pillar.id = a.pillar
WHERE  (:level::text IS NULL OR a.level = :level)
  AND  (:attribute_id::text IS NULL OR a.id = :attribute_id)
  AND  (:include_retired OR a.lifecycle_status = 'active')
-- **By the pillar's stated order, as `select_criteria_set` reads it.** Ordering by the pillar
-- *id* sorts alphabetically -- career, climate, connectivity -- which is not the order the
-- catalog states and not the order the other listing uses, so two screens showed the same
-- pillars in two different sequences (P75).
ORDER  BY a.level, listing_pillar.display_order NULLS LAST, a.id;

-- name: select_data_sources()
-- Where values come from, in the global priority order of reqs.md 6.6. Lower rank first, so
-- reading this list top to bottom is reading the order the active-value view applies.
SELECT s.id,
       s.name,
       s.source_kind,
       s.default_priority,
       s.reliability_tier,
       s.is_enabled
FROM   data_source AS s
-- Switched-off sources keep their place in the order rather than sinking to the bottom: the
-- order is what they would take if switched back on, and moving them would make the toggle
-- look like it renumbered the catalog.
--
-- **Broken by id, because the priorities are not unique.** `ecb` and `unodc` both ship at 16,
-- and `update_data_source` lets a household set any number, so a tie is reachable at any time.
-- Without a tiebreak the panel's order for a tied pair is whatever the plan happens to return,
-- which changes under the reader for no reason they can see (P76).
ORDER  BY s.default_priority, s.id;

-- name: update_data_source(data_source, is_enabled, default_priority)<!
-- Switch a source on or off, and set where it stands. Either may be left null to keep what is
-- there, so the two controls do not have to be sent together.
UPDATE data_source
SET    is_enabled       = coalesce(:is_enabled, is_enabled),
       default_priority = coalesce(:default_priority, default_priority)
WHERE  id = :data_source
RETURNING id, name, source_kind, default_priority, reliability_tier, is_enabled;

-- name: select_attribute_source_priority(attribute)
-- The per-attribute overrides, flat. An override is partial (reqs.md 6.6): the sources named
-- here take this order and every other source keeps its global order beneath them, which is
-- why the global default_priority travels with each row.
SELECT p.attribute,
       p.data_source,
       p.rank,
       s.default_priority
FROM   attribute_source_priority AS p
JOIN   data_source AS s ON s.id = p.data_source
WHERE  (:attribute::text IS NULL OR p.attribute = :attribute)
ORDER  BY p.attribute, p.rank;

-- name: select_breakdown_schemes()
-- What a multi-value attribute is broken down by, with its options (reqs.md 3.3b).
SELECT b.id,
       COALESCE(
           (SELECT jsonb_agg(o.id ORDER BY o.id)
            FROM   breakdown_option AS o
            WHERE  o.breakdown_scheme = b.id),
           '[]'::jsonb) AS options
FROM   breakdown_scheme AS b
ORDER  BY b.id;

-- name: select_population_centres()
-- Where a coordinate-bound source measures each country (D4, Q210): its largest places, heaviest
-- first, so a quote naming them reads in the order that matters.
SELECT p.candidate,
       p.name,
       p.latitude,
       p.longitude,
       p.population
FROM   population_centre AS p
ORDER  BY p.candidate, p.population DESC, p.geonames_id;

-- name: select_stand_ins(level)
-- Where a neighbour's figure may stand in, and why (reqs.md Q208). Both display names are
-- joined in because the quote on every borrowed figure says, in words, whose figure it is.
SELECT s.candidate,
       candidate.name  AS candidate_name,
       s.attribute,
       s.substitute_candidate,
       substitute.name AS substitute_name,
       s.reason
FROM   stand_in AS s
JOIN   candidate            ON candidate.id = s.candidate
JOIN   candidate AS substitute ON substitute.id = s.substitute_candidate
WHERE  (:level::text IS NULL OR s.level = :level)
ORDER  BY s.candidate, s.attribute;

-- name: select_match_rules(level)
-- The named gates. A rule with a NULL level applies at every level, so it is returned
-- whatever level is asked for.
SELECT r.id,
       r.name,
       r.level
FROM   match_rule AS r
WHERE  :level::text IS NULL OR r.level IS NULL OR r.level = :level
ORDER  BY r.id;

-- name: select_compound_rules(level)
-- The compound-rule catalog with whichever child a rule's shape uses: ShareOfHouseholdField
-- and SumBelowFloor carry inputs, AllConditionsHold carries conditions, and no rule carries
-- both (0007-gates-and-outside-opinions.sql). Both are returned so the caller need not know
-- which to ask for; the one that does not apply comes back empty.
--
-- A NULL threshold is a rule whose number is still TBD (reqs.md 7.4). It is returned as NULL
-- and the caller leaves the rule inactive; nothing here invents a bound.
SELECT r.id,
       r.name,
       r.level,
       r.shape,
       r.outcome,
       r.threshold_min,
       r.threshold_max,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                       'input_order',     i.input_order,
                       'attribute',       i.attribute,
                       'household_field', i.household_field)
                    ORDER BY i.input_order)
            FROM   compound_rule_input AS i
            WHERE  i.compound_rule = r.id),
           '[]'::jsonb) AS inputs,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                       'ordinal',        c.ordinal,
                       'attribute',      c.attribute,
                       -- The catalog's name, joined here so a warning can say "Cost of living
                       -- index" rather than `country.cost_of_living_index`. reqs.md asks the
                       -- interface to show no programmatic identifier, and the sentence this
                       -- feeds is built in the domain, where the id is all there was.
                       'attribute_name', a.name,
                       'threshold_min',  c.threshold_min,
                       'threshold_max',  c.threshold_max)
                    ORDER BY c.ordinal)
            FROM   compound_rule_condition AS c
            JOIN   attribute AS a ON a.id = c.attribute
            WHERE  c.compound_rule = r.id),
           '[]'::jsonb) AS conditions
FROM   compound_rule AS r
WHERE  :level::text IS NULL OR r.level IS NULL OR r.level = :level
ORDER  BY r.id;

-- name: select_value_types()
-- The ten archetypes. Read rather than hardcoded, so a payload dispatcher can assert that the
-- types it handles are exactly the types the database knows (reqs.md 3.3a).
SELECT t.id
FROM   value_type AS t
ORDER  BY t.id;

-- name: select_confidence_levels()
-- The four grades in the order the active-value view breaks ties on (arch.md 4, rule 4).
SELECT c.id,
       c.name,
       c.priority_order
FROM   confidence_level AS c
ORDER  BY c.priority_order;

-- name: select_units()
-- Units a Quantity may carry. Needed to display a magnitude with what it is a magnitude of.
SELECT u.id,
       u.name
FROM   unit AS u
ORDER  BY u.id;

-- name: select_currencies()
-- Currencies a Monetary may carry, by ISO 4217 code.
SELECT c.id,
       c.name
FROM   currency AS c
ORDER  BY c.id;

-- name: select_household_fields()
-- The household numbers a compound rule may read, as a controlled vocabulary (reqs.md 3.7a).
SELECT f.id
FROM   household_field AS f
ORDER  BY f.id;
