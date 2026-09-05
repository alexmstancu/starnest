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
