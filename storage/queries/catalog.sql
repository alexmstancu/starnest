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
SELECT p.id,
       p.name,
       p.description
FROM   pillar AS p
ORDER  BY p.id;

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
WHERE  (:level::text IS NULL OR a.level = :level)
  AND  (:attribute_id::text IS NULL OR a.id = :attribute_id)
  AND  (:include_retired OR a.lifecycle_status = 'active')
ORDER  BY a.level, a.pillar NULLS LAST, a.id;

-- name: select_data_sources()
-- Where values come from, in the global priority order of reqs.md 6.6. Lower rank first, so
-- reading this list top to bottom is reading the order the active-value view applies.
SELECT s.id,
       s.name,
       s.source_kind,
       s.default_priority,
       s.reliability_tier
FROM   data_source AS s
ORDER  BY s.default_priority;

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
                       'ordinal',       c.ordinal,
                       'attribute',     c.attribute,
                       'threshold_min', c.threshold_min,
                       'threshold_max', c.threshold_max)
                    ORDER BY c.ordinal)
            FROM   compound_rule_condition AS c
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
