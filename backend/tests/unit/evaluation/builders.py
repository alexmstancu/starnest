"""Values and criteria built for scoring tests, with every default valid.

Each test changes exactly the one thing it is about, so a refusal is attributable to that thing
and nothing else. Kept out of `conftest.py` deliberately: these are plain functions, and a test
about one field wants to pass that field and let the rest default.
"""

from datetime import UTC, datetime
from decimal import Decimal

from starnest.criteria import Criterion, Goal, NormalisationMethod
from starnest.data import ConfidenceLevel, Count, ReferencePeriod, Value, ValueType

A_PERIOD = ReferencePeriod(start=datetime(2026, 1, 1).date(), end=datetime(2026, 12, 31).date())
FETCHED = datetime(2026, 8, 1, 9, 30, tzinfo=UTC)

A_SET = "minimal"
A_PILLAR = "economics"
AN_ATTRIBUTE = "country.tech_software_jobs"
RENT = "country.house_price_to_income_ratio"
A_CANDIDATE = "country.portugal"

A_SMALL_SCALE = 10
"""Not 100. A test that passes only when the scale is 100 lets a hardcoded ceiling through."""


def a_value(**overrides: object) -> Value:
    """A `Count`, because it is the simplest type that carries a comparable figure."""
    fields: dict[str, object] = {
        "candidate": A_CANDIDATE,
        "attribute": AN_ATTRIBUTE,
        "value_type": ValueType.COUNT,
        "data_source": "eurostat",
        "reference_period": A_PERIOD,
        "retrieval_date": FETCHED,
        "confidence_level": ConfidenceLevel.HIGH,
        "payload": Count(count=42),
    }
    return Value(**(fields | overrides))  # type: ignore[arg-type]


def a_criterion(**overrides: object) -> Criterion:
    fields: dict[str, object] = {
        "criteria_set": A_SET,
        "attribute": AN_ATTRIBUTE,
        "value_type": ValueType.COUNT,
        "pillar": A_PILLAR,
        "weight": Decimal("100"),
        "goal": Goal.MAXIMISE,
        "normalisation_method": NormalisationMethod.PERCENTILE,
    }
    return Criterion(**(fields | overrides))  # type: ignore[arg-type]


def a_pillar_weight(pillar: str = A_PILLAR, weight: str = "100", level: str = "country"):
    from starnest.criteria import PillarWeight

    return PillarWeight(pillar=pillar, level=level, weight=Decimal(weight))


def a_set(criteria, pillar_weights=None):
    """A criteria set whose weights already sum, so a test changes one thing at a time."""
    from starnest.criteria import CriteriaSet

    return CriteriaSet(
        id=A_SET,
        name="Minimal",
        criteria=tuple(criteria),
        pillar_weights=tuple(pillar_weights or (a_pillar_weight(),)),
    )


def values_for(**by_candidate: object) -> dict[str, tuple]:
    """`portugal=42, spain=17` as active values on the default attribute."""
    return {
        f"country.{candidate}": (a_value(candidate=f"country.{candidate}", payload=Count(count=n)),)
        for candidate, n in by_candidate.items()
    }


def two_pillars(*, first: str = "50", second: str = "50", **criterion_overrides):
    """Two criteria in two pillars, each the whole of its own pillar.

    `CriteriaSet` refuses a pillar whose criteria do not sum to 100, so a two-criterion set that
    splits weight has to split it between PILLARS -- which is the two-level weighting doing
    exactly what it is for.
    """
    from starnest.criteria import NormalisationMethod

    jobs = a_criterion(weight=Decimal("100"), **criterion_overrides)
    rent = a_criterion(
        attribute="country.house_price_to_income_ratio",
        pillar="housing",
        weight=Decimal("100"),
        normalisation_method=NormalisationMethod.PERCENTILE,
    )
    return a_set(
        [jobs, rent],
        [a_pillar_weight(weight=first), a_pillar_weight(pillar="housing", weight=second)],
    )
