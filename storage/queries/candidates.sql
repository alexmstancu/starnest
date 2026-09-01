-- The places under evaluation.
--
-- arch.md 6.3 names no CandidateStore, yet /candidates and /candidates/{id} exist in the
-- contract and country nomination is in v1 scope (reqs.md 1.3). These queries are written for
-- whichever seam ends up owning them; nothing about their shape depends on the answer.

-- name: select_candidates(level, parent_candidate)
-- Candidates at a level, optionally only the children of one parent. The parent's name comes
-- along because a city is displayed as "Lisbon, Portugal" and that should not cost a second
-- read per row.
SELECT c.id,
       c.name,
       c.level,
       c.parent_level,
       c.parent_candidate,
       parent.name AS parent_name
FROM   candidate AS c
LEFT   JOIN candidate AS parent ON parent.id = c.parent_candidate
WHERE  (:level::text IS NULL OR c.level = :level)
  AND  (:parent_candidate::text IS NULL OR c.parent_candidate = :parent_candidate)
ORDER  BY c.name;

-- name: select_candidate(candidate_id)^
-- One candidate, for the detail screen.
SELECT c.id,
       c.name,
       c.level,
       c.parent_level,
       c.parent_candidate,
       parent.name AS parent_name
FROM   candidate AS c
LEFT   JOIN candidate AS parent ON parent.id = c.parent_candidate
WHERE  c.id = :candidate_id;

-- name: insert_candidate(candidate_id, name, level, parent_level, parent_candidate)!
-- Nomination. The identifier is supplied by the caller and assigned once (arch.md 3.2): it is
-- never regenerated from the name, so renaming Türkiye does not rewrite a single row.
--
-- The nesting rule is the schema's, not this query's: candidate_nesting_is_declared and
-- candidate_parent_is_at_parent_level reject a city recorded under another city.
INSERT INTO candidate (id, name, level, parent_level, parent_candidate)
VALUES (:candidate_id, :name, :level, :parent_level, :parent_candidate);

-- name: update_candidate_name(candidate_id, name)!
-- A display name may be corrected, translated or re-styled without touching a row that refers
-- to it (arch.md 3.2a). The identifier never changes.
UPDATE candidate
SET    name = :name
WHERE  id = :candidate_id;
