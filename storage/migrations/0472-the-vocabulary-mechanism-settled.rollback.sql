-- Put the shared-vocabulary registry back, and take the Köppen codes away again.
--
-- The table is recreated exactly as `0001` declared it, comment included, because a rollback
-- that restored a *different* table would leave the schema in a state no migration describes.

CREATE TABLE label_vocabulary (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    description text
);

COMMENT ON TABLE label_vocabulary IS
    'Named controlled vocabularies for LabelSet attributes -- Koeppen zone codes and the like (arch.md 3.2a). Per-attribute vocabularies live in attribute_allowed_label.';

DELETE FROM attribute_allowed_label WHERE attribute = 'country.climate_zone';
