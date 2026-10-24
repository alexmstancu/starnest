-- A gate answer is kept once written, and a saved refusal pins the evidence it read (PL-143:
-- FU-A3, FU-A4; reqs.md Q237, revising Q218).
--
-- depends: 0509-the-comparator-limit-is-one-to-twenty
--
-- Two holes, one cause: the evidence behind a non-match had no identity a saved ranking could
-- point at.
--
--   1. **A new gate answer destroyed the one it replaced.** `match_rule_result` held one mutable
--      row per gate and candidate, and recording an answer overwrote it and deleted the pages it
--      dropped. A person's correction erased the answer, the override and the pages it corrected.
--   2. **A saved refusal kept neither the gate answer it read nor the figure a threshold
--      judged.** Reopening a ranking after the answer changed showed the reason text and nothing
--      that could be checked against it.
--
-- So every answer is now an immutable **version** (`match_rule_answer`, with its own pages), and
-- the live row points at the one that stands. The live row keeps its columns and its pages, so
-- every reader still sees exactly one live answer per pair through the one query that reads them
-- (`select_match_rule_results`); only `record` writes either side, and writes both together.
--
-- A saved non-match pins its evidence by key: a gate refusal the version it read, a threshold
-- refusal the value row it judged. Both are outgoing keys with no cascade -- a version and a
-- value are never deleted, and the boot sweep deletes the reason, never what it cites. Reasons
-- saved before this migration keep NULL: what they read cannot be reconstructed.

-- **Locked first** (BE-A1): the live rows and their pages are copied into versions and the live
-- rows then changed to point at them, so an answer recorded between the copy and the change would
-- have no version and break the NOT NULL below.
LOCK TABLE match_rule_result, match_rule_result_citation IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE match_rule_answer (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    match_rule             text NOT NULL REFERENCES match_rule (id),
    candidate              text NOT NULL REFERENCES candidate (id),
    match_result           text NOT NULL,
    reason                 text,
    data_source            text NOT NULL REFERENCES data_source (id),
    reference_period_start date,
    reference_period_end   date,
    retrieval_date         timestamptz NOT NULL,
    override_reason        text,
    override_date          timestamptz,
    -- When this version was written. `retrieval_date` cannot order history: the client may send
    -- it. Ids are not commit order either, so history reads by (recorded_at, id) and claims no
    -- more than that.
    recorded_at            timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT match_rule_answer_is_known_vocabulary
        CHECK (match_result IN ('matching', 'not_matching', 'unknown')),
    CONSTRAINT match_rule_answer_reference_period_is_ordered
        CHECK (reference_period_end IS NULL
               OR reference_period_start IS NULL
               OR reference_period_end >= reference_period_start),
    CONSTRAINT match_rule_answer_reference_period_is_all_or_nothing
        CHECK ((reference_period_start IS NULL) = (reference_period_end IS NULL)),
    CONSTRAINT match_rule_answer_override_is_all_or_nothing
        CHECK ((override_reason IS NULL) = (override_date IS NULL)),
    -- Targets for the composite keys below, so a pointer can only name a version of its own gate
    -- (and, for the live row, its own candidate).
    CONSTRAINT match_rule_answer_is_of_its_pair UNIQUE (id, match_rule, candidate),
    CONSTRAINT match_rule_answer_is_of_its_gate UNIQUE (id, match_rule)
);

COMMENT ON TABLE match_rule_answer IS
    'Every gate answer ever recorded, never changed once written. The live answer is the one match_rule_result points at (reqs.md 3.7, Q237).';

CREATE TABLE match_rule_answer_citation (
    answer bigint NOT NULL REFERENCES match_rule_answer (id),
    url    text   NOT NULL,

    CONSTRAINT match_rule_answer_citation_pkey PRIMARY KEY (answer, url)
);

COMMENT ON TABLE match_rule_answer_citation IS
    'The pages one gate-answer version was read from, kept with it when a later answer replaces it (reqs.md 6.9, Q237).';

-- One version per live answer, with its pages. Written with recorded_at = retrieval_date, the best
-- moment the row knows of: the backfill itself is not when anybody answered.
INSERT INTO match_rule_answer (
    match_rule, candidate, match_result, reason, data_source,
    reference_period_start, reference_period_end, retrieval_date,
    override_reason, override_date, recorded_at)
SELECT match_rule, candidate, match_result, reason, data_source,
       reference_period_start, reference_period_end, retrieval_date,
       override_reason, override_date, retrieval_date
FROM   match_rule_result;

INSERT INTO match_rule_answer_citation (answer, url)
SELECT answer.id, citation.url
FROM   match_rule_result_citation AS citation
JOIN   match_rule_answer AS answer
       ON answer.match_rule = citation.match_rule AND answer.candidate = citation.candidate;

ALTER TABLE match_rule_result ADD COLUMN answer bigint;

UPDATE match_rule_result AS live
SET    answer = version.id
FROM   match_rule_answer AS version
WHERE  version.match_rule = live.match_rule AND version.candidate = live.candidate;

-- Checked under the lock taken above, so nothing can have been written since the copy.
DO $$
DECLARE
    unversioned integer;
BEGIN
    SELECT count(*) INTO unversioned FROM match_rule_result WHERE answer IS NULL;
    IF unversioned > 0 THEN
        RAISE EXCEPTION
            'cannot apply 0511: % gate answer(s) were not given a version, so the live answer '
            'could not point at one. Nothing was changed.', unversioned;
    END IF;
END $$;

ALTER TABLE match_rule_result ALTER COLUMN answer SET NOT NULL;
ALTER TABLE match_rule_result
    ADD CONSTRAINT match_rule_result_shows_a_version_of_its_pair
    FOREIGN KEY (answer, match_rule, candidate)
    REFERENCES match_rule_answer (id, match_rule, candidate);

COMMENT ON COLUMN match_rule_result.answer IS
    'The version this live answer shows. Recording an answer writes a version and moves this pointer; it never edits a version (Q237).';

-- What a saved refusal read.
ALTER TABLE non_match_reason ADD COLUMN match_rule_answer bigint;
ALTER TABLE non_match_reason ADD COLUMN used_value bigint;

ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_cites_a_version_of_its_gate
    FOREIGN KEY (match_rule_answer, match_rule) REFERENCES match_rule_answer (id, match_rule);
ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_cites_a_stored_figure
    FOREIGN KEY (used_value) REFERENCES value (id);
ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_only_a_gate_names_an_answer
    CHECK (match_rule_answer IS NULL OR match_rule IS NOT NULL);
ALTER TABLE non_match_reason
    ADD CONSTRAINT non_match_reason_only_a_threshold_names_one_figure
    CHECK (used_value IS NULL OR attribute IS NOT NULL);

COMMENT ON COLUMN non_match_reason.match_rule_answer IS
    'The gate-answer version a gate refusal read. Null on reasons saved before 0511.';
COMMENT ON COLUMN non_match_reason.used_value IS
    'The value row a threshold refusal judged. Null on reasons saved before 0511, or where the figure had no stored row.';
