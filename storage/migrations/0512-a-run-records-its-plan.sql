-- A run records its plan once: what each source will be asked, what it may cost and the cap it
-- is held to (PL-055, PL-056; PL-050's markers; D17, C04-N6).
--
-- depends: 0520-a-criterion-carries-one-bound-at-most
--
-- A run recorded what it meant to cover (its items) and what came back (values, re-confirmations
-- and failures), never how far each source got. So "asked, and nobody had a row" and "never
-- asked" left the same trace, and a run stopped after one source called every item the others
-- never reached "unanswered: retrying changes nothing".
--
-- **`data_acquisition_run_plan`**: one row per (run, source, attribute) the run means to ask,
-- with how many candidates it will be asked about, written in the run's opening transaction.
-- `finished_at` is set once that source has been asked about that attribute through to its last
-- batch with the spend cap not reached. An item with no figure and no failure is unanswered only
-- once every source planned for its attribute has finished it; otherwise it is not reached. The
-- same rows give each source's "done of planned".
--
-- **The run's ceiling and cap, as they stood when it started**: the estimate priced by the same
-- function the plan endpoint uses, the cap handed to the run's meter (null for none), and whether
-- the request accepted spending with no cap. `plan_recorded_at` says the plan was written; a run
-- without it was started before this migration, and is read by its status alone (C04-N6).
--
-- **Nothing is backfilled.** What an earlier run planned was never recorded, and inventing it
-- from the catalog of today would describe a run that did not happen. Its NULLs read "not
-- recorded", never zero.

-- **Locked first** (P98): the plan's key names a run's scoped attribute, and a run opened between
-- the two DDL statements would have nowhere to write it.
LOCK TABLE data_acquisition_run, data_acquisition_run_attribute IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE data_acquisition_run_plan (
    data_acquisition_run bigint      NOT NULL,
    data_source          text        NOT NULL REFERENCES data_source (id),
    attribute            text        NOT NULL,
    items_planned        integer     NOT NULL,
    finished_at          timestamptz,

    CONSTRAINT data_acquisition_run_plan_pkey
        PRIMARY KEY (data_acquisition_run, data_source, attribute),
    -- A source is planned only for an attribute in its run's scope.
    CONSTRAINT data_acquisition_run_plan_is_in_scope
        FOREIGN KEY (data_acquisition_run, attribute)
        REFERENCES data_acquisition_run_attribute (data_acquisition_run, attribute),
    -- A row planning nothing is not written: it would be "finished" or "not reached" about no item.
    CONSTRAINT data_acquisition_run_plan_asks_about_something CHECK (items_planned > 0)
);

ALTER TABLE data_acquisition_run
    ADD COLUMN plan_recorded_at     timestamptz,
    ADD COLUMN estimate_ceiling_eur numeric,
    ADD COLUMN spend_cap_eur        numeric,
    ADD COLUMN accepted_uncapped    boolean;

-- Finite and not negative, named as 0518 names every such check: `'NaN'` sorts above every
-- number in PostgreSQL, so `>= 0` alone would admit it.
ALTER TABLE data_acquisition_run
    ADD CONSTRAINT data_acquisition_run_estimate_ceiling_eur_is_finite
        CHECK (estimate_ceiling_eur >= 0 AND estimate_ceiling_eur < 'Infinity'::numeric),
    ADD CONSTRAINT data_acquisition_run_spend_cap_eur_is_finite
        CHECK (spend_cap_eur >= 0 AND spend_cap_eur < 'Infinity'::numeric),
    -- Recorded together or not at all: a run with a plan has a ceiling and an answer about
    -- uncapped spending (its cap may be null: no cap), and a run without one has none of them.
    ADD CONSTRAINT data_acquisition_run_plan_is_recorded_whole
        CHECK (
            (plan_recorded_at IS NOT NULL
             AND estimate_ceiling_eur IS NOT NULL
             AND accepted_uncapped IS NOT NULL)
            OR (plan_recorded_at IS NULL
                AND estimate_ceiling_eur IS NULL
                AND spend_cap_eur IS NULL
                AND accepted_uncapped IS NULL)
        );

COMMENT ON TABLE data_acquisition_run_plan IS
    'What each source was planned to be asked, per attribute, and when it had been (finished_at). An item with no evidence is unanswered only once every planned source has finished its attribute; otherwise it is not reached (C04-N6).';
COMMENT ON COLUMN data_acquisition_run.plan_recorded_at IS
    'When the plan, ceiling and cap were recorded. Null for a run started before 0512, whose unanswered items are read from its status alone.';
COMMENT ON COLUMN data_acquisition_run.estimate_ceiling_eur IS
    'What the run''s plan was estimated to cost at most, priced as the plan endpoint prices it.';
COMMENT ON COLUMN data_acquisition_run.spend_cap_eur IS
    'The cap the run''s meter was held to. Null with a plan recorded: no cap was set.';
COMMENT ON COLUMN data_acquisition_run.accepted_uncapped IS
    'Whether the request that started the run accepted spending with no cap (per request, never stored as a setting).';
