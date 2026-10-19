-- Every billed gate-research call is on record, written as it happens (BE-34, revisiting Q224).
--
-- depends: 0502-research-asks-only-the-gates-it-can-answer
--
-- Gate research writes gate answers rather than figures, so it is not a run (reqs.md 3.8) and its
-- cost had no row to accrue on: it reached the response and the log, and nothing else. Q224
-- deferred a ledger while the per-request cap bounded every spend and one paid source asked one
-- question per request. Both premises moved: the page now researches one gate per request and
-- holds a whole pass to the cap itself, so a pass is many requests -- and a response lost to a
-- timeout, or a process that died, took the only record of what had been spent with it.
--
-- **One row per call that billed anything**, written the moment the researcher returns: before
-- its proposal is stored and before the next question is asked, so a pass that dies keeps the
-- record of every call it paid for. "What has this month cost?" becomes a sum over
-- `data_acquisition_run` and this table.
--
-- **Write-only by decision.** Nothing reads it through the API; the contract is unchanged.

CREATE TABLE match_rule_research_spend (
    id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- A moment the system records, not a period in the world (arch.md 9.6).
    researched_at  timestamptz NOT NULL DEFAULT now(),
    match_rule     text        NOT NULL REFERENCES match_rule (id),
    candidate      text        NOT NULL REFERENCES candidate (id),
    data_source    text        NOT NULL REFERENCES data_source (id),
    llm_call_count integer     NOT NULL,
    cost_eur       numeric     NOT NULL,

    CONSTRAINT match_rule_research_spend_call_count_is_not_negative CHECK (llm_call_count >= 0),
    CONSTRAINT match_rule_research_spend_cost_is_not_negative       CHECK (cost_eur >= 0)
);

COMMENT ON TABLE match_rule_research_spend IS
    'What each gate-research call billed, one row per call, written as it returns (BE-34). Research writes no run, so this is its ledger.';
