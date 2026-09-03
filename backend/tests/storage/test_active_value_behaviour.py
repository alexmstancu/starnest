"""The five ordering rules of the active-value view, each proven separately.

`arch.md` 4 is the most consequential SQL in the system: it decides which number gets scored
when several sources disagree. Getting it wrong does not crash anything -- it silently scores
the wrong figure with correct-looking provenance, which is the failure this whole application
is built to avoid.

**Why this is tested here rather than through the API.** Each rule needs a specific
combination of freshness, source rank, confidence and retrieval order. Constructing those
through the API would mean several acquisition runs against sources that disagree on purpose.
Here each is a handful of INSERTs in a transaction that rolls back, and a failure names the
rule rather than the screen.

Every test builds only what it needs and asserts one rule, so a failure says which of the five
broke.
"""

from datetime import UTC, date, datetime, timedelta

import psycopg
import pytest

pytestmark = pytest.mark.storage

CANDIDATE = "country.portugal"
ATTRIBUTE = "country.rule_of_law"
A_PERIOD = (date(2025, 1, 1), date(2025, 12, 31))


def _two_sources(connection: psycopg.Connection) -> tuple[str, str]:
    """Two real catalog sources, the better-ranked one first."""
    rows = connection.execute(
        "SELECT id FROM data_source ORDER BY default_priority LIMIT 2"
    ).fetchall()
    return rows[0][0], rows[1][0]


