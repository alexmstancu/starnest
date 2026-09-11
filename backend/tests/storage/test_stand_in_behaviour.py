"""What the stand-in table holds and what it refuses (`0460`, `reqs.md` Q208).

A stand-in puts another place's figure beside a candidate's name, which is only honest while
the declaration says why and borrows within one level. Each refusal below is proven by writing
the row that must be refused, never by reading `pg_constraint` (`test_rule_constraint_behaviour`
explains why).
"""

import psycopg
import pytest
from psycopg import errors
from psycopg_pool import AsyncConnectionPool

from starnest.storage import PostgresCatalogStore

pytestmark = pytest.mark.storage

LIECHTENSTEIN = "country.liechtenstein"
SWITZERLAND = "country.switzerland"
THE_THREE_NO_SOURCE_COVERS_FOR_LIECHTENSTEIN = (
    "country.cost_of_living_index",
    "country.healthcare_system_quality",
    "country.total_tax_rate_effective",
)
AN_ATTRIBUTE_NOT_YET_BORROWED = "country.homicide_rate"


def _declare(
    connection: psycopg.Connection,
    *,
    candidate: str = LIECHTENSTEIN,
    attribute: str = AN_ATTRIBUTE_NOT_YET_BORROWED,
    substitute: str = SWITZERLAND,
    level: str = "country",
    reason: str = "a reason a reader could check",
) -> None:
    connection.execute(
        "INSERT INTO stand_in (candidate, attribute, substitute_candidate, level, reason)"
        " VALUES (%s, %s, %s, %s, %s)",
        (candidate, attribute, substitute, level, reason),
    )


class TestWhatIsSeeded:
    async def test_switzerland_stands_in_for_liechtenstein_on_exactly_the_three_gaps(
        self, pool: AsyncConnectionPool
    ) -> None:
        """The three blocking attributes whose sources cover 31 of the 32, and nothing else:
        Switzerland's homicide rate or protected land says nothing about Liechtenstein."""
        declared = await PostgresCatalogStore(pool).read_stand_ins(level="country")

        assert [(d.candidate, d.substitute) for d in declared] == [(LIECHTENSTEIN, SWITZERLAND)] * 3
        assert tuple(d.attribute for d in declared) == THE_THREE_NO_SOURCE_COVERS_FOR_LIECHTENSTEIN

    async def test_each_comes_back_with_both_names_and_its_reason(
        self, pool: AsyncConnectionPool
    ) -> None:
        declared = await PostgresCatalogStore(pool).read_stand_ins(level="country")

        assert {(d.candidate_name, d.substitute_name) for d in declared} == {
            ("Liechtenstein", "Switzerland")
        }
        assert all(len(d.reason) > 40 for d in declared)

    async def test_a_level_with_none_declared_reads_as_empty(
        self, pool: AsyncConnectionPool
    ) -> None:
        assert await PostgresCatalogStore(pool).read_stand_ins(level="city") == ()

    async def test_no_level_named_reads_every_declaration(self, pool: AsyncConnectionPool) -> None:
        assert len(await PostgresCatalogStore(pool).read_stand_ins()) == 3


class TestWhatIsRefused:
    def test_a_candidate_standing_in_for_itself(self, connection: psycopg.Connection) -> None:
        with pytest.raises(errors.CheckViolation) as refused:
            _declare(connection, substitute=LIECHTENSTEIN)

        assert refused.value.diag.constraint_name == "stand_in_is_another_candidate"

    @pytest.mark.parametrize("reason", ["", "   "], ids=["empty", "blank"])
    def test_a_declaration_that_does_not_say_why(
        self, connection: psycopg.Connection, reason: str
    ) -> None:
        with pytest.raises(errors.CheckViolation) as refused:
            _declare(connection, reason=reason)

        assert refused.value.diag.constraint_name == "stand_in_says_why"

    def test_a_substitute_from_another_level(self, connection: psycopg.Connection) -> None:
        """A city standing in for a country is a category error the schema refuses outright."""
        connection.execute(
            "INSERT INTO candidate (id, name, level, parent_level, parent_candidate,"
            " parent_required)"
            " VALUES ('city.switzerland.zurich', 'Zurich', 'city', 'country', %s, true)",
            (SWITZERLAND,),
        )

        with pytest.raises(errors.ForeignKeyViolation) as refused:
            _declare(connection, substitute="city.switzerland.zurich")

        assert refused.value.diag.constraint_name == "stand_in_substitute_is_at_the_same_level"

    def test_an_attribute_from_another_level(self, connection: psycopg.Connection) -> None:
        with pytest.raises(errors.ForeignKeyViolation) as refused:
            _declare(connection, level="city")

        assert refused.value.diag.constraint_name == "stand_in_candidate_is_at_its_level"

    def test_a_second_substitute_for_the_same_figure(self, connection: psycopg.Connection) -> None:
        """One figure stands in per attribute. Two would leave which one is shown to chance."""
        with pytest.raises(errors.UniqueViolation) as refused:
            _declare(
                connection,
                attribute="country.cost_of_living_index",
                substitute="country.austria",
            )

        assert refused.value.diag.constraint_name == "stand_in_pkey"

    def test_a_well_formed_declaration_is_accepted(self, connection: psycopg.Connection) -> None:
        _declare(connection)

        stored = connection.execute(
            "SELECT count(*) FROM stand_in WHERE attribute = %s", (AN_ATTRIBUTE_NOT_YET_BORROWED,)
        ).fetchone()
        assert stored == (1,)
