-- Put the star back, and with it the silent omission it hides.
--
-- The definitions below are 0011's, character for character. Restoring them means any column
-- added to `value` after this point is once again absent from the ranking read path with no
-- error to say so.

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
