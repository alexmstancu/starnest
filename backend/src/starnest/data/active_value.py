"""Which of several competing figures scoring reads -- the rule, as arithmetic.

`arch.md` 4 and `reqs.md` 3.6. Where several sources hold a value for the same attribute,
candidate and breakdown option, exactly one is **active**, chosen in this order:

1. Discard values that failed validation.
2. **Fresh beats stale** -- a value older than the attribute's `max_age` drops below every
   fresh value, whatever its source's rank.
3. **Source priority** -- the attribute's override first, then every other source in the
   global order beneath it.
4. **Confidence** breaks ties within a priority rank.
5. Most recently retrieved wins anything remaining.

**Being active is computed, never stored.** A new value arriving, a shortened `max_age` or a
re-ranked source changes the answer immediately and everywhere, because there is no cached
decision to invalidate. An earlier draft stored `active | superseded | rejected` and had no
owner responsible for recomputing it -- and a stale `active` does not fail loudly, it scores
the wrong number with correct-looking provenance.

**The production path is the `active_value` view, not this module.** One implementation, in
SQL, is what the ranking reads: a second one consulted at runtime would drift, and would drift
silently. This exists so the rule is table-testable, and so the two can be checked against each
other -- same inputs, same winner.
"""

from collections.abc import Iterable, Mapping
from datetime import date

from starnest.candidates import CandidateId
from starnest.data.attribute import Attribute
from starnest.data.identifiers import BreakdownOptionId
from starnest.data.sources import SourcePriority
from starnest.data.value import Value

ActiveValueKey = tuple[CandidateId, BreakdownOptionId | None]
"""What the rule partitions by, for one attribute: a candidate and a breakdown option.

The view partitions by candidate, attribute and breakdown option; the attribute is fixed
here because freshness and source priority are both read from it, so asking about two
attributes at once would mean carrying two of everything.
"""


class MismatchedAttributeError(ValueError):
    """Values from more than one attribute were ranked against a single attribute's rules."""


def select_active_value(
    values: Iterable[Value],
    *,
    attribute: Attribute,
    priority: SourcePriority,
    on: date,
) -> Value | None:
    """The one value scoring reads, or `None` when no candidate figure survives.

    `None` is the honest answer to "every value for this attribute was rejected", and it is
    what makes the difference between a candidate that is missing data and one that is doing
    badly (`reqs.md` 5.3). Nothing here substitutes a stale value silently -- a stale value
    wins only when it is the last one standing, and it is still returned as what it is, with
    its own dates, for the reader to see.
    """
    survivors = _the_values_this_attribute_may_rank(values, attribute)
    if not survivors:
        return None
    return min(
        survivors,
        key=lambda value: _ordering_key(value, attribute=attribute, priority=priority, on=on),
    )


def select_active_values(
    values: Iterable[Value],
    *,
    attribute: Attribute,
    priority: SourcePriority,
    on: date,
) -> Mapping[ActiveValueKey, Value]:
    """The active value for every candidate and breakdown option present in `values`.

    A broken-down attribute has one active value **per option** -- the one-bedroom rent and
    the two-bedroom rent are both current and neither supersedes the other (`reqs.md` 3.3b).
    Which option a score uses is a criterion's choice, made later and never here.
    """
    grouped: dict[ActiveValueKey, list[Value]] = {}
    for value in _the_values_this_attribute_may_rank(values, attribute):
        grouped.setdefault((value.candidate, value.breakdown_option), []).append(value)
    return {
        key: chosen
        for key, competing in grouped.items()
        if (chosen := select_active_value(competing, attribute=attribute, priority=priority, on=on))
        is not None
    }


def _the_values_this_attribute_may_rank(
    values: Iterable[Value], attribute: Attribute
) -> list[Value]:
    """Rule 1, and the guard that the caller is comparing comparable things.

    A rejected value stays stored and visible with its reason; it simply never competes.
    """
    kept = []
    for value in values:
        if value.attribute != attribute.id:
            raise MismatchedAttributeError(
                f"{value.attribute!r} cannot be ranked by the rules of {attribute.id!r}"
            )
        if not value.is_rejected:
            kept.append(value)
    return kept


def _ordering_key(
    value: Value, *, attribute: Attribute, priority: SourcePriority, on: date
) -> tuple[bool, tuple[int, int], int, float, int]:
    """Rules 2 to 5 as one key that sorts ascending, smallest winning.

    Deliberately the same five comparisons in the same order as the `ORDER BY` of the
    `active_value` view, negated where the view says `DESC`. Reading them side by side is
    how the two are kept honest.
    """
    return (
        attribute.has_gone_stale(value.reference_period, on=on),
        priority.rank_of(value.data_source),
        value.confidence_level.priority_order,
        -value.retrieval_date.timestamp(),
        -(value.id if value.id is not None else 0),
    )
