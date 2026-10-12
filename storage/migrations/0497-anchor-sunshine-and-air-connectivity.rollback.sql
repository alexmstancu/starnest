-- Remove the anchors 0497 added, returning both criteria to the unplaceable `fixed` state they
-- were in before figures existed for them. Scoped to the exact input_values seeded, so a hand-set
-- anchor added later is left alone.

DELETE FROM criterion_scale_anchor
WHERE  (criterion, input_value) IN (
    SELECT c.id, anchor.input_value
    FROM   criterion AS c
    JOIN   (VALUES
                ('country.annual_sunshine_hours',         1300),
                ('country.annual_sunshine_hours',         3200),
                ('country.international_air_connectivity', 20),
                ('country.international_air_connectivity', 300)
            ) AS anchor (attribute, input_value)
           ON anchor.attribute = c.attribute
    WHERE  c.criteria_set IN ('local_employment', 'remote_only')
      AND  c.normalisation_method = 'fixed'
);
