-- Back to a planner that always refetches everything in scope.
ALTER TABLE settings DROP CONSTRAINT settings_refetch_age_is_positive;
ALTER TABLE settings DROP COLUMN refetch_older_than_days;
