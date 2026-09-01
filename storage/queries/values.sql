-- ValueStore (arch.md 6.3): read active values, append new ones, never update.
--
-- There is no UPDATE and no DELETE on `value` in this file, and there must never be one.
-- Values are never overwritten and never discarded (reqs.md 3.6): a correction is a new row
-- that supersedes the old one through the active-value view, and a value that failed
-- validation is inserted already carrying its rejection_reason rather than updated into it.
--
-- Nothing here reimplements the active-value rule. Freshness, source priority, confidence and
-- recency are the five ordering rules of arch.md 4, and they live in the `active_value` view
-- (0011-active-value-view.sql). Every query that wants the scoring value selects from that
-- view; a second implementation would drift and would drift silently.
--
-- The typed payload is assembled as jsonb rather than as ninety nullable columns. A value is a
-- discriminated union of ten shapes (reqs.md 3.3a) and two of them -- LabelSet and
-- ShareComposition -- are lists, so a single result set has no flat shape to take. The
-- CASE below appears exactly twice in this file, in select_active_values and in
-- select_value_payloads, and nowhere else: the ranking path must stay one query and so must
-- carry it inline, while every other reader fetches payloads by value id.

-- name: select_active_values(level, candidates, attributes)
-- Query two of the two the ranking read path is allowed (arch.md 7.2). One call returns the
-- scoring value for every candidate and every attribute at once; a query per candidate or per
-- attribute would be the wrong shape, and a slider drag would feel it.
--
-- A candidate with no stored values at all produces no row here, so this result set is not the
-- candidate list. The ranking must take its roster from select_candidates and left-join these
-- onto it, or a country nobody has fetched anything for disappears from the results instead of
-- appearing as insufficient_data -- which is the one outcome reqs.md 5.4 refuses to hide.
--
-- All three filters are optional: :level for a whole level (the ranking), :candidates for a
-- focus and its comparators (the comparison), :attributes for the attributes a criteria set
-- actually judges. Breakdown reduction is NOT done here -- every option comes back and the
-- criterion picks one in memory, which is what makes changing household size instant
-- (arch.md 7.2 step 3).
SELECT v.id,
       v.candidate,
       v.attribute,
       v.breakdown_option,
       v.value_type,
       v.data_source,
       v.data_acquisition_run,
       v.reference_period_start,
       v.reference_period_end,
       v.retrieval_date,
       v.confidence_level,
       v.quote,
       v.is_fresh,
       CASE v.value_type
           WHEN 'Monetary' THEN jsonb_build_object(
               'amount', monetary.amount, 'currency', monetary.currency,
               'amount_eur', monetary.amount_eur,
               'fx_rate', monetary.fx_rate, 'fx_rate_date', monetary.fx_rate_date)
           WHEN 'Quantity' THEN jsonb_build_object(
               'magnitude', quantity.magnitude, 'unit', quantity.unit)
           WHEN 'Count' THEN jsonb_build_object(
               'count', counted.count, 'basis', counted.basis)
           WHEN 'Ratio' THEN jsonb_build_object(
               'value', ratio.value, 'basis', ratio.basis)
           WHEN 'Index' THEN jsonb_build_object(
               'value', indexed.value, 'provider', indexed.provider,
               'scale_min', indexed.scale_min, 'scale_max', indexed.scale_max)
           WHEN 'LabelSet' THEN jsonb_build_object(
               'labels', COALESCE((SELECT jsonb_agg(label.label ORDER BY label.label)
                                   FROM   value_labelset AS label
                                   WHERE  label.value_id = v.id), '[]'::jsonb))
           WHEN 'ShareComposition' THEN jsonb_build_object(
               'shares', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                              'label', share.label, 'share', share.share)
                                          ORDER BY share.label)
                                   FROM   value_sharecomp AS share
                                   WHERE  share.value_id = v.id), '[]'::jsonb))
           WHEN 'Boolean' THEN jsonb_build_object(
               'value', boolean_value.value)
           WHEN 'AssignedScore' THEN jsonb_build_object(
               'value', assigned.value, 'range_min', assigned.range_min,
               'range_max', assigned.range_max, 'assigned_by', assigned.assigned_by,
               'rationale', assigned.rationale)
           WHEN 'Text' THEN jsonb_build_object(
               'body', text_body.body)
       END AS payload
