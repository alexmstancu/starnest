-- Refuses, through the value table's foreign key, while any stand-in value is stored. That is
-- deliberate: values are never discarded (reqs.md 3.6), and a rollback is not a reason to start.
DROP TABLE stand_in;
ALTER TABLE attribute DROP CONSTRAINT attribute_level_key;
DELETE FROM data_source WHERE id = 'stand_in';
