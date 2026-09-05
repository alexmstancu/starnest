-- The two views list their columns instead of asking for all of them.
--
-- `SELECT *` inside a view is not a wildcard. PostgreSQL expands it once, at CREATE VIEW, and
-- freezes the result: the view's column list is fixed at the moment it is defined and does not
-- follow the table afterwards. So every column added to `value` from now on would be absent
-- from `value_with_rank` and from `active_value` -- silently, with no error anywhere, on the
-- read path that produces the ranking (known-issues D12).
--
-- That is the worst shape a schema fault can take here. Nothing breaks: the query still runs,
-- the ranking still appears, and one input to it is simply missing. A new column on `value` is
-- exactly the change someone makes to record something a score should account for.
--
-- Naming the columns does not prevent the omission -- a future migration must still add the
-- column here -- but it makes the omission VISIBLE, in a list a reader can compare against the
-- table, rather than hidden in a star that looks like it already means "everything".
-- `test_active_value_behaviour.py` compares the two lists so a build fails instead.
--
-- Both views are recreated rather than altered, because PostgreSQL cannot add a column to the
-- middle of a view. active_value is dropped first: it reads value_with_rank, and the
-- definitions below are otherwise unchanged, rule for rule, from 0011.
-- depends: 0108-results-belong-to-their-evaluation

DROP VIEW active_value;
DROP VIEW value_with_rank;

CREATE VIEW value_with_rank AS
SELECT
    v.id,
    v.candidate,
    v.attribute,
    v.value_type,
    v.data_source,
    v.breakdown_option,
    v.data_acquisition_run,
    v.reference_period_start,
    v.reference_period_end,
    v.retrieval_date,
    v.confidence_level,
    v.rejection_reason,
    v.quote,
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
SELECT DISTINCT ON (candidate, attribute, breakdown_option)
    id,
    candidate,
    attribute,
    value_type,
    data_source,
    breakdown_option,
    data_acquisition_run,
    reference_period_start,
    reference_period_end,
    retrieval_date,
    confidence_level,
    rejection_reason,
    quote,
    is_fresh,
    source_override_rank,
    source_default_priority,
    confidence_rank
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