FROM   active_value AS v
JOIN   candidate AS c ON c.id = v.candidate
LEFT   JOIN value_monetary AS monetary      ON monetary.value_id = v.id
LEFT   JOIN value_quantity AS quantity      ON quantity.value_id = v.id
LEFT   JOIN value_count    AS counted       ON counted.value_id = v.id
LEFT   JOIN value_ratio    AS ratio         ON ratio.value_id = v.id
LEFT   JOIN value_index    AS indexed       ON indexed.value_id = v.id
LEFT   JOIN value_boolean  AS boolean_value ON boolean_value.value_id = v.id
LEFT   JOIN value_score    AS assigned      ON assigned.value_id = v.id
LEFT   JOIN value_text     AS text_body     ON text_body.value_id = v.id
WHERE  (:level::text IS NULL OR c.level = :level)
  AND  (:candidates::text[] IS NULL OR v.candidate = ANY(:candidates))
  AND  (:attributes::text[] IS NULL OR v.attribute = ANY(:attributes))
ORDER  BY v.candidate, v.attribute, v.breakdown_option NULLS FIRST;

-- name: select_values(candidate, attribute, include_superseded, limit_rows, offset_rows)
-- Every stored value for one candidate, with its provenance and its citations, for the
-- drill-down. Superseded and rejected values are returned too when asked for, because nothing
-- is discarded and the point of the screen is to show that (reqs.md 3.6).
--
-- `is_active` is derived, never stored (arch.md 3.4): a row is active when the view picked it.
-- Payloads are not joined here -- pass the returned ids to select_value_payloads.
SELECT v.id,
       v.candidate,
       v.attribute,
       v.breakdown_option,
       v.value_type,
       v.data_source,
       v.data_acquisition_run,
       v.reference_period_start,
       v.reference_period_end,
       v.retrieval_date,
       v.confidence_level,
       v.rejection_reason,
       v.quote,
       (active.id IS NOT NULL) AS is_active,
       COALESCE(
           (SELECT jsonb_agg(citation.url ORDER BY citation.url)
            FROM   value_citation AS citation
            WHERE  citation.value = v.id),
           '[]'::jsonb) AS citations
FROM   value AS v
LEFT   JOIN active_value AS active ON active.id = v.id
WHERE  (:candidate::text IS NULL OR v.candidate = :candidate)
  AND  (:attribute::text IS NULL OR v.attribute = :attribute)
  AND  (:include_superseded OR active.id IS NOT NULL)
ORDER  BY v.candidate, v.attribute, v.breakdown_option NULLS FIRST,
          v.retrieval_date DESC, v.id DESC
LIMIT  :limit_rows OFFSET :offset_rows;

-- name: count_values(candidate, attribute, include_superseded)$
-- The `total` beside the page of values above. Same predicate, deliberately.
SELECT count(*)
FROM   value AS v
LEFT   JOIN active_value AS active ON active.id = v.id
WHERE  (:candidate::text IS NULL OR v.candidate = :candidate)
  AND  (:attribute::text IS NULL OR v.attribute = :attribute)
  AND  (:include_superseded OR active.id IS NOT NULL);

-- name: select_value_payloads(value_ids)
-- The typed payload for a set of values, by id. The drill-down and the saved-evaluation
-- detail both need payloads for values they have already selected, and neither is on the hot
-- path, so they pay one extra round trip rather than duplicating the CASE a third time.
SELECT v.id,
       v.value_type,
       CASE v.value_type
           WHEN 'Monetary' THEN jsonb_build_object(
               'amount', monetary.amount, 'currency', monetary.currency,
               'amount_eur', monetary.amount_eur,
               'fx_rate', monetary.fx_rate, 'fx_rate_date', monetary.fx_rate_date)
           WHEN 'Quantity' THEN jsonb_build_object(
               'magnitude', quantity.magnitude, 'unit', quantity.unit)
           WHEN 'Count' THEN jsonb_build_object(
               'count', counted.count, 'basis', counted.basis)
           WHEN 'Ratio' THEN jsonb_build_object(
               'value', ratio.value, 'basis', ratio.basis)
           WHEN 'Index' THEN jsonb_build_object(
               'value', indexed.value, 'provider', indexed.provider,
               'scale_min', indexed.scale_min, 'scale_max', indexed.scale_max)
           WHEN 'LabelSet' THEN jsonb_build_object(
               'labels', COALESCE((SELECT jsonb_agg(label.label ORDER BY label.label)
                                   FROM   value_labelset AS label
                                   WHERE  label.value_id = v.id), '[]'::jsonb))
           WHEN 'ShareComposition' THEN jsonb_build_object(
               'shares', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                              'label', share.label, 'share', share.share)
                                          ORDER BY share.label)
                                   FROM   value_sharecomp AS share
                                   WHERE  share.value_id = v.id), '[]'::jsonb))
           WHEN 'Boolean' THEN jsonb_build_object(
               'value', boolean_value.value)
           WHEN 'AssignedScore' THEN jsonb_build_object(
               'value', assigned.value, 'range_min', assigned.range_min,
               'range_max', assigned.range_max, 'assigned_by', assigned.assigned_by,
               'rationale', assigned.rationale)
           WHEN 'Text' THEN jsonb_build_object(
               'body', text_body.body)
       END AS payload
