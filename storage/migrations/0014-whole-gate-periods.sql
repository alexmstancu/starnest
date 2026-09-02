-- A gate's reference period is a whole span or none at all, never one end of one.
--
-- 0007 left the two dates independently nullable with nothing but an ordering check between
-- them, so a start with no end was storable. It does not describe a span: "the Swiss quota
-- answer holds from January 2026" never says when it stops holding, and a reader cannot tell
-- an answer that has expired from one whose end nobody wrote down. A gate is displayed as the
-- reason a candidate is out (reqs.md 3.7), which makes a period that cannot be read the worst
-- kind of provenance -- present, and meaningless.
--
-- The two dates of reqs.md 3.6 are kept apart and never merged; they are not half-recorded
-- either. ReferencePeriod requires both ends and openapi.yaml carries the pair, so the schema
-- was the one loose place: the domain would have refused to construct what the database was
-- perfectly happy to store, and the fault would have surfaced on the way out rather than on
-- the way in.
--
-- Both dates absent stays legal, and is the common case. That is an answer with no recorded
-- expiry rather than an answer that never expires, and requiring a span would force whoever
-- researched the gate to invent one the source never stated.
-- depends: 0013-scale-anchor-labels

ALTER TABLE match_rule_result
    ADD CONSTRAINT match_rule_result_reference_period_is_all_or_nothing
    CHECK ((reference_period_start IS NULL) = (reference_period_end IS NULL));
