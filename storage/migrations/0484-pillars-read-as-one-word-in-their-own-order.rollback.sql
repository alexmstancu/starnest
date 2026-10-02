-- Back to the catalog's longer names and no stated order.
--
-- **The order is lost, not restored to something else**: there was none before, and every
-- screen falls back to whatever the query happens to return.
ALTER TABLE pillar DROP CONSTRAINT pillar_display_order_is_unique;
ALTER TABLE pillar DROP COLUMN display_order;

UPDATE pillar SET name = 'Economics'                  WHERE id = 'economics';
UPDATE pillar SET name = 'Housing'                    WHERE id = 'housing';
UPDATE pillar SET name = 'Career & work'              WHERE id = 'career';
UPDATE pillar SET name = 'Safety & stability'         WHERE id = 'safety';
UPDATE pillar SET name = 'Health'                     WHERE id = 'health';
UPDATE pillar SET name = 'Climate & environment'      WHERE id = 'climate';
UPDATE pillar SET name = 'Connectivity'               WHERE id = 'connectivity';
UPDATE pillar SET name = 'Nature & landscape'         WHERE id = 'nature';
UPDATE pillar SET name = 'Culture & community'        WHERE id = 'culture';
UPDATE pillar SET name = 'Governance & administration' WHERE id = 'governance';
UPDATE pillar SET name = 'Family & education'         WHERE id = 'family';