FROM   value AS v
LEFT   JOIN value_monetary AS monetary      ON monetary.value_id = v.id
LEFT   JOIN value_quantity AS quantity      ON quantity.value_id = v.id
LEFT   JOIN value_count    AS counted       ON counted.value_id = v.id
LEFT   JOIN value_ratio    AS ratio         ON ratio.value_id = v.id
LEFT   JOIN value_index    AS indexed       ON indexed.value_id = v.id
LEFT   JOIN value_boolean  AS boolean_value ON boolean_value.value_id = v.id
LEFT   JOIN value_score    AS assigned      ON assigned.value_id = v.id
LEFT   JOIN value_text     AS text_body     ON text_body.value_id = v.id
WHERE  v.id = ANY(:value_ids)
ORDER  BY v.id;

-- name: select_attribute_coverage(level, attributes)
-- How many candidates at a level have an active value for each attribute. This is what the
-- data-acquisition screen reports as coverage of the catalog, and what a run plan compares
-- against to decide what is worth fetching. Counting in the database keeps it one read
-- instead of one per attribute.
SELECT v.attribute,
       count(DISTINCT v.candidate) AS candidates_with_a_value
FROM   active_value AS v
JOIN   candidate AS c ON c.id = v.candidate
WHERE  (:level::text IS NULL OR c.level = :level)
  AND  (:attributes::text[] IS NULL OR v.attribute = ANY(:attributes))
GROUP  BY v.attribute
ORDER  BY v.attribute;

-- Appending. Insert the parent, then exactly one payload for its declared type.
--
-- The composite foreign keys of arch.md 3.3b make the pairing the database's problem: a
-- Monetary value refuses a quantity payload, and the payload primary keys make a second
-- payload for the same value impossible. Nothing below re-checks what the schema enforces.

-- name: insert_value(candidate, attribute, value_type, data_source, breakdown_option, data_acquisition_run, reference_period_start, reference_period_end, retrieval_date, confidence_level, quote)<!
-- Append one accepted measurement and return its id, so the typed payload can be attached in
-- the same transaction. Two dates, never merged: reference_period_* is the span the figure
-- describes, retrieval_date is the moment we fetched it (reqs.md 3.6, arch.md 9.6).
INSERT INTO value (candidate, attribute, value_type, data_source, breakdown_option,
                   data_acquisition_run, reference_period_start, reference_period_end,
                   retrieval_date, confidence_level, quote)
VALUES (:candidate, :attribute, :value_type, :data_source, :breakdown_option,
        :data_acquisition_run, :reference_period_start, :reference_period_end,
        :retrieval_date, :confidence_level, :quote)
RETURNING id;

-- name: insert_rejected_value(candidate, attribute, value_type, data_source, breakdown_option, data_acquisition_run, reference_period_start, reference_period_end, retrieval_date, confidence_level, quote, rejection_reason)<!
-- Append a measurement that failed validation, with the reason it failed.
--
-- Deliberately a second insert rather than a nullable argument to the one above, because the
-- alternative it rules out is the dangerous one: a rejection is recorded by storing the value
-- as rejected, never by updating a stored value into rejection. The row stays visible with its
-- reason and the active-value view skips it (arch.md 4, rule 1). It carries no payload -- the
-- figure is exactly what could not be trusted.
INSERT INTO value (candidate, attribute, value_type, data_source, breakdown_option,
                   data_acquisition_run, reference_period_start, reference_period_end,
                   retrieval_date, confidence_level, quote, rejection_reason)
VALUES (:candidate, :attribute, :value_type, :data_source, :breakdown_option,
        :data_acquisition_run, :reference_period_start, :reference_period_end,
        :retrieval_date, :confidence_level, :quote, :rejection_reason)
RETURNING id;

-- name: insert_value_citations(value_id, urls)!
-- The pages behind a figure, in one statement rather than one per URL.
INSERT INTO value_citation (value, url)
SELECT :value_id, url
FROM   unnest(:urls::text[]) AS url
ON CONFLICT DO NOTHING;

