"""Candidate, Level, the nesting rule, identifier conventions.

**This module imports nothing** (`arch.md` 6.1), and every other module imports it. That is
what a stable core should look like: the most-depended-upon module is also the least likely
to change. `import-linter` contract 4 keeps it true.

It defines what a candidate *is*. It never says which candidates exist -- the 32 seeded
countries are catalog data, inserted by migration (`arch.md` 1.2) -- and it holds no
persistence, no scoring and no criteria. What a place scores belongs to an evaluation,
because it depends on which criteria set was used.

**How this module refuses things.** Every fault it can detect is a `ValueError`, so
`except ValueError` catches all of them. Constructing an identifier or a `LevelHierarchy`
raises the domain error itself -- `MalformedIdentifierError`, `InconsistentHierarchyError`.
Constructing a `Candidate` or a `Level` goes through Pydantic, which reports the same errors
wrapped in a `ValidationError` (itself a `ValueError`); the original is recoverable from
`error.errors()[0]["ctx"]["error"]` for a caller that needs to branch on it.
"""

from starnest.candidates.candidate import Candidate, NestingError
from starnest.candidates.identifiers import (
    SEGMENT_SEPARATOR,
    CandidateId,
    CountryCode,
    CountryCodeAlpha3,
    Identifier,
    LevelId,
    MalformedIdentifierError,
    suggest_identifier_segment,
)
from starnest.candidates.levels import (
    InconsistentHierarchyError,
    Level,
    LevelHierarchy,
    UnknownLevelError,
)
from starnest.candidates.store import CandidateStore, UnknownCandidateError

__all__ = [
    "SEGMENT_SEPARATOR",
    "Candidate",
    "CandidateId",
    "CandidateStore",
    "CountryCode",
    "CountryCodeAlpha3",
    "Identifier",
    "InconsistentHierarchyError",
    "Level",
    "LevelHierarchy",
    "LevelId",
    "MalformedIdentifierError",
    "NestingError",
    "UnknownCandidateError",
    "UnknownLevelError",
    "suggest_identifier_segment",
]
