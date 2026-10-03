-- Back to two unanswerable posting counts carrying 6.84 points between them.
--
-- **`value_type` and `weight_locked` are stated.** Both are `NOT NULL` with no default on
-- `criterion`, so an insert that omits them aborts -- which this rollback did until it was read
-- rather than assumed. A rollback nobody has run is a rollback nobody knows about.
UPDATE attribute SET lifecycle_status = 'active'
WHERE  id IN ('country.tech_software_jobs', 'country.tech_product_jobs');

INSERT INTO criterion (criteria_set, attribute, value_type, pillar, weight, goal,
                       normalisation_method, is_scored, weight_locked, blocks_if_missing)
VALUES ('local_employment', 'country.tech_software_jobs', 'Count', 'career', 24.44, 'maximise',
        'fixed', true, false, false),
       ('local_employment', 'country.tech_product_jobs', 'Count', 'career', 24.45, 'maximise',
        'fixed', true, false, false),
       ('remote_only', 'country.tech_software_jobs', 'Count', 'career', 15.79, 'maximise',
        'fixed', true, false, false),
       ('remote_only', 'country.tech_product_jobs', 'Count', 'career', 15.79, 'maximise',
        'fixed', true, false, false);

-- The weight returns to what it was before the two were folded in, so career sums to 100 again.
UPDATE criterion SET weight = 14.44
WHERE  criteria_set = 'local_employment' AND attribute = 'country.tech_employment_share';
UPDATE criterion SET weight = 21.05
WHERE  criteria_set = 'remote_only' AND attribute = 'country.tech_employment_share';
