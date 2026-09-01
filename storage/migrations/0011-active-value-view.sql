-- Choosing the active value: a view, never a column (arch.md 4).
--
-- Being active is a comparison BETWEEN values rather than a fact about one. It changes when a
-- fresher value arrives, when max_age is shortened, or when source priority is edited. A
-- stored flag would be a cache of that comparison with no owner responsible for refreshing
-- it, and a stale `active` does not fail loudly -- it scores the wrong number with
-- correct-looking provenance. So every input is read at query time and there is nothing to
-- invalidate.
--
-- Implemented once against candidate, never per level.
-- depends: 0010-evaluation

CREATE VIEW value_with_rank AS
SELECT
    v.*,
    -- Fresh beats stale: a value whose reference period has aged past the attribute's max_age
    -- drops below every fresh value, whatever its source's rank. Freshness is measured from
    -- what the data describes, not from when it was downloaded -- rent from 2019 fetched this
    -- morning is stale rent.
    (a.max_age IS NULL OR (v.reference_period_end + a.max_age)::date >= CURRENT_DATE)
        AS is_fresh,
    -- Source priority. An override is partial (reqs.md 6.6): the sources it names take the
    -- order it gives them, and every other source keeps its global order beneath them. These
    -- two columns are ordered together, override first, to express exactly that.
    attribute_override.rank AS source_override_rank,
    source.default_priority AS source_default_priority,
    -- Confidence breaks ties within a priority rank.
    confidence.priority_order AS confidence_rank
FROM value AS v
JOIN attribute        AS a          ON a.id = v.attribute
JOIN data_source      AS source     ON source.id = v.data_source
JOIN confidence_level AS confidence ON confidence.id = v.confidence_level
LEFT JOIN attribute_source_priority AS attribute_override
       ON attribute_override.attribute = v.attribute
      AND attribute_override.data_source = v.data_source;

COMMENT ON VIEW value_with_rank IS
    'Every stored value joined to the three things the active-value rule ranks on: freshness against the attribute''s max_age, the source''s standing, and the value''s own confidence.';

CREATE VIEW active_value AS
SELECT DISTINCT ON (candidate, attribute, breakdown_option) *
FROM   value_with_rank
-- 1. Discard values that failed validation. They stay stored and visible, with their reason.
WHERE  rejection_reason IS NULL
ORDER  BY candidate, attribute, breakdown_option,
          -- 2. Fresh beats stale.
          is_fresh DESC,
          -- 3. Source priority: an attribute's overrides first, then the global order.
          (source_override_rank IS NULL), source_override_rank, source_default_priority,
          -- 4. Confidence breaks ties within a priority rank.
          confidence_rank,
          -- 5. Most recently retrieved wins anything remaining.
          retrieval_date DESC,
          id DESC;

COMMENT ON VIEW active_value IS
    'Exactly one value per candidate, attribute and breakdown option: the one scoring uses. Derived on every read, so a new value or a re-ranked source changes the answer everywhere at once (reqs.md 3.6, arch.md 4).';
