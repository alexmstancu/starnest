-- Runs and their failures. A run is one programmatic pass that fetches from sources and
-- writes value rows -- nothing else is a run (reqs.md 3.8).
-- depends: 0003-attribute-catalog

CREATE TABLE data_acquisition_run (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at     timestamptz NOT NULL,
    finished_at    timestamptz,
    triggered_by   text        NOT NULL,
    run_status     text        NOT NULL,
    llm_call_count integer     NOT NULL DEFAULT 0,
    cost_eur       numeric     NOT NULL DEFAULT 0,

    CONSTRAINT data_acquisition_run_status_is_known
        CHECK (run_status IN ('running', 'completed', 'halted_on_spend_cap', 'failed')),
    CONSTRAINT data_acquisition_run_finishes_after_it_starts
        CHECK (finished_at IS NULL OR finished_at >= started_at),
    CONSTRAINT data_acquisition_run_call_count_is_not_negative CHECK (llm_call_count >= 0),
    CONSTRAINT data_acquisition_run_cost_is_not_negative      CHECK (cost_eur >= 0)
);

COMMENT ON COLUMN data_acquisition_run.started_at IS
    'timestamptz: a moment the system records, not a period in the world (arch.md 9.6).';

-- Failures are rows, not a blob. A run continues past a failure (reqs.md 6.4), and the
-- (candidate, attribute) pair is exactly the unit selective retry needs.
CREATE TABLE data_acquisition_failure (
    data_acquisition_run bigint NOT NULL REFERENCES data_acquisition_run (id),
    candidate            text   NOT NULL REFERENCES candidate (id),
    attribute            text   NOT NULL REFERENCES attribute (id),
    error_message        text   NOT NULL,

    CONSTRAINT data_acquisition_failure_pkey
        PRIMARY KEY (data_acquisition_run, candidate, attribute)
);
