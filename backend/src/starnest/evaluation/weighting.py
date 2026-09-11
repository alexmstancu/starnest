"""What a missing figure does to the weights, and what it does to coverage (`reqs.md` 5.3).

Two questions that look like one and are not, which is the whole reason this module is separate
from the arithmetic that uses it.

**Redistribution** answers "what should the criteria we *do* have count for". A missing
criterion's weight spreads proportionally across the answered ones, so a candidate is not
punished for being under-documented -- exactly the sparse small town `reqs.md` 5.3 is written
about. Nothing is invented: the weight of what is missing goes to what is present, in the
proportions the user already chose.

**Coverage** answers "how much of what you asked for did we actually find". It is displayed
beside every score and is the honest counterweight to redistribution: redistribution makes a
sparse candidate scoreable, and coverage is what stops that being mistaken for a well-evidenced
one.

**Excluding a criterion is not the same as missing one.** `is_scored = false` says the user
decided it does not apply, so nothing is absent and coverage is unaffected (`reqs.md` 5.3).
`Criterion.counts_toward_coverage` is the property that keeps the two apart, and it is read by
the caller rather than here -- this module sees only the weights it is given.
"""

from collections.abc import Mapping, Set
from decimal import Decimal

from starnest.criteria import TOTAL
from starnest.data import ConfidenceLevel

AttributeWeights = Mapping[str, Decimal]


class WeightingError(ValueError):
    """The weights given cannot be redistributed or measured for coverage."""


def coverage_of(weights: AttributeWeights, answered: Set[str]) -> Decimal:
    """The share of the scored weight that is actually backed by a figure, as a percentage.

    **Weighted by what the user cares about, not counted by rows.** Answering nine criteria
    worth 1% each and missing the one worth 91% is 9% coverage, not 90%. Counting criteria
    instead would report a well-evidenced candidate where almost nothing that mattered was
    found -- and coverage exists precisely to stop that.

    Returns 0 when nothing is answered, which is the arithmetic and also the truth. An empty
    criteria set has no coverage to report and raises instead: a percentage of nothing is not 0,
    it is a question that does not apply.
    """
    total = _total_of(weights)
    covered = sum((weight for attribute, weight in weights.items() if attribute in answered), _ZERO)
    return covered / total * TOTAL


def confidence_split(
    weights: AttributeWeights, confidence_of: Mapping[str, ConfidenceLevel]
) -> dict[ConfidenceLevel, Decimal]:
    """How the covered weight divides between the four grades, as percentages summing to 100.

    `reqs.md` 5.7: "64% coverage, of which 20% high, 55% medium, 25% low". **Coverage alone
    cannot show that a candidate reached 100% on extrapolation**, and since a low-confidence
    figure is never discounted in the score (5.7 again -- uncertainty is disclosed, not absorbed),
    this is the only place the difference between an estimate and a measurement reaches a ranking.

    Weighted like coverage, for the same reason: one low figure on the criterion carrying half
    the weight is half the evidence. Every grade is present, zeros included, so "of which 0% low"
    is a fact a screen can show. **Nothing covered returns an empty mapping** -- a split of
    nothing is not a split, and four zeros would read as one.
    """
    _total_of(weights)
    by_grade = dict.fromkeys(ConfidenceLevel, _ZERO)
    for attribute, grade in confidence_of.items():
        by_grade[grade] += weights.get(attribute, _ZERO)
    covered = sum(by_grade.values(), _ZERO)
    if covered == 0:
        return {}
    return {grade: weight / covered * TOTAL for grade, weight in by_grade.items()}


def redistribute(weights: AttributeWeights, answered: Set[str]) -> dict[str, Decimal]:
    """The weights to actually score with: the missing ones' share spread over the answered.

    Proportional, so the user's relative preferences survive intact -- a criterion twice as
    important as another before redistribution is still twice as important after. The answered
    weights sum to `TOTAL`, so a candidate with three of ten criteria answered is scored out of
    the same 100 as one with all ten, and coverage is what distinguishes them.

    Every unanswered criterion comes back at zero rather than being dropped, because the caller
    is building a per-attribute breakdown and a criterion that contributed nothing is a row the
    drill-down still has to show (`reqs.md` 5.3).
    """
    total = _total_of(weights)
    covered = sum((weight for attribute, weight in weights.items() if attribute in answered), _ZERO)
    if covered == 0:
        # Nothing to spread the missing weight onto. Not an error -- it is the ordinary state of
        # a candidate nobody has fetched anything for -- and the caller reads it as
        # insufficient_data rather than as a score of zero.
        return dict.fromkeys(weights, _ZERO)
    scale = total / covered
    return {
        attribute: (weight * scale if attribute in answered else _ZERO)
        for attribute, weight in weights.items()
    }


def _total_of(weights: AttributeWeights) -> Decimal:
    """The weight the criteria set actually put on this pillar's worth of criteria.

    Read from the weights given rather than assumed to be `TOTAL`: rebalancing passes through
    intermediate states (`criteria/rebalancing.py`), and a caller scoring a subset of a set --
    one pillar, say -- has a legitimate total of its own.
    """
    if not weights:
        raise WeightingError("no criteria to weigh; coverage of nothing is not a percentage")
    total = sum(weights.values(), _ZERO)
    if total <= 0:
        raise WeightingError(
            "the criteria carry no weight between them, so there is no share for any of them "
            "to hold"
        )
    return total


_ZERO = Decimal(0)
