"""What a run need not ask about again, because the answer is still fresh.

**The planner has never done this.** `select_last_retrieval_dates` has been in `runs.sql`
since the beginning and was called by nothing, so every run re-fetched everything in its
scope -- wasted work for a free source and money for a paid one.

**Whole attributes, not individual pairs.** A run's scope is a rectangle: a list of candidates
and a list of attributes, asked as their product. A per-pair skip cannot be expressed in that
shape without restructuring the fetch, so an attribute is dropped only when *every* candidate
in scope already has a fresh figure for it. That is the case a re-run mostly hits -- ask
again right after asking, and there is nothing to do -- and it is honest about what it does
rather than appearing to be finer-grained than it is.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta


def still_fresh_everywhere(
    *,
    attributes: Sequence[str],
    candidates: Sequence[str],
    last_retrieved: Mapping[tuple[str, str], datetime],
    refetch_older_than: timedelta | None,
    now: datetime,
) -> frozenset[str]:
    """The attributes no candidate in scope needs asked about again.

    **A null threshold skips nothing**, which is the shipped state and exactly the behaviour
    the planner has always had: the setting is provisional by design (`reqs.md` 3.10) and
    nothing changes until somebody decides a number.

    A pair that has never been fetched is never fresh, so an attribute with a gap anywhere is
    asked about -- which is what makes this safe: the skip can only ever remove work that
    would have re-answered a question already answered recently.
    """
    if refetch_older_than is None or not candidates:
        return frozenset()

    asked_since = now - refetch_older_than
    return frozenset(
        attribute
        for attribute in attributes
        if all(
            (retrieved := last_retrieved.get((candidate, attribute))) is not None
            and retrieved > asked_since
            for candidate in candidates
        )
    )
