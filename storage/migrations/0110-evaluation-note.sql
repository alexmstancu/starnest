-- Why this evaluation was kept.
--
-- openapi.yaml has accepted a `note` on POST /evaluations ("Why this one was kept") and
-- returned one on `EvaluationSummary` since the contract was written, and the schema had
-- nowhere to put it. A note would round-trip through the API and vanish -- the exact shape of
-- the band-label defect that migration 0013 fixed, where the contract promised storage the
-- database could not provide (known-issues D4).
--
-- The schema moves to meet the contract rather than the other way round, because the field
-- earns its place. reqs.md Q155 makes an evaluation something written ONLY when deliberately
-- kept: adjusting a weight recalculates in memory and stores nothing, and a row here is one
-- somebody wanted. "Why did I keep this one" is then the obvious question about it, and the
-- alternative is a list of near-identical timestamps nobody can tell apart.
--
-- Nullable, because keeping an evaluation without saying why is legitimate and will be the
-- common case. But not blank: an empty string is not "no note", it is a note that displays as
-- nothing, and conflating the two is the same mistake `ScaleAnchor` refuses for band labels.
-- depends: 0109-views-name-their-columns

ALTER TABLE evaluation ADD COLUMN note text;

-- `note ~ '\S'` rather than `btrim(note) <> ''`: btrim strips spaces and nothing else by
-- default, so a note of one tab passed the trimmed comparison and was stored as blank. The
-- regex asks the question that was actually meant -- is there a single non-whitespace
-- character in here -- and a parametrised test over an empty string, spaces and a tab is what
-- caught the difference.
ALTER TABLE evaluation
    ADD CONSTRAINT evaluation_note_says_something
        CHECK (note IS NULL OR note ~ '\S');

COMMENT ON COLUMN evaluation.note IS
    'Why this evaluation was kept, in the user''s own words. Absent is NULL; blank is refused (reqs.md Q155).';
