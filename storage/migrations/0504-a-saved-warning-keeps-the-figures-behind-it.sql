-- Freeze the value rows behind each saved warning, so its source/date chain can be reopened
-- (ST-07).
--
-- depends: 0503-gate-research-spend-is-ledgered
--
-- A compound rule warns about a candidate by reading figures -- cheap to live in and heavily
-- taxed, say. The warning's text was frozen with the evaluation, but not which value rows it
-- read, so a saved warning could not be traced back to the source and date of the figures that
-- triggered it. This records them, as a child of the frozen warning: one row per value a
-- warning read. A warning that fired on a figure with no stored row (none has shipped) simply
-- has no input here.

CREATE TABLE candidate_warning_input (
    candidate_result bigint NOT NULL,
    compound_rule    text   NOT NULL,
    value_id         bigint NOT NULL REFERENCES value (id),

    CONSTRAINT candidate_warning_input_pkey
        PRIMARY KEY (candidate_result, compound_rule, value_id),
    -- Keyed to the frozen warning, not to the live rule: the warning is the thing saved, and it
    -- carries which rule and candidate it belongs to.
    CONSTRAINT candidate_warning_input_belongs_to_a_warning
        FOREIGN KEY (candidate_result, compound_rule)
        REFERENCES candidate_warning (candidate_result, compound_rule)
);
