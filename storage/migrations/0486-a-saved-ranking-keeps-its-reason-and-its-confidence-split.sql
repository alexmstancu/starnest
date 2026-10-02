-- A kept evaluation lost two of the things it is supposed to explain.
--
-- `candidate_result` stored the score, the coverage and the match status, and neither the
-- confidence split behind the coverage (`reqs.md` 5.7) nor the sentence saying why a candidate
-- could not be scored (5.3). Both are computed when a ranking is produced and both reach the
-- live screen; reopening a saved one showed an empty split and no sentence, while warnings and
-- non-match reasons round-tripped perfectly. The two paths are meant to be one answer to one
-- question, which is what `test_it_agrees_with_the_saved_evaluation` asserts -- and it compared
-- only the fields that happened to survive.
--
-- **The split is stored, not recomputed.** Recomputing it would read today's values through
-- today's source priority, and the point of freezing an evaluation is that it does not move.
-- One row per grade would be the normalised shape; it is a fixed set of four numbers that are
-- always written together and never queried apart, so they are columns -- the same argument
-- `coverage` itself already won.
--
-- Nullable, because an evaluation saved before this migration has no split to state and an
-- empty one would claim a measurement nobody made. `insufficient_reason` is nullable for the
-- ordinary reason: a candidate that scored has nothing to explain.
-- depends: 0485-each-source-has-its-own-place-in-the-order

ALTER TABLE candidate_result
    ADD COLUMN coverage_absolute numeric,
    ADD COLUMN coverage_high     numeric,
    ADD COLUMN coverage_medium   numeric,
    ADD COLUMN coverage_low      numeric,
    ADD COLUMN insufficient_reason text;

-- Each share is a percentage of the covered weight, like `coverage` itself.
ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_confidence_shares_are_percentages CHECK (
        (coverage_absolute IS NULL OR coverage_absolute BETWEEN 0 AND 100)
    AND (coverage_high     IS NULL OR coverage_high     BETWEEN 0 AND 100)
    AND (coverage_medium   IS NULL OR coverage_medium   BETWEEN 0 AND 100)
    AND (coverage_low      IS NULL OR coverage_low      BETWEEN 0 AND 100));

-- **A reason belongs to a candidate that has none.** A row carrying both a score and an
-- explanation of why it has no score is two answers to one question, and the live path cannot
-- produce one -- `_why_it_cannot_be_scored` returns None exactly when a score was computed.
ALTER TABLE candidate_result
    ADD CONSTRAINT candidate_result_explains_only_what_it_could_not_score CHECK (
        insufficient_reason IS NULL OR score IS NULL);