def _store(
    connection: psycopg.Connection,
    *,
    source: str,
    retrieved: datetime,
    confidence: str = "high",
    period: tuple[date, date] = A_PERIOD,
    rejection: str | None = None,
) -> int:
    """One stored value. Returns its id so a test can name the winner it expects."""
    return connection.execute(
        """
        INSERT INTO value (candidate, attribute, value_type, data_source,
                           reference_period_start, reference_period_end,
                           retrieval_date, confidence_level, rejection_reason)
        VALUES (%s, %s, 'Index', %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (CANDIDATE, ATTRIBUTE, source, period[0], period[1], retrieved, confidence, rejection),
    ).fetchone()[0]


def _active(connection: psycopg.Connection) -> int | None:
    row = connection.execute(
        "SELECT id FROM active_value WHERE candidate = %s AND attribute = %s",
        (CANDIDATE, ATTRIBUTE),
    ).fetchone()
    return row[0] if row else None


def _set_max_age(connection: psycopg.Connection, interval: str) -> None:
    """Freshness is inert until an attribute declares how fast its data goes stale."""
    connection.execute(
        "UPDATE attribute SET max_age = %s::interval WHERE id = %s", (interval, ATTRIBUTE)
    )


# --- rule 1 ------------------------------------------------------------------


def test_a_rejected_value_never_becomes_active(connection: psycopg.Connection) -> None:
    """It stays stored and visible, with its reason. It simply never scores."""
    better, _ = _two_sources(connection)
    rejected = _store(
        connection, source=better, retrieved=datetime.now(UTC), rejection="out of range"
    )

    assert _active(connection) is None
    assert (
        connection.execute("SELECT count(*) FROM value WHERE id = %s", (rejected,)).fetchone()[0]
        == 1
    ), "a rejected value must remain stored"


def test_a_rejected_value_does_not_shadow_a_good_one(connection: psycopg.Connection) -> None:
    """The strong form: rejection removes a value from the contest rather than winning it."""
    better, worse = _two_sources(connection)
    _store(
        connection,
        source=better,
        retrieved=datetime.now(UTC),
        rejection="out of range",
    )
    good = _store(connection, source=worse, retrieved=datetime.now(UTC))

    assert _active(connection) == good


# --- rule 2 ------------------------------------------------------------------


def test_fresh_beats_stale_even_from_a_worse_source(connection: psycopg.Connection) -> None:
    """Rule 2 outranks rule 3, and that ordering is deliberate.

    A better source's figure from 2019 describes 2019. The rule is measured from what the data
    describes, not from when it was downloaded.
    """
    better, worse = _two_sources(connection)
    _set_max_age(connection, "2 years")

    _store(
        connection,
        source=better,
        retrieved=datetime.now(UTC),
        period=(date(2015, 1, 1), date(2015, 12, 31)),
    )
    fresh = _store(
        connection,
        source=worse,
        retrieved=datetime.now(UTC),
        period=(date.today() - timedelta(days=30), date.today()),
    )

    assert _active(connection) == fresh


def test_freshness_is_inert_until_an_attribute_declares_max_age(
    connection: psycopg.Connection,
) -> None:
    """A null max_age means nothing ever goes stale, so rule 3 decides.

    Worth pinning: no attribute in the shipped catalog declares a max_age, so rule 2 does not
    currently fire against real data at all. That is a catalog gap, not a view bug, and this
    test states which it is.
    """
    better, worse = _two_sources(connection)
    connection.execute("UPDATE attribute SET max_age = NULL WHERE id = %s", (ATTRIBUTE,))

    ancient_but_better = _store(
        connection,
        source=better,
        retrieved=datetime.now(UTC),
        period=(date(1999, 1, 1), date(1999, 12, 31)),
    )
    _store(
        connection,
        source=worse,
        retrieved=datetime.now(UTC),
        period=(date.today() - timedelta(days=1), date.today()),
    )

    assert _active(connection) == ancient_but_better


# --- rule 3 ------------------------------------------------------------------


def test_source_priority_decides_between_equally_fresh_values(
    connection: psycopg.Connection,
) -> None:
    """The better source's figure is the one scored, everything else being equal.

    The preferred value is inserted FIRST and both share one retrieval timestamp, deliberately.
    Everything the view ranks on below rule 3 is then equal, so its last tiebreak -- id DESC --
    would pick the worse source. Only rule 3 can pick the right winner, which is what makes
    this a test of rule 3.
    """
    better, worse = _two_sources(connection)
    when = datetime.now(UTC)

    preferred = _store(connection, source=better, retrieved=when)
    _store(connection, source=worse, retrieved=when)

    assert _active(connection) == preferred


def test_a_per_attribute_override_beats_the_global_order(
    connection: psycopg.Connection,
) -> None:
    """reqs.md 6.6: an override is partial. The sources it names take the order it gives them,
    and every source it does not name keeps its global order beneath them.

    This is the rule that lets Numbeo beat national statistics for city rent while leaving
    every other attribute's ordering untouched.

    The promoted value is inserted FIRST and both share one retrieval timestamp, deliberately,
    so that both of the things the override outranks point the other way: the global order
    prefers the better source, and the view's last tiebreak -- id DESC -- prefers the row
    inserted second. Only the override can pick the right winner.
    """
    better, worse = _two_sources(connection)
    when = datetime.now(UTC)
    connection.execute("DELETE FROM attribute_source_priority WHERE attribute = %s", (ATTRIBUTE,))
    connection.execute(
        "INSERT INTO attribute_source_priority (attribute, data_source, rank) VALUES (%s, %s, 1)",
        (ATTRIBUTE, worse),
    )

    promoted = _store(connection, source=worse, retrieved=when)
    _store(connection, source=better, retrieved=when)

    assert _active(connection) == promoted


# --- rule 4 ------------------------------------------------------------------


def test_confidence_breaks_ties_within_one_source(connection: psycopg.Connection) -> None:
    """Priority encodes standing knowledge about a source; confidence grades one number.

    Neither subsumes the other, which is why both are in the ordering.
    """
    better, _ = _two_sources(connection)
    when = datetime.now(UTC)

    # The confident value is inserted FIRST, deliberately. Everything else about these two is
    # equal, so the view's last tiebreak -- id DESC -- would pick the low-confidence one. Only
    # rule 4 can pick the right winner, which is what makes this a test of rule 4.
    confident = _store(connection, source=better, retrieved=when, confidence="absolute")
    _store(
        connection,
        source=better,
        retrieved=when,
        confidence="low",
        period=(date(2025, 2, 1), date(2025, 2, 28)),
    )

    assert _active(connection) == confident


# --- rule 5 ------------------------------------------------------------------


def test_the_most_recent_retrieval_wins_anything_remaining(
    connection: psycopg.Connection,
) -> None:
    """Same source, same confidence, same period: the later fetch is the current answer.

    The later fetch is inserted FIRST, deliberately, so it holds the LOWER of the two ids and
    the view's last tiebreak -- id DESC -- points at the earlier fetch. That is the only way to
    make the two disagree, and without them disagreeing this test would pass on the tiebreak
    with rule 5 deleted.
    """
    better, _ = _two_sources(connection)
    latest = _store(connection, source=better, retrieved=datetime.now(UTC))
    _store(connection, source=better, retrieved=datetime.now(UTC) - timedelta(days=7))

    assert _active(connection) == latest


# --- the property the whole view exists for ----------------------------------


def test_exactly_one_value_is_active_per_candidate_and_attribute(
    connection: psycopg.Connection,
) -> None:
    """Five competing values, one winner. `DISTINCT ON` is what makes that true rather than a
    convention the reader has to trust."""
    better, worse = _two_sources(connection)
    now = datetime.now(UTC)
    for source, confidence, days in [
        (better, "high", 0),
        (worse, "high", 1),
        (better, "low", 2),
        (worse, "medium", 3),
        (better, "medium", 4),
    ]:
        _store(
            connection,
            source=source,
            retrieved=now - timedelta(days=days),
            confidence=confidence,
            period=(date(2025, 1, 1), date(2025, 12, 31 - days)),
        )

    assert (
        connection.execute(
            "SELECT count(*) FROM active_value WHERE candidate = %s AND attribute = %s",
            (CANDIDATE, ATTRIBUTE),
        ).fetchone()[0]
        == 1
    )


def test_a_candidate_with_no_values_produces_no_row(connection: psycopg.Connection) -> None:
    """Documented because it is a trap, not a bug.

    The ranking cannot start from this view: a country nobody has fetched anything for would
    vanish from the results entirely instead of appearing as `insufficient_data`. The read path
    starts from the candidate roster and joins values onto it.
    """
    assert _active(connection) is None
