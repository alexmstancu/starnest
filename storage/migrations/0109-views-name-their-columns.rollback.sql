-- Put the star back, and with it the silent omission it hides.
--
-- The definitions below are 0011's, character for character. Restoring them means any column
-- added to `value` after this point is once again absent from the ranking read path with no
-- error to say so.
--
-- **Both COMMENTs are restored with the views, because a comment belongs to the view and dies
-- with it.** `DROP VIEW` takes the comment down too, so recreating the view without its
-- COMMENT leaves the two views documented in 0011 and undocumented after a rollback -- which
-- this file's own claim of "character for character" was not true of until it said so.

DROP VIEW active_value;
DROP VIEW value_with_rank;

CREATE VIEW value_with_rank AS
SELECT
    v.*,
    (a.max_age IS NULL OR (v.reference_period_end + a.max_age)::date >= CURRENT_DATE)
        AS is_fresh,
    attribute_override.rank AS source_override_rank,
    source.default_priority AS source_default_priority,
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
WHERE  rejection_reason IS NULL
ORDER  BY candidate, attribute, breakdown_option,
          is_fresh DESC,
          (source_override_rank IS NULL), source_override_rank, source_default_priority,
          confidence_rank,
          retrieval_date DESC,
          id DESC;

COMMENT ON VIEW active_value IS
    'Exactly one value per candidate, attribute and breakdown option: the one scoring uses. Derived on every read, so a new value or a re-ranked source changes the answer everywhere at once (reqs.md 3.6, arch.md 4).';
