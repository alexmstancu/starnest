-- Two loose ends of the same idea, closed together (Q229).
--
-- **`label_vocabulary` is dropped.** It was created in `0001` to hold *named* vocabularies that
-- several attributes could share -- and its own COMMENT already pointed at where per-attribute
-- vocabularies actually live: "Per-attribute vocabularies live in attribute_allowed_label".
-- That table arrived two migrations later, keyed `(attribute, label)` with a foreign key, and
-- nothing ever needed the shared registry: no two attributes in this catalog share a
-- vocabulary. So it has sat since `0001` with no rows, no foreign keys in either direction and
-- no code reading it, and an empty table in the schema diagram reads as a feature somebody
-- forgot rather than as one that was superseded (`known-issues.md` D9).
--
-- **`attribute_allowed_label` gets its first rows**, which is the more interesting half. The
-- mechanism is complete and was doing nothing: `catalog.sql` reads it, `Attribute.allowed_labels`
-- carries it, and `Attribute.refuse_unless_the_payload_suits` rejects a `LabelSet` holding a
-- label the attribute does not permit. With no rows anywhere, `country.climate_zone` -- whose
-- description is literally "Köppen codes" -- would have accepted `banana`.
--
-- **Only `climate_zone`.** The other two `LabelSet` attributes must stay open, and constraining
-- them would be actively wrong: `international_employers` is named firms, which is the whole
-- point of asking (Q221), and a fixed list would refuse every real answer the LLM path exists
-- to give. `remote_work_tax_treaty` names treaty counterparties, which are equally open.
--
-- **The list is the Köppen system's own, filtered to the codes that occur in Europe** -- not a
-- shortlist of the ones seen so far. A vocabulary that is too narrow refuses a real figure, and
-- the refusal would look like a broken adapter rather than a missing code, so it is deliberately
-- generous: the A group (tropical) and the `w` variants (dry winter) are the only ones left out,
-- because neither occurs anywhere in the candidate set. **`climate_zone` is a `LabelSet`, not a
-- single label**: a country carries every zone present within it, which is why France needs the
-- oceanic, Mediterranean, continental and alpine codes at once.
-- depends: 0471-european-air-is-descriptive

DROP TABLE label_vocabulary;

INSERT INTO attribute_allowed_label (attribute, label)
SELECT 'country.climate_zone', code
FROM   (VALUES
    -- B -- arid and semi-arid. South-eastern Spain reaches true desert; the Ebro basin and
    -- parts of the Meseta are cold semi-arid.
    ('BWh'), ('BWk'), ('BSh'), ('BSk'),
    -- C -- temperate. Cfb is most of western and central Europe; Csa and Csb the
    -- Mediterranean; Cfc the exposed Atlantic and Icelandic coasts.
    ('Csa'), ('Csb'), ('Csc'), ('Cfa'), ('Cfb'), ('Cfc'),
    -- D -- continental, from the Baltics and Poland through to subarctic Lapland. The `s`
    -- variants occur in the mountains of southern Europe.
    ('Dsa'), ('Dsb'), ('Dsc'), ('Dsd'), ('Dfa'), ('Dfb'), ('Dfc'), ('Dfd'),
    -- E -- polar. Tundra above the tree line and on the northern coasts; ice cap on the
    -- Icelandic glaciers and on Svalbard, which is Norway.
    ('ET'), ('EF')
) AS koeppen (code)
ON CONFLICT (attribute, label) DO NOTHING;

-- The guard is only worth having if it is attached to the attribute it guards. A vocabulary
-- seeded against a mistyped attribute id would silently constrain nothing, and the foreign key
-- would not catch it -- `attribute_allowed_label.attribute` references `attribute(id)`, and a
-- wrong-but-existing id is still a valid reference.
DO $$
DECLARE
    seeded integer;
BEGIN
    SELECT count(*) INTO seeded
    FROM   attribute_allowed_label
    WHERE  attribute = 'country.climate_zone';

    IF seeded <> 20 THEN
        RAISE EXCEPTION 'climate_zone should permit 20 Koeppen codes and permits %', seeded;
    END IF;
END $$;
