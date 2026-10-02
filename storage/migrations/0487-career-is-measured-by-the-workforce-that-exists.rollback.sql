-- Back to two unanswerable posting counts carrying 6.84 points between them.
UPDATE attribute SET lifecycle_status = 'active'
WHERE  id IN ('country.tech_software_jobs', 'country.tech_product_jobs');

INSERT INTO criterion (criteria_set, attribute, pillar, weight, goal, normalisation_method,
                       is_scored, blocks_if_missing)
VALUES ('local_employment', 'country.tech_software_jobs', 'career', 24.44, 'maximise', 'fixed',
        true, false),
       ('local_employment', 'country.tech_product_jobs', 'career', 24.45, 'maximise', 'fixed',
        true, false),
       ('remote_only', 'country.tech_software_jobs', 'career', 15.79, 'maximise', 'fixed',
        true, false),
       ('remote_only', 'country.tech_product_jobs', 'career', 15.79, 'maximise', 'fixed',
        true, false);

UPDATE criterion SET weight = 14.44
WHERE  criteria_set = 'local_employment' AND attribute = 'country.tech_employment_share';
UPDATE criterion SET weight = 21.05
WHERE  criteria_set = 'remote_only' AND attribute = 'country.tech_employment_share';
