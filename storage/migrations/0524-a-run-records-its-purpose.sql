-- A run records what it was for: a sweep, a retry, an ask-again or a scoped run (PL-127, D34).
--
-- depends: 0513-a-runs-evidence-is-pinned-to-its-items
--
-- The history worded every run as the rectangle its two scope lists span, so a retry of two
-- failed items over two candidates read like a four-item pass, and nothing said whether a run
-- had swept the level or gone back over another run. The purpose is a fact of the request that
-- opened the run -- a sweep and a scoped run naming every candidate store the same lists -- so
-- it is written as the run opens and never derived afterwards.
--
-- **Nothing is backfilled**, because no earlier run's purpose can be read off what it stored:
-- - a sweep and a run naming every candidate and every answerable attribute store the same
--   expanded lists, and the refetch age narrows a sweep's lists too;
-- - a retry and an ask-again both store exact pairs (0506), and a pair-scoped start now does;
-- - nothing links a retry or an ask-again to the run it went back over.
-- Labelling them by a guess would put a plausible word in the history that may be false. A null
-- reads "not recorded", never "sweep", as 0512's plan columns do.

-- **Locked first** (P98): a run opened between the ADD and the CHECK would carry no purpose
-- while being written by code that always sends one.
LOCK TABLE data_acquisition_run IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE data_acquisition_run
    ADD COLUMN purpose text,
    ADD CONSTRAINT data_acquisition_run_purpose_is_known
        CHECK (purpose IN ('sweep', 'retry', 'ask_again', 'scoped'));

COMMENT ON COLUMN data_acquisition_run.purpose IS
    'What the request that opened the run was for: sweep (the whole level), retry (another run''s failures), ask_again (another run''s unanswered or not-reached items) or scoped (named candidates, attributes or pairs). Null for a run opened before 0524: not recorded.';
