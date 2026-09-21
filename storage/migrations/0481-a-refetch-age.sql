-- How old a figure must be before a run asks about it again.
--
-- **The planner has never skipped what is still fresh.** `select_last_retrieval_dates` has
-- been in `runs.sql` since the beginning and was called by nothing -- the conformance test
-- records it as "the planner does not yet skip what is still fresh". So every run re-fetches
-- everything in its scope, which is wasted work for a free source and money for a paid one.
--
-- **Null means refetch everything, which is exactly today's behaviour.** The setting is
-- provisional by design like the other four (`reqs.md` 3.10) and ships unset, so nothing
-- changes until somebody decides a number.
--
-- **This governs re-fetching, not which figure scores.** `attribute.max_age` does two jobs:
-- it decides what a run is worth asking about again, and it decides whether a stored figure
-- is fresh enough to win the active-value comparison. Only the first is replaced here. One
-- number cannot sensibly govern staleness for climate, which moves over decades, and rent,
-- which moves over months -- and a global override of the second would move every score the
-- moment it changed.
-- depends: 0480-a-source-can-be-switched-off

ALTER TABLE settings
    ADD COLUMN refetch_older_than_days integer;

ALTER TABLE settings
    ADD CONSTRAINT settings_refetch_age_is_positive
    CHECK (refetch_older_than_days IS NULL OR refetch_older_than_days > 0);

COMMENT ON COLUMN settings.refetch_older_than_days IS
    'How old a figure must be before a run asks about it again. Null refetches everything, which is the shipped state. Governs re-fetching only -- which figure scores is attribute.max_age (reqs.md 7.1).';
