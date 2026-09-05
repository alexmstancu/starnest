-- Drop the note. The contract still accepts one, so from here it is again a field that
-- round-trips through the API and is silently discarded.

ALTER TABLE evaluation DROP CONSTRAINT evaluation_note_says_something;
ALTER TABLE evaluation DROP COLUMN note;
