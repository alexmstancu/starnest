"""Builders for a saved evaluation and everything that hangs off it.

Shared by the two files that test what `0107` and `0108` refuse. Not a `conftest.py`: these are
plain functions rather than fixtures, because a test that is *about* one column wants to pass
that column explicitly and let every other one default.

**Every default here is valid**, so each test changes exactly the one thing it is about and any
refusal is attributable to that thing. The controls in both test files exist to keep that true.

The `connection` fixture rolls back, so nothing written through these outlives its test.
"""

from datetime import UTC, datetime
from decimal import Decimal

import psycopg

A_SEEDED_SET = "local_employment"
A_SEEDED_LEVEL = "country"
A_SEEDED_CANDIDATE = "country.portugal"
A_SEEDED_ATTRIBUTE = "country.cost_of_living_index"
ITS_PILLAR = "economics"

THE_NESTED_LEVEL = "city"
"""Seeded, with `country` as its parent. No city candidate is seeded, so tests make their own."""

THE_FROZEN_SCALE = 10
"""Deliberately not 100. A score of 50 is inside a hardcoded ceiling and outside this one."""

A_SCORE_ON_THE_SCALE = 7
A_SCORE_A_HARDCODED_HUNDRED_WOULD_ALLOW = 50


def record_an_evaluation(
    connection: psycopg.Connection,
    *,
    scale: int = THE_FROZEN_SCALE,
    level: str = A_SEEDED_LEVEL,
    note: str | None = None,
) -> int:
    """One saved evaluation, carrying the level it ran at and the scale its scores are on."""
    row = connection.execute(
        """
        INSERT INTO evaluation (criteria_set, level, computed_at, score_scale_max, note)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
        """,
        (A_SEEDED_SET, level, datetime.now(UTC), scale, note),
    ).fetchone()
    assert row is not None
    return int(row[0])


def record_a_result(
    connection: psycopg.Connection,
    evaluation: int,
    *,
    candidate: str = A_SEEDED_CANDIDATE,
    level: str = A_SEEDED_LEVEL,
    score: int | None = A_SCORE_ON_THE_SCALE,
    coverage: Decimal = Decimal("80"),
    scale: int = THE_FROZEN_SCALE,
) -> int:
    row = connection.execute(
        """
        INSERT INTO candidate_result (evaluation, candidate, level, score, coverage,
                                      match_status, score_scale_max)
        VALUES (%s, %s, %s, %s, %s, 'matching', %s)
        RETURNING id
        """,
        (evaluation, candidate, level, score, coverage, scale),
    ).fetchone()
    assert row is not None
    return int(row[0])


def record_a_frozen_criterion(
    connection: psycopg.Connection,
    evaluation: int,
    *,
    attribute: str = A_SEEDED_ATTRIBUTE,
    level: str = A_SEEDED_LEVEL,
    weight: Decimal = Decimal("40"),
    pillar_weight: Decimal = Decimal("30"),
) -> None:
    connection.execute(
        """
        INSERT INTO evaluation_criterion (evaluation, attribute, level, pillar, value_type,
                                          is_scored, weight, pillar_weight, goal,
                                          normalisation_method, blocks_if_missing, weight_locked)
        VALUES (%s, %s, %s, %s, 'Quantity', true, %s, %s, 'minimise', 'percentile', false,
                false)
        """,
        (evaluation, attribute, level, ITS_PILLAR, weight, pillar_weight),
    )


def record_a_frozen_anchor(
    connection: psycopg.Connection,
    evaluation: int,
    *,
    score: int = A_SCORE_ON_THE_SCALE,
    scale: int = THE_FROZEN_SCALE,
) -> None:
    record_a_frozen_criterion(connection, evaluation)
    connection.execute(
        """
        INSERT INTO evaluation_scale_anchor (evaluation, attribute, input_value, score,
                                             score_scale_max)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (evaluation, A_SEEDED_ATTRIBUTE, Decimal("500"), score, scale),
    )


def record_an_attribute_score(
    connection: psycopg.Connection,
    result: int,
    *,
    attribute: str = A_SEEDED_ATTRIBUTE,
    used_value: int | None = None,
    candidate: str | None = None,
    evaluation: int | None = None,
    normalised_score: int | None = A_SCORE_ON_THE_SCALE,
    effective_weight: Decimal = Decimal("40"),
    scale: int = THE_FROZEN_SCALE,
) -> None:
    """One contribution. Its evaluation and candidate are its result's unless a test is about
    one of them (`0523`); the frozen criterion it names is the test's to record."""
    parent = connection.execute(
        "SELECT evaluation, candidate FROM candidate_result WHERE id = %s", (result,)
    ).fetchone()
    assert parent is not None
    connection.execute(
        """
        INSERT INTO candidate_attribute_score (candidate_result, evaluation, candidate, attribute,
                                               used_value, normalised_score, effective_weight,
                                               contribution, score_scale_max)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            result,
            parent[0] if evaluation is None else evaluation,
            parent[1] if candidate is None else candidate,
            attribute,
            used_value,
            normalised_score,
            effective_weight,
            Decimal("2.8"),
            scale,
        ),
    )


def record_a_figure(
    connection: psycopg.Connection,
    *,
    candidate: str = A_SEEDED_CANDIDATE,
    attribute: str = A_SEEDED_ATTRIBUTE,
) -> int:
    """A stored figure, with no payload: the connection rolls back before the payload check,
    which is deferred to commit (`0519`), would ask for one."""
    row = connection.execute(
        """
        INSERT INTO value (candidate, attribute, value_type, data_source,
                           reference_period_start, reference_period_end, retrieval_date,
                           confidence_level)
        SELECT %s, a.id, a.value_type, 'eurostat', '2024-01-01', '2024-12-31', now(), 'high'
        FROM   attribute AS a
        WHERE  a.id = %s
        RETURNING id
        """,
        (candidate, attribute),
    ).fetchone()
    assert row is not None
    return int(row[0])


def record_a_non_match_reason(
    connection: psycopg.Connection,
    result: int,
    *,
    evaluation: int,
    attribute: str | None = A_SEEDED_ATTRIBUTE,
    match_rule: str | None = None,
    compound_rule: str | None = None,
    used_value: int | None = None,
    match_rule_answer: int | None = None,
) -> None:
    """Why one candidate is out, naming one frozen criterion, gate or compound rule, with the
    evidence it read. Its candidate is its result's (`0523`)."""
    connection.execute(
        """
        INSERT INTO non_match_reason (candidate_result, evaluation, candidate, attribute,
                                      match_rule, compound_rule, used_value, match_rule_answer,
                                      reason_detail)
        SELECT %s, %s, r.candidate, %s, %s, %s, %s, %s, 'above the limit'
        FROM   candidate_result AS r
        WHERE  r.id = %s
        """,
        (
            result,
            evaluation,
            attribute,
            match_rule,
            compound_rule,
            used_value,
            match_rule_answer,
            result,
        ),
    )


def record_a_city(connection: psycopg.Connection, *, city: str, country: str) -> str:
    """A candidate one level down, since the catalog seeds countries only."""
    connection.execute(
        """
        INSERT INTO candidate (id, name, level, parent_level, parent_candidate,
                               parent_required)
        SELECT %s, %s, l.id, %s, %s, l.requires_parent
        FROM   level AS l
        WHERE  l.id = %s
        """,
        (city, city, A_SEEDED_LEVEL, country, THE_NESTED_LEVEL),
    )
    return city
