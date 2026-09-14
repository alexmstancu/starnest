-- The LLM fallback's figures written before P37 was fixed are rejected, not deleted.
--
-- **What was wrong with them.** The fallback asked the model for the period a figure describes
-- and then discarded the answer, recording the day of the fetch instead (`known-issues.md` P37).
-- So an RSF score for 2019 and one for 2026 were both stored as describing 2026-09-13, which
-- broke reqs.md 3.6 -- the reference period and the retrieval date are never the same fact --
-- and did worse than mislabel them: `is_fresh` is computed from the reference period and is the
-- **first** term of the active-value order, so a figure dated today looked current forever and
-- would outrank a published figure that had honestly aged. That is the reverse of reqs.md 6.10:
-- "any structured source that can answer supersedes it automatically".
--
-- **Rejected rather than deleted**, because every value from every source stays stored
-- (reqs.md 3.6). `active_value` reads only rows whose `rejection_reason` is null, so these stop
-- counting while remaining visible with the reason beside them. The figures may well be right --
-- their quotes often name the year in prose -- but reading a year out of a sentence to repair a
-- date field is the guess the fix itself refuses to make.
--
-- **Which rows.** Only what the defect could have written: an `llm` value of a magnitude type
-- (the fallback never answers a `LabelSet`; the employers use legitimately describes today and
-- is untouched) whose reference period is the single UTC day it was retrieved. A published
-- annual figure spans a year, so nothing honestly dated can match. On a fresh database there are
-- no such rows and this is a no-op.
-- depends: 0472-the-vocabulary-mechanism-settled

UPDATE value
SET    rejection_reason =
           'Dated as the day it was fetched rather than the period it describes '
           '(known-issues.md P37). The figure may be right, but its year is unknown, so it '
           'cannot be judged for freshness and must not outrank a published figure.'
WHERE  data_source = 'llm'
  AND  value_type <> 'LabelSet'
  AND  rejection_reason IS NULL
  AND  reference_period_start = reference_period_end
  AND  reference_period_start = (retrieval_date AT TIME ZONE 'UTC')::date;
