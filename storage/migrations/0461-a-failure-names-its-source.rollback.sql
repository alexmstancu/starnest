-- The old key holds one failure per item, so where two sources failed on one item only one
-- message survives the rollback -- which is exactly the loss this migration was written to end.
DELETE FROM data_acquisition_failure AS later
USING  data_acquisition_failure AS kept
WHERE  later.data_acquisition_run = kept.data_acquisition_run
  AND  later.candidate = kept.candidate
  AND  later.attribute = kept.attribute
  AND  later.data_source > kept.data_source;

ALTER TABLE data_acquisition_failure DROP CONSTRAINT data_acquisition_failure_pkey;
ALTER TABLE data_acquisition_failure ADD CONSTRAINT data_acquisition_failure_pkey
    PRIMARY KEY (data_acquisition_run, candidate, attribute);
ALTER TABLE data_acquisition_failure DROP COLUMN data_source;
