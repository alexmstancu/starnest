-- A source can be switched off, and switching one off stops it being scored.
--
-- **This reverses a recorded decision, deliberately** (`reqs.md` 2, decision log Q232). That
-- section said there is no admin interface and that connecting a source is a developer action
-- -- a rule written to keep a *user* from putting the catalog into an inconsistent state by
-- reaching into the administrator's half. This application has exactly one person, who is both
-- roles, so the separation it protects does not exist here and the rule costs more than it
-- buys.
--
-- **A disabled source's values are not scored, and are not deleted.** They stay in `value`,
-- they stay in the drill-down with their provenance, and switching the source back on restores
-- them to the ranking exactly as they were. That is the non-destructive invariant of
-- `reqs.md` 3.6 holding: selecting an active value never discards data.
--
-- **Excluded rather than ranked last.** If a disabled source still won when it was the only
-- source with a figure, then switching off the sole provider of an attribute would change
-- nothing -- which is the case somebody switching it off most means. So an attribute whose
-- only source is off has no figure, its coverage falls, and the candidate says so. Honest and
-- visible beats quietly using a number the household said not to trust.
--
-- Both views are recreated rather than altered: PostgreSQL cannot add a column to the middle
-- of a view, and `is_enabled` belongs beside the other ranking inputs. The definitions are
-- otherwise unchanged, rule for rule, from 0109.
-- depends: 0479-naturalisation-is-anchored

ALTER TABLE data_source
    ADD COLUMN is_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN data_source.is_enabled IS
    'Whether this source is consulted. False means its stored values are not scored and a run does not ask it; the values themselves are kept and stay visible (reqs.md 3.6).';

DROP VIEW active_value;
DROP VIEW value_with_rank;

CREATE VIEW value_with_rank AS
SELECT
    v.id,
    v.candidate,
    v.attribute,
    v.value_type,
    v.data_source,
    v.breakdown_option,
    v.data_acquisition_run,
    v.reference_period_start,
    v.reference_period_end,
    v.retrieval_date,
    v.confidence_level,
    v.rejection_reason,
    v.quote,
    -- Fresh beats stale: a value whose reference period has aged past the attribute's max_age
    -- drops below every fresh value, whatever its source's rank. Freshness is measured from
    -- what the data describes, not from when it was downloaded -- rent from 2019 fetched this
    -- morning is stale rent.
    (a.max_age IS NULL OR (v.reference_period_end + a.max_age)::date >= CURRENT_DATE)
        AS is_fresh,
    -- Whether the source is switched on. Carried here rather than filtered here, so a reader
    -- of this view can still see every value and why it did or did not score.
    source.is_enabled AS source_is_enabled,
    -- Source priority. An override is partial (reqs.md 6.6): the sources it names take the
    -- order it gives them, and every other source keeps its global order beneath them. These
    -- two columns are ordered together, override first, to express exactly that.
    attribute_override.rank AS source_override_rank,
    source.default_priority AS source_default_priority,
    -- Confidence breaks ties within a priority rank.
    confidence.priority_order AS confidence_rank
FROM value AS v
JOIN attribute        AS a          ON a.id = v.attribute
JOIN data_source      AS source     ON source.id = v.data_source
JOIN confidence_level AS confidence ON confidence.id = v.confidence_level
LEFT JOIN attribute_source_priority AS attribute_override
       ON attribute_override.attribute = v.attribute
      AND attribute_override.data_source = v.data_source;

COMMENT ON VIEW value_with_rank IS
    'Every stored value joined to what the active-value rule ranks on: freshness against the attribute''s max_age, whether its source is switched on, the source''s standing, and the value''s own confidence.';

CREATE VIEW active_value AS
SELECT DISTINCT ON (candidate, attribute, breakdown_option)
    id,
    candidate,
    attribute,
    value_type,
    data_source,
    breakdown_option,
    data_acquisition_run,
    reference_period_start,
    reference_period_end,
    retrieval_date,
    confidence_level,
    rejection_reason,
    quote,
    is_fresh,
    source_is_enabled,
    source_override_rank,
    source_default_priority,
    confidence_rank
FROM   value_with_rank
-- 1. Discard values that failed validation. They stay stored and visible, with their reason.
WHERE  rejection_reason IS NULL
-- 1a. Discard values from a source that is switched off. Kept and visible, like a rejection.
  AND  source_is_enabled
ORDER  BY candidate, attribute, breakdown_option,
          -- 2. Fresh beats stale.
          is_fresh DESC,
          -- 3. Source priority: an attribute's overrides first, then the global order.
          (source_override_rank IS NULL), source_override_rank, source_default_priority,
          -- 4. Confidence breaks ties within a priority rank.
          confidence_rank,
          -- 5. Most recently retrieved wins anything remaining.
          retrieval_date DESC,
          id DESC;

COMMENT ON VIEW active_value IS
    'Exactly one value per candidate, attribute and breakdown option: the one scoring uses. Derived on every read, so a new value, a re-ranked source or a source switched off changes the answer everywhere at once (reqs.md 3.6, arch.md 4).';
