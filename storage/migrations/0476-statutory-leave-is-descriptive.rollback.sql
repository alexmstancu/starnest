-- Back to a scored criterion at the weights it shipped with.

INSERT INTO criterion (criteria_set, attribute, pillar, value_type, is_scored, weight,
                       weight_locked, goal, normalisation_method, blocks_if_missing)
SELECT declared.criteria_set, 'country.statutory_paid_leave', 'career', 'Quantity', true,
       declared.weight, false, 'maximise', 'fixed', false
FROM   (VALUES ('local_employment', 10), ('remote_only', 5)) AS declared (criteria_set, weight);

-- **Only the two sets that had it.** An earlier draft scaled every career criterion, including
-- `minimal`'s, where the subquery found nothing and wrote NULL into a NOT NULL column.
UPDATE criterion SET weight = declared.weight
FROM   (VALUES
    ('local_employment', 'country.tech_product_jobs',       22),
    ('local_employment', 'country.tech_software_jobs',      22),
    ('local_employment', 'country.international_employers', 18),
    ('local_employment', 'country.average_working_hours',   15),
    ('local_employment', 'country.tech_employment_share',   13),
    ('remote_only',      'country.international_employers', 40),
    ('remote_only',      'country.tech_employment_share',   20),
    ('remote_only',      'country.tech_product_jobs',       15),
    ('remote_only',      'country.tech_software_jobs',      15),
    ('remote_only',      'country.average_working_hours',    5)
) AS declared (criteria_set, attribute, weight)
WHERE  criterion.criteria_set = declared.criteria_set
  AND  criterion.attribute = declared.attribute;
