-- Take the staleness horizons away again, returning every attribute to "never stale".
--
-- Rule 2 of the active-value view then stops firing, and an old figure from a preferred source
-- once again outranks a current one from a lesser source.

UPDATE attribute SET max_age = NULL WHERE id LIKE 'country.%';