-- name: insert_monetary_payload(value_id, amount, currency, amount_eur, fx_rate, fx_rate_date)!
-- The published figure exactly as issued, plus its EUR equivalent and the rate that produced
-- it. The rate is data, not an implementation detail (reqs.md 5.5).
INSERT INTO value_monetary (value_id, value_type, amount, currency, amount_eur,
                            fx_rate, fx_rate_date)
VALUES (:value_id, 'Monetary', :amount, :currency, :amount_eur, :fx_rate, :fx_rate_date);

-- name: insert_quantity_payload(value_id, magnitude, unit)!
INSERT INTO value_quantity (value_id, value_type, magnitude, unit)
VALUES (:value_id, 'Quantity', :magnitude, :unit);

-- name: insert_count_payload(value_id, count, basis)!
INSERT INTO value_count (value_id, value_type, count, basis)
VALUES (:value_id, 'Count', :count, :basis);

-- name: insert_ratio_payload(value_id, value, basis)!
INSERT INTO value_ratio (value_id, value_type, value, basis)
VALUES (:value_id, 'Ratio', :value, :basis);

-- name: insert_index_payload(value_id, value, provider, scale_min, scale_max)!
-- The scale travels with the number. An index means nothing without the range it sits in, and
-- the schema refuses a value outside it.
INSERT INTO value_index (value_id, value_type, value, provider, scale_min, scale_max)
VALUES (:value_id, 'Index', :value, :provider, :scale_min, :scale_max);

-- name: insert_labelset_payload(value_id, labels)!
-- A LabelSet is a list, so its payload is several rows -- written in one statement.
INSERT INTO value_labelset (value_id, value_type, label)
SELECT :value_id, 'LabelSet', label
FROM   unnest(:labels::text[]) AS label;

-- name: insert_sharecomp_payload(value_id, labels, shares)!
-- Labels and shares arrive as two parallel arrays and are zipped by unnest. A length mismatch
-- produces NULL shares and the NOT NULL constraint rejects the write, which is the right
-- failure: a composition with a missing share is not a composition.
INSERT INTO value_sharecomp (value_id, value_type, label, share)
SELECT :value_id, 'ShareComposition', pair.label, pair.share
FROM   unnest(:labels::text[], :shares::numeric[]) AS pair(label, share);

-- name: insert_boolean_payload(value_id, value)!
INSERT INTO value_boolean (value_id, value_type, value)
VALUES (:value_id, 'Boolean', :value);

-- name: insert_assigned_score_payload(value_id, value, range_min, range_max, assigned_by, rationale)!
-- An AssignedScore records who assigned it and why. Both halves matter: this is the only value
-- type that is a judgement rather than a measurement.
INSERT INTO value_score (value_id, value_type, value, range_min, range_max,
                         assigned_by, rationale)
VALUES (:value_id, 'AssignedScore', :value, :range_min, :range_max,
        :assigned_by, :rationale);

-- name: insert_text_payload(value_id, body)!
INSERT INTO value_text (value_id, value_type, body)
VALUES (:value_id, 'Text', :body);

-- External scores. Displayed beside the score and never fed into it (reqs.md 3.5a), which is
-- why they are a separate entity here and never appear in select_active_values.

-- name: select_external_scores(candidate, level)
SELECT e.id,
       e.candidate,
       e.data_source,
       e.published_value,
       e.published_scale,
       e.published_rank,
       e.published_rank_of,
       e.reference_period_start,
       e.reference_period_end,
       e.retrieval_date,
       e.methodology_url,
       e.caveats
FROM   external_score AS e
JOIN   candidate AS c ON c.id = e.candidate
WHERE  (:candidate::text IS NULL OR e.candidate = :candidate)
  AND  (:level::text IS NULL OR c.level = :level)
ORDER  BY e.candidate, e.data_source, e.reference_period_start DESC;

-- name: insert_external_score(candidate, data_source, published_value, published_scale, published_rank, published_rank_of, reference_period_start, reference_period_end, retrieval_date, methodology_url, caveats)<!
INSERT INTO external_score (candidate, data_source, published_value, published_scale,
                            published_rank, published_rank_of, reference_period_start,
                            reference_period_end, retrieval_date, methodology_url, caveats)
VALUES (:candidate, :data_source, :published_value, :published_scale,
        :published_rank, :published_rank_of, :reference_period_start,
        :reference_period_end, :retrieval_date, :methodology_url, :caveats)
RETURNING id;
