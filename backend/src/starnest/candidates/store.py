"""The seam this module declares: somewhere to read the places under evaluation.

`arch.md` 6.3. Declared by the module that needs candidates, implemented in `storage/`, so the
arrow of dependency runs opposite to the arrow of control.

**Read only, and that is not an oversight.** Candidates arrive as catalog data -- 32 countries
seeded by migration (`arch.md` 1.2) -- and nomination is `reqs.md` 4.2, which minE2E does not
reach. A writer here would be a method nothing calls, on an interface every implementation has
to satisfy.
"""

from abc import ABC, abstractmethod

from starnest.candidates.candidate import Candidate


class UnknownCandidateError(LookupError):
    """A candidate was named that the catalog does not hold."""


class CandidateStore(ABC):
    """The places under evaluation, as the catalog holds them."""

    @abstractmethod
    async def read_candidates(self, *, level: str | None = None) -> tuple[Candidate, ...]:
        """Every candidate, or every candidate at one level.

        Narrowed by level because an evaluation runs at one level and never mixes them
        (`reqs.md` 3.1), so the caller that wants a ranking wants exactly this slice.
        """
